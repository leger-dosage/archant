import type { AccountListData } from "@/hooks/useAccounts";
import type { DashboardLayoutData } from "@/hooks/useDashboardLayout";
import type { ReactNode } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckIcon, LayoutGridIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { monthSchema } from "@archant/api/schemas/reports";
import { holdsSecurities } from "@archant/data/account-types";
import { resolveLayout } from "@archant/data/dashboard-layout";
import type { DashboardSection } from "@archant/data/dashboard-sections";
import type { SurePeriod } from "@archant/data/periods";
import { SURE_PERIODS } from "@archant/data/periods";

import { BalanceSheetSection } from "@/components/BalanceSheetSection";
import { CashFlowSankeySection } from "@/components/CashFlowSankeySection";
import { DashboardEmpty } from "@/components/DashboardEmpty";
import {
	DashboardWidget,
	SECTION_TITLES,
	useDashboardSortable,
} from "@/components/DashboardWidget";
import { EmptyState } from "@/components/EmptyState";
import { GoalsSection } from "@/components/GoalsSection";
import { InvestmentSummarySection } from "@/components/InvestmentSummarySection";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { MoneyFlowSection } from "@/components/MoneyFlowSection";
import { NetWorthSection } from "@/components/NetWorthSection";
import { OutflowsDonut } from "@/components/OutflowsDonut";
import { Page } from "@/components/Page";
import { PeriodPicker } from "@/components/PeriodPicker";
import { SpendingTrendSection } from "@/components/SpendingTrendSection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useChartPeriod } from "@/hooks/useChartPeriod";
import { useDashboardCashFlow } from "@/hooks/useDashboardCashFlow";
import { useDashboardLayout, useUpdateDashboardLayout } from "@/hooks/useDashboardLayout";
import { useDashboardMasonry } from "@/hooks/useDashboardMasonry";
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
	// The months of « Entrées / sorties d'argent » and « Dépenses », Sure's
	// `money_flow_month` and `spending_month`: absent is this month, and the
	// server reads a later one as this month too.
	moneyFlowMonth: monthSchema.optional().catch(undefined),
	// Absent is every account the widget counts; the server drops an unknown id.
	moneyFlowAccountIds: z
		.union([z.string().transform((id) => [id]), z.array(z.string())])
		.pipe(z.array(z.string()).min(1))
		.optional()
		.catch(undefined),
	spendingMonth: monthSchema.optional().catch(undefined),
	// Sure's `?customize=true`: the eye buttons and the hidden widgets' card.
	customize: z.boolean().optional().catch(undefined),
});

/**
 * Sure's default layout, what a viewer sees and what shows when the saved
 * one cannot be read.
 */
const DEFAULT_LAYOUT: DashboardLayoutData = resolveLayout(null);

export const Route = createFileRoute("/_authed/")({
	validateSearch: searchSchema,
	component: DashboardPage,
});

function DashboardPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const {
		period,
		startDate,
		endDate,
		moneyFlowMonth,
		moneyFlowAccountIds,
		spendingMonth,
		customize,
	} = Route.useSearch();
	const chartPeriod = useChartPeriod({ period, startDate, endDate });
	const cashFlow = useDashboardCashFlow(chartPeriod.chart, chartPeriod.ready);
	const navigate = Route.useNavigate();
	const admin = useIsAdmin();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;
	const name = Route.useRouteContext({ select: (context) => context.session.user.name.trim() });
	const customizing = customize === true;
	const savedLayout = useDashboardLayout({ enabled: admin });
	const updateLayout = useUpdateDashboardLayout();
	// A viewer arranges nothing and sees Sure's default (AD-21).
	const layout = (admin ? savedLayout.data : undefined) ?? DEFAULT_LAYOUT;
	// An administrator's widgets wait for their order, so they never jump into it.
	const layoutReady = !admin || !savedLayout.isPending;
	// Sure's `autofocus`: hiding a widget keeps the focus on its button in the
	// hidden card, adding it back on the widget.
	const [focusKey, setFocusKey] = useState<{
		key: DashboardSection;
		on: "hidden" | "shown";
	} | null>(null);
	const saveLayout = (change: Parameters<typeof updateLayout.mutate>[0]) => {
		if (admin) {
			updateLayout.mutate(change);
		}
	};
	const visibleOrder = layout.sectionOrder.filter((key) => !layout.hiddenSections.includes(key));
	const { order: shownOrder, sortable } = useDashboardSortable(visibleOrder, (sectionOrder) =>
		saveLayout({ sectionOrder }),
	);
	const grid = useRef<HTMLDivElement>(null);
	useDashboardMasonry(
		grid,
		`${hasAccounts && layoutReady}|${shownOrder.map((key) => `${key}:${layout.sectionLayout[key].colSpan}`).join()}`,
	);

	useEffect(() => {
		if (focusKey?.on === "shown") {
			grid.current?.querySelector<HTMLElement>(`[data-section-key="${focusKey.key}"]`)?.focus();
		}
	}, [focusKey]);
	// Sure's `investment_summary_available?`: without such an account the widget never has anything to show.
	const holdsInvestments =
		accounts.data?.groups.some((group) =>
			group.accounts.some((account) => account.active && holdsSecurities(account.type)),
		) ?? false;

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

	// Each pick keeps the other params, where Sure's links rebuild the address
	// and lose the period; this month is the default, so it leaves the address.
	const pickMonth = (key: "moneyFlowMonth" | "spendingMonth") => (next: string) =>
		void navigate({
			search: (previous) => ({ ...previous, [key]: next === toIsoMonth() ? undefined : next }),
			replace: true,
		});

	const pickAccounts = (next: string[] | undefined) =>
		void navigate({
			search: (previous) => ({ ...previous, moneyFlowAccountIds: next }),
			replace: true,
		});

	const widgets = (list: AccountListData): Record<DashboardSection, ReactNode> => ({
		cashflow_sankey: <CashFlowSankeySection cashFlow={cashFlow} accounts={list} />,
		outflows_donut: cashFlow.data !== undefined && (
			<OutflowsDonut data={cashFlow.data} placeholder={cashFlow.isPlaceholderData} />
		),
		net_worth_chart: (
			<NetWorthSection
				period={chartPeriod.chart}
				ready={chartPeriod.ready}
				onRangeSelect={selectRange}
			/>
		),
		balance_sheet: <BalanceSheetSection list={list} />,
		money_flow: (
			<MoneyFlowSection
				month={moneyFlowMonth}
				accountIds={moneyFlowAccountIds}
				accounts={list}
				onMonthChange={pickMonth("moneyFlowMonth")}
				onAccountsChange={pickAccounts}
			/>
		),
		spending_trend: (
			<SpendingTrendSection month={spendingMonth} onMonthChange={pickMonth("spendingMonth")} />
		),
		investment_summary: (
			<InvestmentSummarySection period={chartPeriod.chart} ready={chartPeriod.ready} />
		),
		goals: <GoalsSection />,
	});

	const shownWidgets = accounts.data === undefined ? null : widgets(accounts.data);

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
			// Sure's dashboard has these two actions; importing and adding a
			// transaction need an account, and live on its page.
			actions={
				hasAccounts && admin ? (
					<>
						{/* Sure's « Personnaliser », then « Terminé » while customising. */}
						<Button variant="outline" asChild>
							{customizing ? (
								<Link to="/" search={(previous) => ({ ...previous, customize: undefined })}>
									<CheckIcon aria-hidden="true" />
									{t("dashboard.customize.done")}
								</Link>
							) : (
								<Link
									to="/"
									search={(previous) => ({ ...previous, customize: true })}
									aria-label={t("dashboard.customize.start")}
									title={t("dashboard.customize.start")}
								>
									<LayoutGridIcon aria-hidden="true" />
								</Link>
							)}
						</Button>
						<Button onClick={() => setCreatingAccount(true)}>
							<PlusIcon aria-hidden="true" />
							{t("accounts.add")}
						</Button>
					</>
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
							{/* Sure's dashboard: one picker above the widgets for the period charts; « Entrées / sorties d'argent » and « Dépenses » keep their own month. */}
							<div className="flex items-center justify-end">
								<PeriodPicker selected={chartPeriod.chart} onPick={pickPeriod} />
							</div>
							{customizing && admin && (
								<HiddenWidgets
									layout={layout}
									offered={(key) => key !== "investment_summary" || holdsInvestments}
									focusKey={focusKey?.on === "hidden" ? focusKey.key : null}
									onShow={(key) => {
										saveLayout({ hiddenSections: { [key]: false } });
										setFocusKey({ key, on: "shown" });
									}}
								/>
							)}
							{!layoutReady && <Skeleton className="h-96 w-full rounded-xl" aria-hidden="true" />}
							{layoutReady && shownOrder.length === 0 && !customizing && (
								<EmptyState
									icon={{ kind: "transfer", icon: LayoutGridIcon }}
									level={2}
									title={t("dashboard.customize.allHiddenTitle")}
									description={t("dashboard.customize.allHiddenDescription")}
									action={
										admin ? (
											<Button variant="outline" asChild>
												<Link to="/" search={(previous) => ({ ...previous, customize: true })}>
													<LayoutGridIcon aria-hidden="true" />
													{t("dashboard.customize.start")}
												</Link>
											</Button>
										) : null
									}
								/>
							)}
							{/* One column, as Sure's: beside the rail and the accounts column, a
							    1440 px screen leaves about 950 px, too narrow for two cards. From
							    1536 px, two, packed as Sure's masonry: 1 px rows, each card
							    spanning its height, the dense flow filling the holes. */}
							<div
								ref={grid}
								role="list"
								aria-label={t("dashboard.sections")}
								className="grid grid-cols-1 gap-6 2xl:auto-rows-[1px] 2xl:grid-cols-2 2xl:items-start 2xl:gap-y-0 2xl:[grid-auto-flow:row_dense]"
								onDragOver={(event) => {
									if (sortable.dragging()) {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										sortable.over(event.clientX, event.clientY);
									}
								}}
								onDrop={(event) => {
									if (sortable.dragging()) {
										event.preventDefault();
										sortable.drop(event.clientX, event.clientY);
									}
								}}
							>
								{layoutReady &&
									shownOrder.map((key) => (
										<DashboardWidget
											key={key}
											sectionKey={key}
											layout={layout}
											editable={admin}
											customizing={customizing}
											sortable={sortable}
											onChange={(change) => {
												saveLayout(change);

												if (change.hiddenSections?.[key] === true) {
													setFocusKey({ key, on: "hidden" });
												}
											}}
										>
											{shownWidgets?.[key]}
										</DashboardWidget>
									))}
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

/**
 * Sure's « Widgets masqués » card while customising: one button per hidden
 * widget that has something to show, adding it back.
 */
function HiddenWidgets({
	layout,
	offered,
	focusKey,
	onShow,
}: {
	layout: DashboardLayoutData;
	offered: (key: DashboardSection) => boolean;
	/** The widget just hidden, whose button takes the focus. */
	focusKey: DashboardSection | null;
	onShow: (key: DashboardSection) => void;
}) {
	const { t } = useTranslation();
	const hidden = layout.hiddenSections.filter(offered);

	return (
		<section
			aria-labelledby="hidden-widgets-heading"
			className="flex flex-col gap-3 rounded-xl border bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<h2 id="hidden-widgets-heading" className="card-title">
					{t("dashboard.customize.hiddenTitle")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						hidden.length > 0
							? "dashboard.customize.hiddenDescription"
							: "dashboard.customize.noneHidden",
					)}
				</p>
			</div>
			{hidden.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{hidden.map((key) => (
						<Button
							key={key}
							variant="outline"
							size="sm"
							// oxlint-disable-next-line jsx-a11y/no-autofocus -- Sure's: the focus stays where the hidden widget's button was.
							autoFocus={key === focusKey}
							onClick={() => onShow(key)}
						>
							<PlusIcon aria-hidden="true" />
							{t(SECTION_TITLES[key])}
						</Button>
					))}
				</div>
			)}
		</section>
	);
}
