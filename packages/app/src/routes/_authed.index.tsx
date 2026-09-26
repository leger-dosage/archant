import type { NetWorthData } from "@/hooks/useNetWorth";

import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboardIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import { monthSchema } from "@archant/api/schemas/reports";

import { BalanceChart, PeriodToggle, changeText } from "@/components/BalanceChart";
import { CashFlowCard } from "@/components/CashFlowCard";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { Money } from "@/components/Money";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useNetWorth } from "@/hooks/useNetWorth";
import { errorCodeOf } from "@/lib/api";
import { toIsoMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

// Absent means the default period, so links to the dashboard need no search
// params; a period from an old or hand-edited link falls back to it.
const searchSchema = z.object({
	period: z.enum(BALANCE_PERIODS).optional().catch(undefined),
	// Absent means this month, in the browser's own time zone.
	month: monthSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/")({
	validateSearch: searchSchema,
	component: DashboardPage,
});

const listFormat = new Intl.ListFormat("fr");

/** « +2,1 % sur 3 mois », green only when positive; the sign reads without colour. */
function NetWorthChange({ data }: { data: NetWorthData }) {
	const { t } = useTranslation();

	if (data.change === null) {
		return null;
	}

	return (
		<p className={cn("text-xs", data.change.amount > 0 && "text-money-income")}>
			{t("dashboard.change", {
				change: changeText(t, data.change, data.currency),
				over: t(`balances.over.${data.period}`),
			})}
		</p>
	);
}

function Total({
	label,
	amount,
	currency,
}: {
	label: string;
	amount: NetWorthData["assets"];
	currency: string;
}) {
	return (
		<div role="group" aria-label={label} className="flex flex-col gap-0.5">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd>
				<Money amount={amount} currency={currency} />
			</dd>
		</div>
	);
}

function NetWorthCard({
	period,
	onPeriodChange,
}: {
	period: BalancePeriod;
	onPeriodChange: (period: BalancePeriod) => void;
}) {
	const { t } = useTranslation();
	const netWorth = useNetWorth(period);
	const data = netWorth.data;

	return (
		<>
			<section
				aria-labelledby="net-worth-heading"
				className="flex flex-col gap-4 rounded-lg border p-6"
			>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div role="group" aria-labelledby="net-worth-heading" className="flex flex-col gap-1">
						<h2 id="net-worth-heading" className="text-sm text-muted-foreground">
							{t("dashboard.netWorth")}
						</h2>
						{netWorth.isPending && <Skeleton className="h-9 w-48" aria-hidden="true" />}
						{data !== undefined && (
							<>
								<Money amount={data.netWorth} currency={data.currency} className="amount-hero" />
								<NetWorthChange data={data} />
							</>
						)}
					</div>
					<PeriodToggle period={period} onPeriodChange={onPeriodChange} />
				</div>
				{data !== undefined && (
					<dl className="flex flex-wrap gap-8">
						<Total label={t("dashboard.assets")} amount={data.assets} currency={data.currency} />
						<Total
							label={t("dashboard.liabilities")}
							amount={data.liabilities}
							currency={data.currency}
						/>
					</dl>
				)}
				<BalanceChart
					history={netWorth}
					summaryKey="dashboard.summary"
					valueLabel={t("dashboard.netWorth")}
				/>
			</section>
			{data !== undefined && data.leftOut.length > 0 && (
				<p className="text-sm text-muted-foreground">
					{t("dashboard.leftOut", {
						names: listFormat.format(data.leftOut.map((account) => account.name)),
					})}
				</p>
			)}
		</>
	);
}

function DashboardPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const currentMonth = toIsoMonth();
	const { period = DEFAULT_BALANCE_PERIOD, month = currentMonth } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("dashboard.title"), app: t("app.name") });
	}, [t]);

	const changePeriod = (next: BalancePeriod) =>
		void navigate({
			search: (previous) => ({
				...previous,
				period: next === DEFAULT_BALANCE_PERIOD ? undefined : next,
			}),
			replace: true,
		});

	const changeMonth = (next: string) =>
		void navigate({
			search: (previous) => ({
				...previous,
				month: next === currentMonth ? undefined : next,
			}),
			replace: true,
		});

	return (
		<Page icon={LayoutDashboardIcon} title={t("dashboard.title")}>
			{accounts.isPending && <Skeleton className="h-96 w-full rounded-lg" aria-hidden="true" />}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(accounts.error)}`)}</p>
					<Button variant="outline" onClick={() => void accounts.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{accounts.data !== undefined && hasAccounts && (
				<>
					<NetWorthCard period={period} onPeriodChange={changePeriod} />
					<CashFlowCard month={month} current={currentMonth} onMonthChange={changeMonth} />
				</>
			)}

			{accounts.data !== undefined && !hasAccounts && (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("accounts.empty")}</p>
					<Button onClick={() => setCreatingAccount(true)}>{t("accounts.add")}</Button>
				</div>
			)}
			<CreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
		</Page>
	);
}
