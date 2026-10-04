import type { BudgetData } from "@/hooks/useBudget";

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { monthSchema } from "@archant/api/schemas/reports";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { BudgetAllocation } from "@/components/BudgetAllocation";
import { BudgetCategoryField, UncategorisedField } from "@/components/BudgetCategoryField";
import { BudgetOutOfRange } from "@/components/BudgetMonthPicker";
import { BudgetSteps } from "@/components/BudgetSteps";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudget } from "@/hooks/useBudget";
import { errorCodeOf } from "@/lib/api";
import { ofMonth, toIsoMonth } from "@/lib/dates";

export const Route = createFileRoute("/_authed/budgets/$month_/categories")({
	component: BudgetCategoriesPage,
});

/**
 * Sure's categories step: the share of the total allocated, then each expense
 * category's amount, parents by name with their children under them, and
 * « Sans catégorie », which takes what is left. « Valider » returns to the
 * month, and waits while the categories take more than the total.
 */
function Allocation({ budget, currency }: { budget: BudgetData; currency: CurrencyCode }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const overAllocated = budget.allocated > (budget.budgetedSpending ?? 0);
	const nameOf = new Map(budget.categories.map((line) => [line.categoryId, line.name]));

	return (
		<Section title={t("budgets.steps.categories")}>
			<div className="flex flex-col gap-6 p-4">
				<BudgetAllocation budget={budget} />
				{budget.categories.length === 0 ? (
					<div className="flex flex-col items-start gap-3">
						<p className="text-sm text-muted-foreground">{t("budgets.allocation.noCategories")}</p>
						<Button variant="outline" asChild>
							<Link to="/settings/categories">{t("budgets.allocation.settings")}</Link>
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-4">
						{budget.categories.map((line) => (
							<BudgetCategoryField
								key={line.categoryId}
								month={budget.month}
								currency={currency}
								line={line}
								parentName={line.parentId === null ? null : (nameOf.get(line.parentId) ?? null)}
								categories={budget.categories}
							/>
						))}
						<UncategorisedField
							currency={currency}
							amount={budget.uncategorised.budgetedSpending}
							median={budget.uncategorised.median}
							name={t("dashboard.cashFlow.uncategorised")}
							color="var(--muted-foreground)"
						/>
					</div>
				)}
				{/* The medians beside each amount leave these accounts out. */}
				<LeftOutNotice accounts={budget.leftOut} />
				<div className="flex flex-col items-end gap-2">
					<Button
						type="button"
						disabled={overAllocated}
						aria-describedby={overAllocated ? "budget-confirm-hint" : undefined}
						onClick={() =>
							void navigate({ to: "/budgets/$month", params: { month: budget.month } })
						}
					>
						{t("budgets.allocation.confirm")}
					</Button>
					{overAllocated && (
						<p id="budget-confirm-hint" className="text-sm text-muted-foreground">
							{t("budgets.allocation.confirmHint")}
						</p>
					)}
				</div>
			</div>
		</Section>
	);
}

/** `/budgets/:month/categories`: the budget's second step, once the month is set up. */
function BudgetCategoriesPage() {
	const { t } = useTranslation();
	const { month } = Route.useParams();
	const budget = useBudget(month);
	const valid = monthSchema.safeParse(month).success;
	const data = budget.data;
	const title = valid
		? t("budgets.allocation.title", { ofMonth: ofMonth(month) })
		: t("nav.budgets");
	const code = budget.isError ? errorCodeOf(budget.error) : null;
	// A failed refetch keeps the fields rather than stacking an error under them.
	const outOfRange = data === undefined && (code === "NOT_FOUND" || code === "VALIDATION_ERROR");
	const failed = data === undefined && budget.isError && !outOfRange;
	const currency = data?.currency;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	return (
		<Page title={title} description={t("budgets.allocation.description")} centred>
			<BudgetSteps budget={data} current="categories" />

			{budget.isPending && <Skeleton className="h-96 w-full rounded-xl" aria-hidden="true" />}

			{outOfRange && (
				<BudgetOutOfRange
					action={
						<Button variant="outline" asChild>
							<Link to="/budgets/$month" params={{ month: toIsoMonth() }}>
								{t("budgets.today")}
							</Link>
						</Button>
					}
				/>
			)}

			{failed && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(budget.error)}`)}</p>
					<Button variant="outline" onClick={() => void budget.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && !data.setUp && (
				<div className="flex flex-col items-start gap-3 rounded-xl border p-8">
					<p className="text-muted-foreground">{t("budgets.allocation.notSetUp")}</p>
					<Button asChild>
						<Link to="/budgets/$month/edit" params={{ month }}>
							{t("budgets.notSetUp.action")}
						</Link>
					</Button>
				</div>
			)}

			{data !== undefined && data.setUp && currency !== undefined && isCurrencyCode(currency) && (
				<Allocation key={month} budget={data} currency={currency} />
			)}
		</Page>
	);
}
