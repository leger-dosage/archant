import type { AccountListData } from "@/hooks/useAccounts";
import type { DashboardCashFlowData } from "@/hooks/useDashboardCashFlow";
import type { UseQueryResult } from "@tanstack/react-query";

import { ActivityIcon, Maximize2Icon, PlusIcon } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { toMinorUnits } from "@archant/data/money";

import { EmptyState } from "@/components/EmptyState";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { accountChoiceOf } from "@/lib/account-choice";
import { errorCodeOf } from "@/lib/api";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

/** Sure's `h-96`. */
const CHART_HEIGHT = 384;

// The sheet brings the date picker, which the dashboard never loads until it opens.
const TransactionSheet = lazy(async () => ({
	default: (await import("@/components/TransactionSheet")).TransactionSheet,
}));

// Recharts weighs more than the rest of the dashboard, and the Sankey most of it.
const CashFlowSankey = lazy(async () => ({
	default: (await import("@/components/CashFlowSankey")).CashFlowSankey,
}));

function Chart({ data, height }: { data: DashboardCashFlowData; height: number }) {
	const { t } = useTranslation();
	const label = t("dashboard.cashflowSankey.summary", {
		income: formatMoney({ amount: toMinorUnits(Math.abs(data.income)), currency: data.currency }),
		expenses: formatMoney({
			amount: toMinorUnits(Math.abs(data.expenses)),
			currency: data.currency,
		}),
	});

	return (
		<Suspense fallback={<div style={{ height }} />}>
			{/* Keyed by the period, so a zoom or a hover never outlives its data. */}
			<CashFlowSankey key={`${data.from}:${data.to}`} data={data} height={height} label={label} />
		</Suspense>
	);
}

/**
 * Sure's `cashflow_sankey` over the dashboard's period: the Sankey of its net
 * view, « Développer » opening it taller in a dialog. A period without a
 * counted row says so, with « Ajouter une transaction » for an administrator.
 */
export function CashFlowSankeySection({
	cashFlow,
	accounts,
	className,
}: {
	cashFlow: UseQueryResult<DashboardCashFlowData>;
	accounts: AccountListData;
	className?: string;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const [expanded, setExpanded] = useState(false);
	const [adding, setAdding] = useState(false);
	// Mounted on the first click and kept, so the sheet can animate closed.
	const [sheetMounted, setSheetMounted] = useState(false);
	const choice = useMemo(() => accountChoiceOf(accounts), [accounts]);
	const data = cashFlow.data;
	const placeholder = cashFlow.isPlaceholderData;
	const hasFlows = data !== undefined && data.sankey.links.length > 0;

	return (
		<Section
			title={t("dashboard.cashflowSankey.title")}
			{...(className === undefined ? {} : { className })}
			action={
				hasFlows ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("dashboard.cashflowSankey.expand")}
						title={t("dashboard.cashflowSankey.expand")}
						onClick={() => setExpanded(true)}
					>
						<Maximize2Icon />
					</Button>
				) : undefined
			}
		>
			{cashFlow.isPending && <Skeleton className="m-4 h-96" aria-hidden="true" />}

			{cashFlow.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(cashFlow.error)}`)}</p>
					<Button variant="outline" onClick={() => void cashFlow.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined &&
				(hasFlows ? (
					// The previous period's flows, shown while the next loads, would open
					// the wrong dates: they stay visible but cannot be clicked.
					<div
						className={cn("py-4", placeholder && "opacity-60")}
						inert={placeholder}
						aria-busy={placeholder}
						style={{ height: CHART_HEIGHT + 32 }}
					>
						<Chart data={data} height={CHART_HEIGHT} />
					</div>
				) : (
					<EmptyState
						flush
						icon={{ kind: "transfer", icon: ActivityIcon }}
						title={t("dashboard.cashflowSankey.noDataTitle")}
						description={t("dashboard.cashflowSankey.noDataDescription")}
						action={
							admin ? (
								<Button
									variant="outline"
									onClick={() => {
										setSheetMounted(true);
										setAdding(true);
									}}
								>
									<PlusIcon aria-hidden="true" />
									{t("dashboard.cashflowSankey.addTransaction")}
								</Button>
							) : null
						}
					/>
				))}

			{hasFlows && (
				<Dialog open={expanded} onOpenChange={setExpanded}>
					<DialogContent className="sm:max-w-[min(90vw,1400px)]">
						<DialogHeader>
							<DialogTitle>{t("dashboard.cashflowSankey.title")}</DialogTitle>
						</DialogHeader>
						<div className="h-[80dvh] overflow-y-auto overscroll-contain">
							<Chart data={data} height={Math.max(CHART_HEIGHT, window.innerHeight * 0.75)} />
						</div>
					</DialogContent>
				</Dialog>
			)}

			{admin && sheetMounted && (
				<Suspense fallback={null}>
					<TransactionSheet
						account={choice}
						open={adding}
						transaction={null}
						onOpenChange={setAdding}
					/>
				</Suspense>
			)}
		</Section>
	);
}
