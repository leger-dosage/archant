import type { BudgetData } from "@/hooks/useBudget";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { BudgetFormInput } from "@archant/api/schemas/budgets";
import { budgetSchema } from "@archant/api/schemas/budgets";
import { monthSchema } from "@archant/api/schemas/reports";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { BudgetOutOfRange } from "@/components/BudgetMonthPicker";
import { FieldMessage } from "@/components/FieldMessage";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudget, useSaveBudget } from "@/hooks/useBudget";
import { amountToText } from "@/lib/amount-sign";
import { ApiError, errorCodeOf } from "@/lib/api";
import { ofMonth, toIsoMonth } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

export const Route = createFileRoute("/_authed/budgets/$month_/edit")({
	component: BudgetEditPage,
});

const FIELD_NAMES = ["budgetedSpending", "expectedIncome"] as const;

const textOf = (amount: MinorUnits | null, currency: string) =>
	amount === null ? "" : amountToText(amount, currency);

/**
 * Sure's budget form, its first step: the planned spending and the expected
 * income, both required, and « Suggérer », which fills each with the median
 * of the earlier months as Sure's autosuggest does.
 */
function BudgetForm({ budget, currency }: { budget: BudgetData; currency: CurrencyCode }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const saveBudget = useSaveBudget(budget.month);
	const schema = useMemo(() => budgetSchema(currency), [currency]);
	const form = useForm<BudgetFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the reporting currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: {
			budgetedSpending: textOf(budget.budgetedSpending, currency),
			expectedIncome: textOf(budget.expectedIncome, currency),
		},
	});
	const { errors, isSubmitting } = form.formState;
	const { suggested } = budget;

	const suggest = () => {
		for (const [name, amount] of [
			["budgetedSpending", suggested.spending],
			["expectedIncome", suggested.income],
		] as const) {
			if (amount !== null) {
				form.setValue(name, textOf(amount, currency), { shouldDirty: true });
				form.clearErrors(name);
			}
		}
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			await saveBudget.mutateAsync(values);
			// No success toast: the month's page, with its donut, says it.
			await navigate({ to: "/budgets/$month", params: { month: budget.month } });
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}
		}
	});

	const field = (name: (typeof FIELD_NAMES)[number], label: string) => (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={`budget-${name}`}>{label}</Label>
			<Input
				id={`budget-${name}`}
				inputMode="decimal"
				autoComplete="off"
				className="text-right tabular-nums"
				aria-invalid={errors[name] !== undefined}
				{...(errors[name] === undefined ? {} : { "aria-describedby": `budget-${name}-error` })}
				{...form.register(name)}
			/>
			<FieldMessage id={`budget-${name}-error`} error={errors[name]} />
		</div>
	);

	const noSuggestion = suggested.spending === null && suggested.income === null;

	return (
		<Section title={t("budgets.form.step")}>
			<form noValidate className="flex flex-col gap-4 p-4" onSubmit={(event) => void submit(event)}>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{field("budgetedSpending", t("budgets.form.budgetedSpending"))}
					{field("expectedIncome", t("budgets.form.expectedIncome"))}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={noSuggestion}
						aria-describedby="budget-suggest-hint"
						onClick={suggest}
					>
						<SparklesIcon aria-hidden="true" />
						{t("budgets.form.suggest")}
					</Button>
					<p id="budget-suggest-hint" className="text-sm text-muted-foreground">
						{t(noSuggestion ? "budgets.form.noSuggestion" : "budgets.form.suggestHint")}
					</p>
				</div>
				<LeftOutNotice accounts={budget.leftOut} />
				<div className="flex justify-end gap-2">
					<Button variant="outline" asChild>
						<Link to="/budgets/$month" params={{ month: budget.month }}>
							{t("common.cancel")}
						</Link>
					</Button>
					<Button type="submit" disabled={isSubmitting}>
						{t("budgets.form.save")}
					</Button>
				</div>
			</form>
		</Section>
	);
}

/** `/budgets/:month/edit`: sets up a month, or changes its two amounts. */
function BudgetEditPage() {
	const { t } = useTranslation();
	const { month } = Route.useParams();
	const budget = useBudget(month);
	const valid = monthSchema.safeParse(month).success;
	const data = budget.data;
	const title = valid
		? t(data?.setUp === true ? "budgets.form.editTitle" : "budgets.form.setUpTitle", {
				ofMonth: ofMonth(month),
			})
		: t("nav.budgets");
	const code = budget.isError ? errorCodeOf(budget.error) : null;
	// A failed refetch keeps the form rather than stacking an error under it.
	const outOfRange = data === undefined && (code === "NOT_FOUND" || code === "VALIDATION_ERROR");
	const failed = data === undefined && budget.isError && !outOfRange;
	const currency = data?.currency;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	return (
		<Page title={title} description={t("budgets.form.description")} centred>
			{budget.isPending && <Skeleton className="h-56 w-full rounded-xl" aria-hidden="true" />}

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

			{data !== undefined && currency !== undefined && isCurrencyCode(currency) && (
				<BudgetForm key={month} budget={data} currency={currency} />
			)}
		</Page>
	);
}
