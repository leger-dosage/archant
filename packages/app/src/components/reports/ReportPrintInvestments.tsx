import type { ReportsPageData } from "@/hooks/useReportsPage";

import { useTranslation } from "react-i18next";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { formatMoney } from "@/lib/format-money";
import { cumulativeNet, sparklinePoints } from "@/lib/reports";
import { formatReturnPercent, formatShare } from "@/lib/trade-format";

const colour = (trend: "up" | "down" | "flat") =>
	trend === "up" ? "tufte-income" : trend === "down" ? "tufte-expense" : "tufte-muted";
const name = (value: string) =>
	Array.from(value).length > 25 ? `${Array.from(value).slice(0, 22).join("")}...` : value;

/** Sure's fixed print block, independent from saved screen order and collapse. */
export function ReportPrintInvestments({ data }: { data: ReportsPageData }) {
	const { t } = useTranslation();
	const investments = data.investments;
	if (!investments.available) {
		return null;
	}
	const money = (amount: typeof investments.value) =>
		formatMoney({ amount, currency: investments.currency });

	return (
		<section className="tufte-section">
			<h2 className="tufte-section-title">{t("reports.print.investments.title")}</h2>
			<div className="tufte-metric-row">
				<div className="tufte-metric-card tufte-metric-card-sm">
					<span className="tufte-metric-card-label">
						{t("reports.print.investments.portfolioValue")}
					</span>
					<span className="tufte-metric-card-value">{money(investments.value)}</span>
					{data.trends.length >= 2 && (
						<svg
							aria-hidden="true"
							width="60"
							height="20"
							viewBox="0 0 60 20"
							className="tufte-sparkline"
						>
							<polyline
								points={sparklinePoints(cumulativeNet(data.trends), 60, 20)}
								fill="none"
								stroke="currentColor"
								className="text-chart-2"
								strokeWidth={1.5}
							/>
						</svg>
					)}
				</div>
				{(
					[
						["totalReturn", investments.totalReturn],
						["periodReturn", investments.periodReturn],
					] as const
				).map(
					([key, value]) =>
						value !== null && (
							<div key={key} className="tufte-metric-card tufte-metric-card-sm">
								<span className="tufte-metric-card-label">
									{t(`reports.print.investments.${key}`)}
								</span>
								<span className={`tufte-metric-card-value ${colour(value.trend)}`}>
									{value.gain >= 0 ? "+" : ""}
									{money(value.gain)}
								</span>
								<span className={`tufte-metric-card-change ${colour(value.trend)}`}>
									{formatReturnPercent(t, value.percent)}
								</span>
							</div>
						),
				)}
				{(
					[
						["contributions", investments.activity.contributions, "tufte-income"],
						["withdrawals", investments.activity.withdrawals, "tufte-expense"],
					] as const
				).map(([key, amount, tone]) => (
					<div key={key} className="tufte-metric-card tufte-metric-card-sm">
						<span className="tufte-metric-card-label">{t(`reports.print.investments.${key}`)}</span>
						<span className={`tufte-metric-card-value ${tone}`}>{money(amount)}</span>
						<span className="tufte-metric-card-change tufte-secondary">
							{t("reports.print.investments.thisPeriod")}
						</span>
					</div>
				))}
			</div>
			{investments.holdings.length > 0 && (
				<>
					<h3 className="tufte-subsection">{t("reports.print.investments.topHoldings")}</h3>
					<table className="tufte-table tufte-compact">
						<thead>
							<tr>
								{(["holding", "weight", "value", "return"] as const).map((key, index) => (
									<th key={key} className={index === 0 ? undefined : "tufte-right"}>
										{t(`reports.print.investments.${key}`)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{investments.holdings.map((holding) => (
								<tr key={holding.security.id}>
									<td>
										<strong>{holding.security.ticker}</strong>{" "}
										<span className="tufte-muted">{name(holding.security.name)}</span>
									</td>
									<td className="tufte-right">{formatShare(holding.weight ?? "0")}</td>
									<td className="tufte-right">{money(holding.amount)}</td>
									<td
										className={`tufte-right ${holding.returnTrend === null ? "tufte-muted" : colour(holding.returnTrend)}`}
									>
										{holding.returnPercent === null
											? t("reports.investments.noData")
											: formatReturnPercent(t, holding.returnPercent)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
			<LeftOutNotice accounts={investments.leftOut} />
		</section>
	);
}
