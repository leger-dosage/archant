import { Link, createFileRoute } from "@tanstack/react-router";
import { PiggyBankIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { monthSchema } from "@archant/api/schemas/reports";

import { BudgetDonut } from "@/components/BudgetDonut";
import { BudgetMonthPicker, BudgetOutOfRange } from "@/components/BudgetMonthPicker";
import { BudgetSummary } from "@/components/BudgetSummary";
import { EmptyState } from "@/components/EmptyState";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudget } from "@/hooks/useBudget";
import { errorCodeOf } from "@/lib/api";
import { ofMonth, toIsoMonth } from "@/lib/dates";

export const Route = createFileRoute("/_authed/budgets/$month")({
	component: BudgetMonthPage,
});

/**
 * Sure's budget page for one calendar month: the header with its arrows,
 * picker and « Aujourd'hui », then, once the month is set up, the donut and
 * the summary; before that, « Définir le budget ». Reading a month writes
 * nothing.
 */
function BudgetMonthPage() {
	const { t } = useTranslation();
	const { month } = Route.useParams();
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
							<BudgetDonut budget={data} />
							<BudgetSummary budget={data} />
						</div>
						<LeftOutNotice accounts={data.leftOut} />
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
