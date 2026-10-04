import type { CashFlowSegment } from "@/components/CashFlowChart";
import type { BudgetData } from "@/hooks/useBudget";

import { Link } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { ofMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

const DONUT_SIZE = 224;

// The same lazy ring as the dashboard's donut: recharts arrives after the figures.
const CashFlowChart = lazy(async () => ({
	default: (await import("@/components/CashFlowChart")).CashFlowChart,
}));

const UNUSED_FILL = "var(--inset)";

/**
 * Sure's `to_donut_segments_json`: what each top-level expense category spent,
 * in its colour, then what is left of the budget in grey. A budget of zero
 * with nothing spent is one grey ring.
 */
function segmentsOf(budget: BudgetData, budgeted: MinorUnits): CashFlowSegment[] {
	const spent = budget.segments.map((segment) => ({
		key: segment.categoryId ?? "uncategorised",
		value: segment.spent,
		fill: segment.color ?? "var(--muted-foreground)",
	}));
	const unused = budgeted - budget.actual.spending;

	if (unused > 0 || spent.length === 0) {
		return [...spent, { key: "unused", value: Math.max(unused, 1), fill: UNUSED_FILL }];
	}

	return spent;
}

/**
 * Sure's `_budget_donut` for a month set up: a ring of the month's spending
 * by top-level expense category against its budget, and in its centre what
 * was spent, in the destructive colour once over budget, « sur » the budget
 * with a link to edit it. The ring is one image to assistive technology,
 * named by a sentence; the centre's figures and link stay readable apart.
 */
export function BudgetDonut({ budget }: { budget: BudgetData }) {
	const { t } = useTranslation();
	const budgeted = toMinorUnits(budget.budgetedSpending ?? 0);
	const spent = budget.actual.spending;
	const over = spent > budgeted;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });
	const values = {
		ofMonth: ofMonth(budget.month),
		spent: money(spent),
		budget: money(budgeted),
		count: budget.segments.length,
	};

	return (
		<Section title={t("budgets.donut.title")}>
			<div className="flex justify-center p-6">
				<div className="relative" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
					<div
						role="img"
						aria-label={t(
							budget.segments.length === 0 ? "budgets.donut.labelEmpty" : "budgets.donut.label",
							values,
						)}
						className="absolute inset-0"
					>
						<Suspense fallback={null}>
							<CashFlowChart segments={segmentsOf(budget, budgeted)} size={DONUT_SIZE} />
						</Suspense>
					</div>
					<div
						data-slot="donut-centre"
						className="absolute inset-0 flex flex-col items-center justify-center gap-1"
					>
						<span className="text-sm text-muted-foreground">{t("budgets.donut.spent")}</span>
						<Money
							amount={spent}
							currency={budget.currency}
							className={cn("text-2xl", over && "text-destructive")}
						/>
						<Link
							to="/budgets/$month/edit"
							params={{ month: budget.month }}
							className="flex items-center gap-1 rounded-sm text-sm text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							{t("budgets.donut.of", { amount: values.budget })}
							<PencilIcon aria-hidden="true" className="size-3.5" />
							<span className="sr-only">{t("budgets.donut.edit")}</span>
						</Link>
					</div>
				</div>
			</div>
		</Section>
	);
}
