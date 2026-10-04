import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

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
	return z
		.string()
		.trim()
		.min(1)
		.transform((text, context) => {
			const amount = parseAmount(text, currency);

			if (amount === null) {
				context.addIssue({ code: "custom", message: "invalid_amount" });

				return z.NEVER;
			}

			if (amount < 0) {
				context.addIssue({ code: "custom", message: "negative_amount" });

				return z.NEVER;
			}

			return amount;
		});
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
