import type { BudgetData } from "@/hooks/useBudget";

import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { cn } from "@/lib/utils";

/** `part`'s share of `whole`, 0 to 100; nothing of nothing is none. */
function percent(part: number, whole: number): number {
	if (whole <= 0) {
		return 0;
	}

	return Math.min((part / whole) * 100, 100);
}

/**
 * One of the summary's two blocks: the planned figure, a bar of the actual
 * against it, and the actual beside what is left or what overflows. The bar
 * repeats the sentence under it, so it is hidden from assistive technology.
 */
function Plan({
	title,
	planned,
	actual,
	currency,
	actualText,
	remainderText,
	overText,
	overClassName,
	overFillClassName,
	fillClassName,
}: {
	title: string;
	planned: MinorUnits;
	actual: MinorUnits;
	currency: string;
	actualText: string;
	remainderText: string;
	overText: string;
	/** The colour of what overflows: the income's green, the spending's red. */
	overClassName: string;
	overFillClassName: string;
	fillClassName: string;
}) {
	const headingId = useId();
	const over = actual > planned;

	return (
		<div role="group" aria-labelledby={headingId} className="flex flex-col gap-2 p-4">
			<h3 id={headingId} className="text-sm text-muted-foreground">
				{title}
			</h3>
			<Money amount={planned} currency={currency} className="amount-summary" />
			<div aria-hidden="true" className="flex h-1.5 gap-1">
				{over ? (
					<>
						<div
							className={cn("rounded-md", fillClassName)}
							style={{ width: `${percent(planned, actual)}%` }}
						/>
						<div className={cn("flex-1 rounded-md", overFillClassName)} />
					</>
				) : (
					<>
						<div
							className={cn("rounded-md", fillClassName)}
							style={{ width: `${percent(actual, planned)}%` }}
						/>
						<div className="flex-1 rounded-md bg-inset" />
					</>
				)}
			</div>
			<div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
				<p className="text-muted-foreground">{actualText}</p>
				<p className={cn("font-medium", over && overClassName)}>
					{over ? overText : remainderText}
				</p>
			</div>
		</div>
	);
}

/**
 * Sure's `_budgeted_summary`: the expected income against what was earned,
 * then the planned spending against what was spent, each with what is left
 * or by how much it went over.
 */
export function BudgetSummary({ budget }: { budget: BudgetData }) {
	const { t } = useTranslation();
	// What is left or what overflows, both shown unsigned.
	const gap = (from: MinorUnits, to: MinorUnits) =>
		formatMoney({ amount: toMinorUnits(Math.abs(to - from)), currency: budget.currency });
	const income = {
		planned: toMinorUnits(budget.expectedIncome ?? 0),
		actual: toMinorUnits(budget.actual.income),
	};
	const spending = {
		planned: toMinorUnits(budget.budgetedSpending ?? 0),
		actual: toMinorUnits(budget.actual.spending),
	};
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });

	return (
		<Section title={t("budgets.summary.title")}>
			<div className="flex flex-col divide-y divide-line">
				<Plan
					title={t("budgets.summary.expectedIncome")}
					{...income}
					currency={budget.currency}
					actualText={t("budgets.summary.earned", { amount: money(income.actual) })}
					remainderText={t("budgets.summary.incomeLeft", {
						amount: gap(income.actual, income.planned),
					})}
					overText={t("budgets.summary.incomeOver", {
						amount: gap(income.planned, income.actual),
					})}
					overClassName="text-money-income"
					overFillClassName="bg-money-income"
					fillClassName="bg-money-income"
				/>
				<Plan
					title={t("budgets.summary.budgetedSpending")}
					{...spending}
					currency={budget.currency}
					actualText={t("budgets.summary.spent", { amount: money(spending.actual) })}
					remainderText={t("budgets.summary.left", {
						amount: gap(spending.actual, spending.planned),
					})}
					overText={t("budgets.summary.over", {
						amount: gap(spending.planned, spending.actual),
					})}
					overClassName="text-destructive"
					overFillClassName="bg-destructive"
					fillClassName="bg-foreground"
				/>
			</div>
		</Section>
	);
}
