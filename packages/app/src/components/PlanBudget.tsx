import type { BudgetData } from "@/hooks/useBudget";

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { toMinorUnits } from "@archant/data/money";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { PlanProgress } from "@/components/PlanProgress";
import { Section } from "@/components/Section";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudget } from "@/hooks/useBudget";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { errorCodeOf } from "@/lib/api";
import { formatMoney } from "@/lib/format-money";
import { budgetDaysLeft, percentOf, topBudgetCategories } from "@/lib/plan-summary";

function BudgetFigures({ budget, today }: { budget: BudgetData; today: string }) {
	const { t } = useTranslation();
	const categoriesLabel = useId();
	const categories = topBudgetCategories(budget.categories);
	const planned = toMinorUnits(budget.budgetedSpending ?? 0);
	const spent = budget.actual.spending;
	const percent = percentOf(spent, planned);

	return (
		<>
			<div className="flex flex-col gap-2">
				<p className="flex flex-wrap items-baseline gap-x-2">
					<Money amount={spent} currency={budget.currency} className="amount-hero" />
					<span className="text-muted-foreground">
						{t("plan.budget.ofTotal", {
							total: formatMoney({ amount: planned, currency: budget.currency }),
						})}
					</span>
				</p>
				<p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
					<span>{t("plan.budget.daysLeft", { count: budgetDaysLeft(today, budget.to) })}</span>
					<span aria-hidden="true">·</span>
					<span>{t("plan.budget.percentUsed", { percent: Math.round(percent) })}</span>
				</p>
				<PlanProgress percent={percent} fill={spent > planned ? "bg-destructive" : undefined} />
				<LeftOutNotice accounts={budget.leftOut} />
			</div>
			{categories.length > 0 && (
				<div className="flex flex-col gap-1">
					<h3 id={categoriesLabel} className="type-overline text-muted-foreground">
						{t("plan.budget.topCategories")}
					</h3>
					<ul aria-labelledby={categoriesLabel} className="divide-y divide-line">
						{categories.map((category) => (
							<li key={category.categoryId} className="flex items-center gap-3 py-2.5">
								<TintedIcon subject={{ kind: "category", ...category }} />
								<span className="min-w-0 flex-1 wrap-break-word">{category.name}</span>
								<span className="shrink-0 text-xs tabular-nums">
									<Money amount={category.spent} currency={budget.currency} />
									<span className="text-muted-foreground">
										{" / "}
										{formatMoney({ amount: category.budgetedSpending, currency: budget.currency })}
									</span>
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</>
	);
}

export function PlanBudget({ today }: { today: string }) {
	const { t } = useTranslation();
	const month = today.slice(0, 7);
	const budget = useBudget(month);
	const admin = useIsAdmin();

	return (
		<Section title={t("plan.budget.title")}>
			<div className="flex flex-1 flex-col gap-4 p-4">
				{budget.isPending && <Skeleton aria-hidden="true" className="h-20" />}
				{budget.isError && budget.data === undefined && (
					<div role="alert" className="space-y-2">
						<p className="text-muted-foreground">{t(`errors.${errorCodeOf(budget.error)}`)}</p>
						<Button variant="outline" onClick={() => void budget.refetch()}>
							{t("common.retry")}
						</Button>
					</div>
				)}
				{budget.data?.setUp === true && <BudgetFigures budget={budget.data} today={today} />}
				{budget.data?.setUp === false && (
					<div className="my-auto flex flex-col items-center gap-3 py-4 text-center">
						<p className="max-w-xs text-muted-foreground">{t("plan.budget.empty")}</p>
						{admin && (
							<Button asChild>
								<Link to="/budgets/$month/edit" params={{ month }}>
									{t("plan.budget.setUp")}
								</Link>
							</Button>
						)}
					</div>
				)}
				<Button variant="outline" asChild className="mt-auto w-full whitespace-normal">
					<Link to="/budgets/$month" params={{ month }}>
						{t("plan.budget.view")}
						<ChevronRightIcon aria-hidden="true" />
					</Link>
				</Button>
			</div>
		</Section>
	);
}
