import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { monthSchema } from "@archant/api/schemas/reports";
import type { SurePeriod } from "@archant/data/periods";
import { SURE_PERIODS } from "@archant/data/periods";

import { BalanceSheetSection } from "@/components/BalanceSheetSection";
import { CashFlowSection } from "@/components/CashFlowSection";
import { DashboardEmpty } from "@/components/DashboardEmpty";
import { GoalsSection } from "@/components/GoalsSection";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { NetWorthSection } from "@/components/NetWorthSection";
import { Page } from "@/components/Page";
import { PeriodPicker } from "@/components/PeriodPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useChartPeriod } from "@/hooks/useChartPeriod";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { errorCodeOf } from "@/lib/api";
import { toIsoMonth } from "@/lib/dates";

// Absent means the user's saved period, so links to the dashboard need no
// search params; a period from an old or hand-edited link, such as « 1M »,
// falls back to it. Both dates make a custom range, dragged on the chart.
const searchSchema = z.object({
	period: z.enum(SURE_PERIODS).optional().catch(undefined),
	startDate: z.string().optional().catch(undefined),
	endDate: z.string().optional().catch(undefined),
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
	const { period, startDate, endDate, month = currentMonth } = Route.useSearch();
	const chartPeriod = useChartPeriod({ period, startDate, endDate });
	const navigate = Route.useNavigate();
	const admin = useIsAdmin();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;
	const name = Route.useRouteContext({ select: (context) => context.session.user.name.trim() });

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("dashboard.title"), app: t("app.name") });
	}, [t]);

	// Always in the address, so Back and Reload keep a viewer's pick too.
	const pickPeriod = (next: SurePeriod) => {
		void navigate({
			search: (previous) => ({
				...previous,
				period: next,
				startDate: undefined,
				endDate: undefined,
			}),
			replace: true,
		});
		chartPeriod.save(next);
	};

	const selectRange = (from: string, to: string) =>
		void navigate({
			search: (previous) => ({ ...previous, period: undefined, startDate: from, endDate: to }),
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
						<div className="flex flex-col gap-4">
							{/* Sure's dashboard: one picker above the widgets for the period charts; the month's flow keeps its own arrows, Sure's `money_flow` month. */}
							<div className="flex items-center justify-end">
								<PeriodPicker selected={chartPeriod.chart} onPick={pickPeriod} />
							</div>
							{/* One column, as Sure's: beside the rail and the accounts column, a
							    1440 px screen leaves about 950 px, too narrow for two cards. */}
							<div className="grid grid-cols-1 gap-6 2xl:grid-cols-2 2xl:items-start">
								<NetWorthSection
									period={chartPeriod.chart}
									ready={chartPeriod.ready}
									onRangeSelect={selectRange}
								/>
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
