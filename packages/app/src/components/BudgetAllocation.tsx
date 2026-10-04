import type { BudgetData } from "@/hooks/useBudget";

import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { cn } from "@/lib/utils";

const percentFormat = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	maximumFractionDigits: 0,
});

/**
 * Sure's `_allocation_progress`: the share of the month's total the
 * categories take, as a sentence, the two amounts and a bar, then what is
 * left to allocate, or by how much the categories pass the total. The bar
 * repeats the sentence, so it is hidden from assistive technology; the
 * sentences are announced as they change.
 */
export function BudgetAllocation({ budget }: { budget: BudgetData }) {
	const { t } = useTranslation();
	const total = toMinorUnits(budget.budgetedSpending ?? 0);
	const over = budget.allocated > total;
	const share = total > 0 ? Math.min(budget.allocated / total, 1) : 0;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });

	return (
		<div data-slot="budget-allocation" className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span
					aria-hidden="true"
					className={cn(
						"size-1.5 rounded-full",
						over ? "bg-destructive" : budget.allocated > 0 ? "bg-foreground" : "bg-inset",
					)}
				/>
				<p aria-live="polite" className={cn(!over && "text-muted-foreground")}>
					{over
						? t("budgets.allocation.over")
						: t("budgets.allocation.percent", { percent: percentFormat.format(share) })}
				</p>
				<p className="ml-auto tabular-nums">
					{t("budgets.allocation.of", {
						allocated: money(budget.allocated),
						total: money(total),
					})}
				</p>
			</div>
			<div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-inset">
				<div
					className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-foreground")}
					style={{ width: `${over ? 100 : share * 100}%` }}
				/>
			</div>
			<p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
				{over
					? t("budgets.allocation.exceeded", {
							amount: money(toMinorUnits(budget.allocated - total)),
						})
					: t("budgets.allocation.left", { amount: money(toMinorUnits(total - budget.allocated)) })}
			</p>
		</div>
	);
}
