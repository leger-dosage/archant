import type { ReportsPageData } from "@/hooks/useReportsPage";

import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { changeText } from "@/lib/balance-change";
import { cn } from "@/lib/utils";

const ReportsNetWorthChart = lazy(async () => ({
	default: (await import("@/components/reports/ReportsNetWorthChart")).ReportsNetWorthChart,
}));

type NetWorthData = ReportsPageData["netWorth"];

function GroupTable({
	title,
	groups,
	empty,
	currency,
}: {
	title: string;
	groups: NetWorthData["groups"]["asset"];
	empty: string;
	currency: string;
}) {
	const { t } = useTranslation();

	return (
		<div className="overflow-x-auto rounded-xl bg-inset p-1">
			<div className="overflow-hidden rounded-lg border bg-card">
				<table className="w-full text-sm">
					<thead className="bg-inset text-xs text-muted-foreground uppercase">
						<tr>
							<th scope="col" className="px-4 py-2 text-left font-medium">
								{title}
							</th>
							<th scope="col" className="px-4 py-2 text-right font-medium">
								<span className="sr-only">{t("reports.breakdown.amount")}</span>
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-line">
						{groups.map((group) => (
							<tr key={group.type}>
								<th
									scope="row"
									className="px-4 py-3 text-left font-medium text-muted-foreground lg:px-6"
								>
									{t(`dashboard.balanceSheet.types.${group.type}`)}
								</th>
								<td className="px-4 py-3 text-right lg:px-6">
									<Money amount={group.total} currency={currency} />
								</td>
							</tr>
						))}
						{groups.length === 0 && (
							<tr>
								<td colSpan={2} className="px-4 py-3 text-muted-foreground lg:px-6">
									{empty}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/**
 * Sure's `_net_worth`: today's net worth, the period's change, assets
 * against liabilities, the period's chart once it has two points, and the
 * balance sheet's groups that hold something.
 */
export function ReportsNetWorth({
	data,
}: {
	data: Pick<ReportsPageData, "netWorth" | "currency">;
}) {
	const { t } = useTranslation();
	const { netWorth, currency } = data;
	const tile = "rounded-lg bg-inset p-4";

	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<div className={tile}>
					<p className="mb-2 text-sm text-muted-foreground">
						{t("reports.netWorth.currentNetWorth")}
					</p>
					<Money
						amount={netWorth.netWorth}
						currency={currency}
						className={cn(
							"text-2xl font-semibold",
							netWorth.netWorth >= 0 ? "text-trend-up" : "text-destructive",
						)}
					/>
				</div>
				<div className={tile}>
					<p className="mb-2 text-sm text-muted-foreground">{t("reports.netWorth.periodChange")}</p>
					{netWorth.change === null ? (
						<p className="text-2xl font-semibold text-muted-foreground">--</p>
					) : (
						<p
							className={cn(
								"text-2xl font-semibold tabular-nums",
								netWorth.change.amount > 0 && "text-trend-up",
								netWorth.change.amount < 0 && "text-trend-down",
							)}
						>
							{changeText(t, netWorth.change, currency)}
						</p>
					)}
				</div>
				<div className={tile}>
					<p className="mb-2 text-sm text-muted-foreground">
						{t("reports.netWorth.assetsVsLiabilities")}
					</p>
					<p className="flex flex-wrap items-baseline gap-2">
						<Money amount={netWorth.assets} currency={currency} className="text-lg font-semibold" />
						<span aria-hidden="true" className="text-xs text-muted-foreground">
							-
						</span>
						<Money
							amount={netWorth.liabilities}
							currency={currency}
							className="text-lg font-semibold"
						/>
					</p>
				</div>
			</div>
			{netWorth.series.length >= 2 && (
				<figure aria-label={t("reports.netWorth.chart")} className="m-0">
					<Suspense fallback={<Skeleton className="h-72 w-full" aria-hidden="true" />}>
						<ReportsNetWorthChart
							points={netWorth.series}
							currency={currency}
							labels={{
								netWorth: t("reports.netWorth.title"),
								assets: t("reports.netWorth.totalAssets"),
								liabilities: t("reports.netWorth.totalLiabilities"),
							}}
						/>
					</Suspense>
				</figure>
			)}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				<GroupTable
					title={t("reports.netWorth.totalAssets")}
					groups={netWorth.groups.asset}
					empty={t("reports.netWorth.noAssets")}
					currency={currency}
				/>
				<GroupTable
					title={t("reports.netWorth.totalLiabilities")}
					groups={netWorth.groups.liability}
					empty={t("reports.netWorth.noLiabilities")}
					currency={currency}
				/>
			</div>
		</div>
	);
}
