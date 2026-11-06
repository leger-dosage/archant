import type { ReportsPageData } from "@/hooks/useReportsPage";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { formatSignedMoney } from "@/lib/balance-change";
import { longDate, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format-money";
import { formatChangePercent, formatTenthPercent, formatWholePercent } from "@/lib/percent";
import {
	averageOf,
	cumulativeNet,
	savingsRate,
	shareOf,
	shortMonth,
	sparklinePoints,
} from "@/lib/reports";

/** Sure's `print.html.erb` lists the eight largest categories of each side. */
const TOP_CATEGORIES = 8;

/** Sure's `layouts/print`: the dialog opens half a second after the page, once its styles apply. */
const PRINT_DELAY_MS = 500;

const GREEN = "#047857";
const RED = "#b91c1c";

function Sparkline({
	values,
	colour,
	width = 60,
	height = 20,
}: {
	values: readonly number[];
	colour: string;
	width?: number;
	height?: number;
}) {
	return (
		<svg
			aria-hidden="true"
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className="tufte-sparkline"
		>
			<polyline
				points={sparklinePoints(values, width, height)}
				fill="none"
				stroke={colour}
				strokeWidth={1.5}
			/>
		</svg>
	);
}

type Group = ReportsPageData["breakdown"]["income"][number];

function SpendingTable({
	title,
	groups,
	currency,
	tone,
}: {
	title: string;
	groups: readonly Group[];
	currency: string;
	tone: "tufte-income" | "tufte-expense";
}) {
	const { t } = useTranslation();
	const total = toMinorUnits(groups.reduce((sum, group) => sum + group.total, 0));
	const nameOf = (group: Group) =>
		group.kind === "uncategorized"
			? t("reports.breakdown.uncategorized")
			: group.kind === "other_investments"
				? t("reports.breakdown.otherInvestments")
				: (group.name ?? "");

	return (
		<div>
			<h3 className="tufte-subsection">
				{title} <span className={tone}>{formatMoney({ amount: total, currency })}</span>
			</h3>
			<table className="tufte-table tufte-compact">
				<thead>
					<tr>
						<th>{t("reports.print.spending.category")}</th>
						<th className="tufte-right">{t("reports.print.spending.amount")}</th>
						<th className="tufte-right">{t("reports.print.spending.percent")}</th>
					</tr>
				</thead>
				<tbody>
					{groups.slice(0, TOP_CATEGORIES).map((group) => (
						<tr key={`${group.kind}-${group.categoryId}`}>
							<td>
								<span
									className="tufte-dot"
									style={{
										background:
											group.kind === "other_investments" ? "#e99537" : (group.color ?? "#737373"),
									}}
								/>
								{nameOf(group)}
							</td>
							<td className="tufte-right">{formatMoney({ amount: group.total, currency })}</td>
							<td className="tufte-right tufte-muted">
								{formatWholePercent(shareOf(group.total, total, 0))}
							</td>
						</tr>
					))}
					{groups.length > TOP_CATEGORIES && (
						<tr>
							<td className="tufte-muted">
								{t("reports.print.spending.moreCategories", {
									count: groups.length - TOP_CATEGORIES,
								})}
							</td>
							<td />
							<td />
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * Sure's « Rapport financier », its Tufte print layout on A4: the summary
 * with sparklines, the net worth, the monthly trends and the eight largest
 * categories of each side. It opens the print dialog once drawn, as Sure's
 * layout does.
 */
export function ReportPrint({ data }: { data: ReportsPageData }) {
	const { t } = useTranslation();
	const { summary, currency, trends, netWorth, breakdown, period } = data;
	const sparkable = trends.length >= 2;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency });
	const savings = savingsRate({ income: summary.income, net: summary.netSavings }, 0);
	const totals = trends.reduce(
		(sum, trend) => ({
			income: toMinorUnits(sum.income + trend.income),
			net: toMinorUnits(sum.net + trend.net),
		}),
		{ income: toMinorUnits(0), net: toMinorUnits(0) },
	);

	useEffect(() => {
		document.title = `${t("reports.print.title")} - ${longDate(period.from)} – ${longDate(period.to)}`;
	}, [t, period.from, period.to]);

	// Once per tab: a language change redraws the page, never the dialog.
	const printScheduled = useRef(false);

	useEffect(() => {
		if (printScheduled.current) {
			return undefined;
		}

		printScheduled.current = true;
		const timer = setTimeout(() => window.print(), PRINT_DELAY_MS);

		return () => {
			clearTimeout(timer);
			printScheduled.current = false;
		};
	}, []);

	const changeLine = (percent: number, good: boolean) =>
		percent === 0 ? null : (
			<span className={`tufte-metric-card-change ${good ? "tufte-up" : "tufte-down"}`}>
				{t("reports.print.summary.vsPrior", { percent: formatChangePercent(percent) })}
			</span>
		);

	return (
		<main className="print-body">
			<div className="print-container">
				<div className="tufte-report">
					<header className="tufte-header">
						<h1 className="tufte-title">{t("reports.print.title")}</h1>
						<span className="tufte-period">
							{longDate(period.from)} – {longDate(period.to)}
						</span>
						<p className="tufte-meta">
							{t("app.name")} · {t("reports.print.generatedOn", { date: longDate(data.today) })}
						</p>
					</header>

					<section className="tufte-section">
						<h2 className="tufte-section-title">{t("reports.print.summary.title")}</h2>
						<div className="tufte-metric-row">
							<div className="tufte-metric-card tufte-metric-card-sm">
								<span className="tufte-metric-card-label">{t("reports.print.summary.income")}</span>
								<span className="tufte-metric-card-value tufte-income">
									{money(summary.income)}
								</span>
								{changeLine(summary.incomeChange, summary.incomeChange >= 0)}
								{sparkable && (
									<Sparkline values={trends.map((trend) => trend.income)} colour={GREEN} />
								)}
							</div>
							<div className="tufte-metric-card tufte-metric-card-sm">
								<span className="tufte-metric-card-label">
									{t("reports.print.summary.expenses")}
								</span>
								<span className="tufte-metric-card-value tufte-expense">
									{money(summary.expenses)}
								</span>
								{changeLine(summary.expenseChange, summary.expenseChange < 0)}
								{sparkable && (
									<Sparkline values={trends.map((trend) => trend.expenses)} colour={RED} />
								)}
							</div>
							<div className="tufte-metric-card tufte-metric-card-sm">
								<span className="tufte-metric-card-label">
									{t("reports.print.summary.netSavings")}
								</span>
								<span
									className={`tufte-metric-card-value ${summary.netSavings >= 0 ? "tufte-income" : "tufte-expense"}`}
								>
									{money(summary.netSavings)}
								</span>
								{savings !== 0 && (
									<span className="tufte-metric-card-change tufte-secondary">
										{t("reports.print.summary.ofIncome", { percent: formatWholePercent(savings) })}
									</span>
								)}
								{sparkable && (
									<Sparkline
										values={trends.map((trend) => trend.net)}
										colour={summary.netSavings >= 0 ? GREEN : RED}
									/>
								)}
							</div>
							{summary.budgetPercent !== null && (
								<div className="tufte-metric-card tufte-metric-card-sm">
									<span className="tufte-metric-card-label">
										{t("reports.print.summary.budget")}
									</span>
									<span className="tufte-metric-card-value">
										{formatTenthPercent(summary.budgetPercent)}
									</span>
									<span className="tufte-metric-card-change tufte-secondary">
										{t("reports.print.summary.used")}
									</span>
								</div>
							)}
						</div>
					</section>

					{data.hasAccounts && (
						<section className="tufte-section">
							<h2 className="tufte-section-title">{t("reports.print.netWorth.title")}</h2>
							<div className="tufte-metric-row">
								<div className="tufte-metric-card">
									<span className="tufte-metric-card-label">
										{t("reports.print.netWorth.currentBalance")}
									</span>
									<span
										className={`tufte-metric-card-value ${netWorth.netWorth >= 0 ? "tufte-income" : "tufte-expense"}`}
									>
										{money(netWorth.netWorth)}
									</span>
									{netWorth.change !== null && netWorth.change.amount !== 0 && (
										<span
											className={`tufte-metric-card-change ${netWorth.change.amount > 0 ? "tufte-up" : "tufte-down"}`}
										>
											{formatSignedMoney(netWorth.change.amount, currency)}
											{netWorth.change.percent === null
												? ""
												: ` (${formatChangePercent(netWorth.change.percent)})`}{" "}
											{t("reports.print.netWorth.thisPeriod")}
										</span>
									)}
									{sparkable && (
										<Sparkline
											values={cumulativeNet(trends)}
											colour={netWorth.netWorth >= 0 ? GREEN : RED}
											width={80}
											height={24}
										/>
									)}
								</div>
							</div>
							<div className="tufte-two-col">
								<div>
									<h3 className="tufte-subsection">
										{t("reports.print.netWorth.assets")}{" "}
										<span className="tufte-income">{money(netWorth.assets)}</span>
									</h3>
									{netWorth.groups.asset.length > 0 && (
										<table className="tufte-table tufte-compact">
											<tbody>
												{netWorth.groups.asset.map((group) => (
													<tr key={group.type}>
														<td>{t(`dashboard.balanceSheet.types.${group.type}`)}</td>
														<td className="tufte-right">{money(group.total)}</td>
													</tr>
												))}
											</tbody>
										</table>
									)}
								</div>
								<div>
									<h3 className="tufte-subsection">
										{t("reports.print.netWorth.liabilities")}{" "}
										<span className="tufte-expense">{money(netWorth.liabilities)}</span>
									</h3>
									{netWorth.groups.liability.length > 0 ? (
										<table className="tufte-table tufte-compact">
											<tbody>
												{netWorth.groups.liability.map((group) => (
													<tr key={group.type}>
														<td>{t(`dashboard.balanceSheet.types.${group.type}`)}</td>
														<td className="tufte-right">{money(group.total)}</td>
													</tr>
												))}
											</tbody>
										</table>
									) : (
										<p className="tufte-muted">{t("reports.print.netWorth.noLiabilities")}</p>
									)}
								</div>
							</div>
						</section>
					)}

					{sparkable && (
						<section className="tufte-section">
							<h2 className="tufte-section-title">{t("reports.print.trends.title")}</h2>
							<table className="tufte-table">
								<thead>
									<tr>
										<th>{t("reports.print.trends.month")}</th>
										<th className="tufte-right">{t("reports.print.trends.income")}</th>
										<th className="tufte-right">{t("reports.print.trends.expenses")}</th>
										<th className="tufte-right">{t("reports.print.trends.net")}</th>
										<th className="tufte-right">{t("reports.print.trends.savingsRate")}</th>
									</tr>
								</thead>
								<tbody>
									{trends.map((trend) => (
										<tr key={trend.month} className={trend.current ? "tufte-highlight" : undefined}>
											<td>
												{shortMonth(trend.month)}
												{trend.current ? " *" : ""}
											</td>
											<td className="tufte-right tufte-income">{money(trend.income)}</td>
											<td className="tufte-right tufte-expense">{money(trend.expenses)}</td>
											<td
												className={`tufte-right ${trend.net >= 0 ? "tufte-income" : "tufte-expense"}`}
											>
												{money(trend.net)}
											</td>
											<td className="tufte-right">{formatWholePercent(savingsRate(trend, 0))}</td>
										</tr>
									))}
								</tbody>
								<tfoot>
									<tr>
										<td>{t("reports.print.trends.average")}</td>
										<td className="tufte-right tufte-income">
											{money(averageOf(trends, (trend) => trend.income))}
										</td>
										<td className="tufte-right tufte-expense">
											{money(averageOf(trends, (trend) => trend.expenses))}
										</td>
										<td
											className={`tufte-right ${averageOf(trends, (trend) => trend.net) >= 0 ? "tufte-income" : "tufte-expense"}`}
										>
											{money(averageOf(trends, (trend) => trend.net))}
										</td>
										<td className="tufte-right">{formatWholePercent(savingsRate(totals, 0))}</td>
									</tr>
								</tfoot>
							</table>
							{trends.some((trend) => trend.current) && (
								<p className="tufte-footnote">{t("reports.print.trends.currentMonthNote")}</p>
							)}
						</section>
					)}

					{(breakdown.income.length > 0 || breakdown.expense.length > 0) && (
						<section className="tufte-section tufte-keep-together">
							<h2 className="tufte-section-title">{t("reports.print.spending.title")}</h2>
							<div className="tufte-two-col">
								{breakdown.income.length > 0 && (
									<SpendingTable
										title={t("reports.print.spending.income")}
										groups={breakdown.income}
										currency={currency}
										tone="tufte-income"
									/>
								)}
								{breakdown.expense.length > 0 && (
									<SpendingTable
										title={t("reports.print.spending.expenses")}
										groups={breakdown.expense}
										currency={currency}
										tone="tufte-expense"
									/>
								)}
							</div>
						</section>
					)}

					<footer className="tufte-footer">
						{t("app.name")} · {monthLabel(period.from.slice(0, 7))} –{" "}
						{monthLabel(period.to.slice(0, 7))}
					</footer>
				</div>
			</div>
		</main>
	);
}
