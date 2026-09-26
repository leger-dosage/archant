import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboardIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import { monthSchema } from "@archant/api/schemas/reports";

import { BalanceSheetSection } from "@/components/BalanceSheetSection";
import { CashFlowSection } from "@/components/CashFlowSection";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { DashboardEmpty } from "@/components/DashboardEmpty";
import { NetWorthSection } from "@/components/NetWorthSection";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { errorCodeOf } from "@/lib/api";
import { toIsoMonth } from "@/lib/dates";

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

/**
 * « Bonjour Camille » and one sentence. A paragraph, not a heading: the title
 * bar's « Tableau de bord » stays the page's only `h1`, so a screen reader
 * landing here learns where it is, not who it is.
 */
function Greeting({ hasAccounts }: { hasAccounts: boolean }) {
	const { t } = useTranslation();
	const name = Route.useRouteContext({ select: (context) => context.session.user.name.trim() });

	return (
		<div className="flex flex-col gap-0.5">
			<p className="type-display">
				{name === "" ? t("dashboard.greeting") : t("dashboard.greetingWithName", { name })}
			</p>
			<p className="text-muted-foreground">
				{t(hasAccounts ? "dashboard.intro" : "dashboard.introEmpty")}
			</p>
		</div>
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
		<Page
			icon={LayoutDashboardIcon}
			title={t("dashboard.title")}
			className="gap-4"
			// Sure's dashboard has this one action; importing and adding a
			// transaction need an account, and live on its page.
			actions={
				hasAccounts ? (
					<Button size="sm" onClick={() => setCreatingAccount(true)}>
						<PlusIcon aria-hidden="true" />
						{t("accounts.add")}
					</Button>
				) : undefined
			}
		>
			{accounts.isPending && <Skeleton className="h-96 w-full rounded-lg" aria-hidden="true" />}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(accounts.error)}`)}</p>
					<Button variant="outline" onClick={() => void accounts.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{accounts.data !== undefined && (
				<>
					<Greeting hasAccounts={hasAccounts} />
					{hasAccounts ? (
						<>
							<NetWorthSection period={period} onPeriodChange={changePeriod} />
							<div className="grid gap-4 lg:grid-cols-2 lg:items-start">
								<CashFlowSection month={month} current={currentMonth} onMonthChange={changeMonth} />
								<BalanceSheetSection list={accounts.data} />
							</div>
						</>
					) : (
						<DashboardEmpty onAddAccount={() => setCreatingAccount(true)} />
					)}
				</>
			)}
			<CreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
		</Page>
	);
}
