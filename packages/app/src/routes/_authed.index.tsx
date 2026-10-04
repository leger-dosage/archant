import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import { monthSchema } from "@archant/api/schemas/reports";

import { BalanceSheetSection } from "@/components/BalanceSheetSection";
import { CashFlowSection } from "@/components/CashFlowSection";
import { DashboardEmpty } from "@/components/DashboardEmpty";
import { GoalsSection } from "@/components/GoalsSection";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { NetWorthSection } from "@/components/NetWorthSection";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
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

function DashboardPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const currentMonth = toIsoMonth();
	const { period = DEFAULT_BALANCE_PERIOD, month = currentMonth } = Route.useSearch();
	const navigate = Route.useNavigate();
	const admin = useIsAdmin();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;
	const name = Route.useRouteContext({ select: (context) => context.session.user.name.trim() });

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
		// Sure's dashboard greets in its `h1`; the breadcrumb « Accueil » already
		// says where the page is.
		<Page
			greeting
			title={name === "" ? t("dashboard.greeting") : t("dashboard.greetingWithName", { name })}
			// Until the accounts arrive, no sentence rather than the wrong one.
			description={
				accounts.data === undefined
					? undefined
					: t(hasAccounts ? "dashboard.intro" : "dashboard.introEmpty")
			}
			// Sure's dashboard has this one action; importing and adding a
			// transaction need an account, and live on its page.
			actions={
				hasAccounts && admin ? (
					<Button onClick={() => setCreatingAccount(true)}>
						<PlusIcon aria-hidden="true" />
						{t("accounts.add")}
					</Button>
				) : undefined
			}
		>
			{accounts.isPending && <Skeleton className="h-96 w-full rounded-xl" aria-hidden="true" />}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(accounts.error)}`)}</p>
					<Button variant="outline" onClick={() => void accounts.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{accounts.data !== undefined && (
				<>
					{hasAccounts ? (
						// One column, as Sure's: beside the rail and the accounts column, a
						// 1440 px screen leaves about 950 px, too narrow for two cards.
						<div className="grid grid-cols-1 gap-6 2xl:grid-cols-2 2xl:items-start">
							<NetWorthSection period={period} onPeriodChange={changePeriod} />
							{/* From 1536 px the month's flow spans two rows, so the balance sheet
							    climbs under the net worth, as Sure's masonry does, rather than
							    waiting below the taller of the first two cards. */}
							<CashFlowSection
								month={month}
								current={currentMonth}
								onMonthChange={changeMonth}
								className="2xl:row-span-2"
							/>
							<BalanceSheetSection list={accounts.data} />
							<GoalsSection />
						</div>
					) : (
						<DashboardEmpty onAddAccount={admin ? () => setCreatingAccount(true) : null} />
					)}
				</>
			)}
			{admin && (
				<LazyCreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
			)}
		</Page>
	);
}
