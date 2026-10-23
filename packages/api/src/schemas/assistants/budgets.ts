import { z } from "zod";

import { monthSchema } from "../reports.ts";
import { requiredLoose, sureAmount } from "./fields.ts";

const MONTH_ABBREVIATIONS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
] as const;

/** Sure's `Budget#to_param`: "aug-2026" for "2026-08". */
export function monthParam(month: string): string {
	const [year = "", number = ""] = month.split("-");

	return `${MONTH_ABBREVIATIONS[Number(number) - 1] ?? number}-${year}`;
}

/**
 * Sure's month slug, "YYYY-MM" or "MMM-YYYY" such as "Aug-2026", as
 * "2026-08"; `null` for anything else.
 */
export function sureMonthOf(value: string): string | null {
	const named = /^([A-Za-z]{3})-(\d{4})$/u.exec(value);
	const abbreviation = named?.[1]?.toLowerCase();
	const index = MONTH_ABBREVIATIONS.findIndex((month) => month === abbreviation);
	const month = index === -1 ? value : `${named?.[2]}-${String(index + 1).padStart(2, "0")}`;

	return monthSchema.safeParse(month).success ? month : null;
}

/** Sure's month slug, read as "2026-08". */
const toolMonth = z
	.string()
	.transform((value) => sureMonthOf(value) ?? value)
	.pipe(monthSchema);

/** `get_budget`: a month's budget, and up to eleven months before it, as Sure's `GetBudget`. */
export const budgetInput = z.strictObject({
	month: toolMonth
		.optional()
		.describe('"YYYY-MM" or "MMM-YYYY" such as "Aug-2026"; the current month when absent.'),
	prior_months: z
		.number()
		.int()
		.min(0)
		.max(11)
		.default(0)
		.describe(
			"How many months before month to add, up to 11; those before the first month a budget can cover are left out.",
		),
});

const budgetAmount = (what: string) =>
	sureAmount
		.optional()
		.describe(
			`${what}, a non-negative number or decimal string such as 1500 or "1500.00" in the reporting currency; absent keeps it.`,
		);

/**
 * `update_budget`: Sure's parameters, what the budget page sets at once. The
 * month, the amounts and the category references reach `run` loosely typed,
 * which refuses them with Sure's keys in Sure's order before `updateBudget`
 * parses the amounts as the page's fields are parsed.
 */
export const updateBudgetInput = z.strictObject({
	month: z
		.string()
		.optional()
		.describe(
			'"YYYY-MM" or "MMM-YYYY" such as "Aug-2026": the month to set; the current month when absent.',
		),
	budgeted_spending: budgetAmount("The month's planned spending"),
	expected_income: budgetAmount("The month's expected income"),
	categories: z
		.array(
			z.strictObject({
				category: z
					.string()
					.optional()
					.describe(
						"A category's name, case aside, or its id, from get_categories or get_budget. « Non catégorisé » is refused: it holds what budgeted_spending leaves unallocated.",
					),
				amount: requiredLoose(sureAmount).describe(
					"The amount, a non-negative number or decimal string; 0 lets a subcategory share its parent's. A parent's amount is never below what its subcategories hold.",
				),
			}),
		)
		.optional()
		.describe(
			"Category amounts, each category once; the month must be set up, by this call or before.",
		),
});
