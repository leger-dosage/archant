import type { BudgetData } from "@/hooks/useBudget";

import { Link, createFileRoute } from "@tanstack/react-router";
import { PencilIcon, PiggyBankIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { monthSchema } from "@archant/api/schemas/reports";

import { BUDGET_FILTERS, BudgetCategories } from "@/components/BudgetCategories";
import { BudgetDonut } from "@/components/BudgetDonut";
import { BudgetMonthPicker, BudgetOutOfRange } from "@/components/BudgetMonthPicker";
import { BudgetSummary } from "@/components/BudgetSummary";
import { EmptyState } from "@/components/EmptyState";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudget } from "@/hooks/useBudget";
import { errorCodeOf } from "@/lib/api";
import { ofMonth, toIsoMonth } from "@/lib/dates";

// Absent means « Toutes »; a value from an old or hand-edited link falls back to it.
const searchSchema = z.object({
	filter: z.enum(BUDGET_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/budgets/$month")({
	validateSearch: searchSchema,
	component: BudgetMonthPage,
});

/**
 * Sure's `_over_allocation_warning`, in the donut's place: the categories
 * take more than the total, so the ring would draw nothing true.
 */
function OverAllocation({ budget }: { budget: BudgetData }) {
	const { t } = useTranslation();

	return (
		<Section title={t("budgets.donut.title")}>
			<div className="flex min-h-72 flex-col items-center justify-center gap-4 p-8 text-center">
				<TriangleAlertIcon aria-hidden="true" className="size-6 text-destructive" />
				<h3 className="font-medium">{t("budgets.donut.overAllocated.title")}</h3>
				<p className="max-w-sm text-sm text-muted-foreground">
					{t("budgets.donut.overAllocated.description")}
				</p>
				<Button variant="outline" size="sm" asChild>
					<Link to="/budgets/$month/categories" params={{ month: budget.month }}>
						{t("budgets.donut.overAllocated.action")}
						<PencilIcon aria-hidden="true" />
					</Link>
				</Button>
			</div>
		</Section>
	);
}

/**
 * Sure's budget page for one calendar month: the header with its arrows,
 * picker and « Aujourd'hui », then, once the month is set up, the donut and
 * the summary, then a card per category; before that, « Définir le budget ».
 * Reading a month writes nothing.
 */
function BudgetMonthPage() {
	const { t } = useTranslation();
	const { month } = Route.useParams();
	const { filter } = Route.useSearch();
	const navigate = Route.useNavigate();
	const budget = useBudget(month);
	const current = toIsoMonth();
	const title = monthSchema.safeParse(month).success
		? t("budgets.title", { ofMonth: ofMonth(month) })
		: t("nav.budgets");
	const code = budget.isError ? errorCodeOf(budget.error) : null;
	// A malformed month is out of range too: no budget can cover it.
	const data = budget.data;
	// A failed refetch keeps the month on screen rather than stacking an error under it.
	const outOfRange = data === undefined && (code === "NOT_FOUND" || code === "VALIDATION_ERROR");
	const failed = data === undefined && budget.isError && !outOfRange;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	return (
		<Page title={title}>
			<BudgetMonthPicker
				month={month}
				current={current}
				previousMonth={data?.previousMonth ?? null}
				nextMonth={data?.nextMonth ?? null}
				bounds={data?.bounds ?? null}
			/>

			{budget.isPending && <Skeleton className="h-80 w-full rounded-xl" aria-hidden="true" />}

			{outOfRange && <BudgetOutOfRange />}

			{failed && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(budget.error)}`)}</p>
					<Button variant="outline" onClick={() => void budget.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined &&
				(data.setUp ? (
					<>
						<div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
							{data.allocated > (data.budgetedSpending ?? 0) ? (
								<OverAllocation budget={data} />
							) : (
								<BudgetDonut budget={data} />
							)}
							<BudgetSummary budget={data} />
						</div>
						<LeftOutNotice accounts={data.leftOut} />
						<BudgetCategories
							budget={data}
							filter={filter}
							onFilterChange={(next) =>
								void navigate({ search: { filter: next }, replace: true, resetScroll: false })
							}
						/>
					</>
				) : (
					<EmptyState
						icon={{ kind: "transfer", icon: PiggyBankIcon }}
						title={t("budgets.notSetUp.title")}
						description={t("budgets.notSetUp.description")}
						action={
							<Button asChild>
								<Link to="/budgets/$month/edit" params={{ month }}>
									{t("budgets.notSetUp.action")}
								</Link>
							</Button>
						}
					/>
				))}
		</Page>
	);
}
