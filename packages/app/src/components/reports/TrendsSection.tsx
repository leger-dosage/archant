import type { ReportsPageData } from "@/hooks/useReportsPage";

import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { formatTenthPercent } from "@/lib/percent";
import { averageOf, savingsRate, shortMonth } from "@/lib/reports";
import { cn } from "@/lib/utils";

const TABLE_HEAD = "px-4 py-2 font-medium";
const TABLE_CELL = "px-4 py-3 lg:px-6";

/** Sure's `_trends_insights`: one row per month of the period, then three monthly averages. */
export function TrendsSection({ data }: { data: Pick<ReportsPageData, "trends" | "currency"> }) {
	const { t } = useTranslation();
	const { trends, currency } = data;

	if (trends.length === 0) {
		return <p className="py-8 text-center text-muted-foreground">{t("reports.trends.noData")}</p>;
	}

	const averages = [
		{
			key: "avgMonthlyIncome",
			amount: averageOf(trends, (trend) => trend.income),
			tone: "text-trend-up",
		},
		{ key: "avgMonthlyExpenses", amount: averageOf(trends, (trend) => trend.expenses), tone: "" },
		{
			key: "avgMonthlySavings",
			amount: averageOf(trends, (trend) => trend.net),
			tone: averageOf(trends, (trend) => trend.net) >= 0 ? "text-trend-up" : "text-destructive",
		},
	] as const;

	return (
		<div className="flex flex-col gap-6">
			<h3 className="text-lg font-medium">{t("reports.trends.monthlyBreakdown")}</h3>
			<div className="overflow-x-auto rounded-xl bg-inset p-1">
				<div className="w-max overflow-hidden rounded-lg border bg-card sm:w-full">
					<table className="w-full text-sm">
						<thead className="bg-inset text-xs text-muted-foreground uppercase">
							<tr>
								<th scope="col" className={cn(TABLE_HEAD, "text-left")}>
									{t("reports.trends.month")}
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									{t("reports.trends.income")}
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									{t("reports.trends.expenses")}
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									{t("reports.trends.net")}
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									{t("reports.trends.savingsRate")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-line text-muted-foreground">
							{trends.map((trend) => {
								const tone = trend.net >= 0 ? "text-trend-up" : "text-destructive";

								return (
									<tr key={trend.month}>
										<th scope="row" className={cn(TABLE_CELL, "text-left font-normal")}>
											<span
												className={cn(
													"flex items-center gap-2",
													trend.current && "font-medium text-foreground",
												)}
											>
												{shortMonth(trend.month)}
												{trend.current && (
													<span className="text-xs text-muted-foreground">
														({t("reports.trends.current")})
													</span>
												)}
											</span>
										</th>
										<td className={cn(TABLE_CELL, "text-right")}>
											<Money amount={trend.income} currency={currency} className="font-normal" />
										</td>
										<td className={cn(TABLE_CELL, "text-right")}>
											<Money amount={trend.expenses} currency={currency} className="font-normal" />
										</td>
										<td className={cn(TABLE_CELL, "text-right", tone)}>
											<Money amount={trend.net} currency={currency} className="font-normal" />
										</td>
										<td className={cn(TABLE_CELL, "text-right tabular-nums", tone)}>
											{formatTenthPercent(savingsRate(trend, 1))}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				{averages.map((average) => (
					<div key={average.key} className="rounded-lg bg-inset p-4">
						<p className="mb-1 text-sm text-muted-foreground">
							{t(`reports.trends.${average.key}`)}
						</p>
						<Money
							amount={average.amount}
							currency={currency}
							className={cn("text-lg font-semibold", average.tone)}
						/>
					</div>
				))}
			</div>
		</div>
	);
}
