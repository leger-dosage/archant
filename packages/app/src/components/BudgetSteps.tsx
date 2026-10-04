import type { BudgetData } from "@/hooks/useBudget";

import { Link } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type Step = "budget" | "categories";

/**
 * Sure's `_budget_nav`: « Budget » then « Catégories », each a link, the
 * current one marked `aria-current="page"` by the router, a finished one
 * ticked. « Budget » is finished once the month is set up; « Catégories »
 * once its allocation is valid, as Sure's `allocations_valid?`: something
 * allocated, never beyond the total.
 */
export function BudgetSteps({
	budget,
	current,
}: {
	budget: BudgetData | undefined;
	current: Step;
}) {
	const { t } = useTranslation();
	const month = budget?.month;
	const done = {
		budget: budget?.setUp === true,
		categories:
			budget?.setUp === true &&
			budget.allocated > 0 &&
			budget.allocated <= (budget.budgetedSpending ?? 0),
	};
	const steps = [
		{ step: "budget", to: "/budgets/$month/edit" },
		{ step: "categories", to: "/budgets/$month/categories" },
	] as const;

	if (month === undefined) {
		return null;
	}

	return (
		<nav aria-label={t("budgets.steps.label")}>
			<ol className="flex items-center gap-2">
				{steps.map(({ step, to }, index) => {
					const isCurrent = step === current;
					const isDone = done[step] && !isCurrent;
					const name = t(`budgets.steps.${step}`);

					return (
						<li key={step} className="flex items-center gap-2">
							{index > 0 && <span aria-hidden="true" className="h-px w-12 bg-line" />}
							<Link
								to={to}
								params={{ month }}
								aria-label={isDone ? t("budgets.steps.done", { step: name }) : undefined}
								className="flex items-center gap-2 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span
									aria-hidden="true"
									className={cn(
										"inline-flex size-7 shrink-0 items-center justify-center rounded-full tabular-nums",
										isCurrent ? "bg-foreground text-background" : "bg-inset",
										!isCurrent && !isDone && "text-muted-foreground",
									)}
								>
									{isDone ? <CheckIcon className="size-4" /> : index + 1}
								</span>
								<span className={cn(!isCurrent && !isDone && "text-muted-foreground")}>{name}</span>
							</Link>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
