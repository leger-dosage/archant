import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";

import { monthSchema } from "./reports.ts";

export const budgetParamSchema = z.object({ month: monthSchema });

// What the route checks before the service parses the amounts in the
// reporting currency: both fields are text, so the typed client knows the
// body's shape, and a JavaScript number would already have rounded the input.
export const budgetBodySchema = z.object({
	budgetedSpending: z.string(),
	expectedIncome: z.string(),
});

export type BudgetInput = z.input<typeof budgetBodySchema>;

/** An amount the household plans: required, and never negative. */
function plannedAmount(currency: CurrencyCode) {
	return z.string().trim().min(1).transform(amountIn(currency));
}

/**
 * Reads typed text as minor units of `currency`, refusing what is unreadable
 * or negative; zero too when `positive`, as money moved must be some.
 */
function amountIn(currency: CurrencyCode, positive = false) {
	return (text: string, context: z.RefinementCtx) => {
		const amount = parseAmount(text, currency);

		if (amount === null) {
			context.addIssue({ code: "custom", message: "invalid_amount" });

			return z.NEVER;
		}

		if (positive ? amount <= 0 : amount < 0) {
			context.addIssue({ code: "custom", message: positive ? "not_positive" : "negative_amount" });

			return z.NEVER;
		}

		return amount;
	};
}

/**
 * A month's planned spending and expected income, both required, as Sure's
 * budget form. Built per currency and shared with the interface's form
 * resolver, so both report the same field codes.
 */
export function budgetSchema(currency: CurrencyCode) {
	return z.object({
		budgetedSpending: plannedAmount(currency),
		expectedIncome: plannedAmount(currency),
	});
}

/** What the interface's form holds: the text typed, before the schema parses it. */
export type BudgetFormInput = z.input<ReturnType<typeof budgetSchema>>;

export const budgetCategoryParamSchema = z.object({
	month: monthSchema,
	categoryId: z.string().min(1),
});

// Text, as `budgetBodySchema`: the service parses it in the reporting currency.
export const budgetCategoryBodySchema = z.object({ budgetedSpending: z.string() });

export type BudgetCategoryInput = z.input<typeof budgetCategoryBodySchema>;

/**
 * One category's amount for the month. Blank is 0, as Sure's `.presence || 0`:
 * a subcategory left blank shares its parent's amount. Shared with the
 * interface's field, so both report the same codes.
 */
export function budgetCategorySchema(currency: CurrencyCode) {
	return z.object({
		budgetedSpending: z
			.string()
			.trim()
			.transform((text, context) =>
				text === "" ? toMinorUnits(0) : amountIn(currency)(text, context),
			),
	});
}

// Text, as `budgetBodySchema`: the service parses the amount in the reporting currency.
export const budgetMoveBodySchema = z.object({
	fromCategoryId: z.string(),
	toCategoryId: z.string(),
	amount: z.string(),
});

export type BudgetMoveInput = z.input<typeof budgetMoveBodySchema>;

/**
 * Money moved from one category to another, as Sure's move dialog: the
 * amount is required and above zero. What the source can give, and which
 * destinations it may reach, need the month's amounts: the service checks
 * them. Shared with the interface's dialog, so both report the same codes.
 */
export function budgetMoveSchema(currency: CurrencyCode) {
	return z.object({
		fromCategoryId: z.string().min(1),
		toCategoryId: z.string().min(1),
		amount: z.string().trim().min(1).transform(amountIn(currency, true)),
	});
}

/** What the move dialog's form holds: the text typed, before the schema parses it. */
export type BudgetMoveFormInput = z.input<ReturnType<typeof budgetMoveSchema>>;
