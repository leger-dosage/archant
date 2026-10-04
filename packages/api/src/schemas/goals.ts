import { z } from "zod";

import { CATEGORY_COLORS, CATEGORY_ICONS } from "@archant/data/category-presets";
import { GOAL_NAME_MAX_LENGTH, GOAL_NOTES_MAX_LENGTH } from "@archant/data/goals";
import type { CurrencyCode } from "@archant/data/money";

import { amountIn } from "./budgets.ts";

// What the route checks before the service parses the amounts in the goal's
// currency, which the first linked account decides on creation: every field
// is text, as typed, so a JavaScript number never rounds an amount.
export const goalBodySchema = z.object({
	name: z.string(),
	targetAmount: z.string(),
	targetDate: z.string().nullable(),
	color: z.string(),
	icon: z.string(),
	notes: z.string().nullable(),
	accounts: z.array(z.object({ accountId: z.string(), allocatedAmount: z.string() })),
});

export type GoalInput = z.input<typeof goalBodySchema>;

/** Text no longer than `max`, refused as `too_long`, the code the form names. */
function atMost(max: number) {
	return (value: string, context: z.RefinementCtx) => {
		if (value.length > max) {
			context.addIssue({ code: "custom", message: "too_long" });
		}
	};
}

/** Blank is no value. */
const blankAsNull = (value: string | null) => (value === null || value === "" ? null : value);

/**
 * A goal as the dialog and the API read it, Sure's form: a name, a target
 * above zero, an optional date, a colour and an icon, notes, and the linked
 * accounts, each with a fixed amount or, left blank, its whole balance.
 * Built per currency, the goal's, and shared with the interface's form
 * resolver, so both report the same field codes. Whether an account exists,
 * may back a goal, holds the goal's currency or is taken whole already needs
 * the database: the service checks it.
 */
export function goalSchema(currency: CurrencyCode) {
	return z.object({
		// NFC: a pasted « Été » may arrive decomposed.
		name: z
			.string()
			.trim()
			.transform((value) => value.normalize("NFC"))
			.pipe(z.string().min(1).superRefine(atMost(GOAL_NAME_MAX_LENGTH))),
		targetAmount: z.string().trim().transform(amountIn(currency, true)),
		targetDate: z.string().trim().nullable().transform(blankAsNull).pipe(z.iso.date().nullable()),
		color: z.enum(CATEGORY_COLORS),
		icon: z.enum(CATEGORY_ICONS),
		notes: z
			.string()
			.trim()
			.nullable()
			.transform(blankAsNull)
			.pipe(z.string().superRefine(atMost(GOAL_NOTES_MAX_LENGTH)).nullable()),
		accounts: z
			.array(
				z.object({
					accountId: z.string().min(1),
					allocatedAmount: z
						.string()
						.trim()
						.transform((text, context) => (text === "" ? null : amountIn(currency)(text, context))),
				}),
			)
			.superRefine((links, context) => {
				if (links.length === 0) {
					context.addIssue({ code: "custom", message: "no_account" });
				}

				const seen = new Set<string>();

				for (const [index, { accountId }] of links.entries()) {
					if (seen.has(accountId)) {
						context.addIssue({
							code: "custom",
							path: [index, "accountId"],
							message: "duplicate_account",
						});
					}

					seen.add(accountId);
				}
			}),
	});
}

/** What the dialog's form holds: the text typed, before the schema parses it. */
export type GoalFormInput = z.input<ReturnType<typeof goalSchema>>;

export type GoalRequest = z.output<ReturnType<typeof goalSchema>>;
