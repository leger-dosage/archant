import { z } from "zod";

import { CATEGORY_COLORS, CATEGORY_ICONS } from "@archant/data/category-presets";
import {
	GOAL_EVENTS,
	GOAL_KINDS,
	GOAL_NAME_MAX_LENGTH,
	GOAL_NOTES_MAX_LENGTH,
	GOAL_TARGET_MODES,
	GOAL_TARGET_MONTHS_MAX,
} from "@archant/data/goals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";

import { amountIn } from "./budgets.ts";

// What the route checks before the service parses the amounts in the goal's
// currency, which the first linked account decides on creation: every field
// is text, as typed, so a JavaScript number never rounds an amount.
export const goalBodySchema = z.object({
	name: z.string(),
	kind: z.string().optional(),
	targetMode: z.string().optional(),
	targetAmount: z.string().optional(),
	targetMonths: z.string().optional(),
	targetDate: z.string().nullable(),
	color: z.string(),
	icon: z.string().nullable(),
	notes: z.string().nullable(),
	accounts: z.array(z.object({ accountId: z.string(), allocatedAmount: z.string() })),
});

export type GoalInput = z.input<typeof goalBodySchema>;

/** `POST /api/goals/:id/:event`: one of Sure's events, else a `VALIDATION_ERROR`. */
export const goalEventParamSchema = z.object({ id: z.string(), event: z.enum(GOAL_EVENTS) });

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

/** What a goal aims for: an amount, or, for a reserve, a number of months of expenses. */
export type GoalTarget =
	| { mode: "fixed"; amount: MinorUnits }
	| { mode: "months_of_expenses"; months: number };

type FieldIssue = { path: string; message: string };

/** A whole number of months, written without sign or decimals. */
const MONTHS_PATTERN = /^\d{1,3}$/u;

/**
 * The target the mode asks for, or the issues of the field it reads: the
 * amount in fixed mode, a positive amount in `currency`; the months in months
 * mode, a whole number from 1 to 120, and only for a reserve, as Sure's
 * `months_requires_maintained`. Reads whatever parsing left, so it guards
 * on every field it reads; `null` when the mode itself is unreadable, which
 * its own field reports.
 */
function targetOf(
	value: Record<string, unknown>,
	currency: CurrencyCode,
): GoalTarget | FieldIssue[] | null {
	const { kind, targetMode, targetAmount, targetMonths } = value;

	if (targetMode === "fixed") {
		if (typeof targetAmount !== "string") {
			return null;
		}

		const amount = z.string().transform(amountIn(currency, true)).safeParse(targetAmount);

		return amount.success
			? { mode: "fixed", amount: amount.data }
			: amount.error.issues.map((issue) => ({ path: "targetAmount", message: issue.message }));
	}

	if (targetMode !== "months_of_expenses") {
		return null;
	}

	const issues: FieldIssue[] = [];
	const months =
		typeof targetMonths === "string" && MONTHS_PATTERN.test(targetMonths)
			? Number(targetMonths)
			: 0;

	if (kind === "one_off") {
		issues.push({ path: "targetMode", message: "reserve_only" });
	}

	if (months < 1 || months > GOAL_TARGET_MONTHS_MAX) {
		issues.push({ path: "targetMonths", message: "invalid_months" });
	}

	return issues.length > 0 ? issues : { mode: "months_of_expenses", months };
}

/**
 * A goal as the dialog and the API read it, Sure's form: a name, a kind, one
 * of Sure's target modes, the target as an amount above zero or, for a
 * reserve, a number of months of expenses, an optional date a reserve does
 * without, a colour and an icon, notes, and the linked accounts, each with a
 * fixed amount or, left blank, its whole balance. Built per currency, the
 * goal's, and shared with the interface's form resolver, so both report the
 * same field codes. Whether an account exists, may back a goal, holds the
 * goal's currency or is taken whole already, and what months of expenses
 * come to, need the database: the service checks it.
 */
export function goalSchema(currency: CurrencyCode) {
	return (
		z
			.object({
				// NFC: a pasted « Été » may arrive decomposed.
				name: z
					.string()
					.trim()
					.transform((value) => value.normalize("NFC"))
					.pipe(z.string().min(1).superRefine(atMost(GOAL_NAME_MAX_LENGTH))),
				kind: z.enum(GOAL_KINDS).default("one_off"),
				targetMode: z.enum(GOAL_TARGET_MODES).default("fixed"),
				// Read by `targetOf`, which knows the mode: the field the mode does not
				// use is ignored, as the dialog hides it.
				targetAmount: z.string().trim().default(""),
				targetMonths: z.string().trim().default(""),
				targetDate: z
					.string()
					.trim()
					.nullable()
					.transform(blankAsNull)
					.pipe(z.iso.date().nullable()),
				color: z.enum(CATEGORY_COLORS),
				// None until one is picked: the cards then show the goal's initial, as Sure's.
				icon: z.enum(CATEGORY_ICONS).nullable(),
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
								.transform((text, context) =>
									text === "" ? null : amountIn(currency)(text, context),
								),
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
			})
			// Runs even when another field failed, so the form shows every error
			// at once: `targetOf` guards on what it reads.
			.superRefine(
				(value, context) => {
					const target = targetOf(value, currency);

					for (const issue of Array.isArray(target) ? target : []) {
						context.addIssue({ code: "custom", path: [issue.path], message: issue.message });
					}
				},
				{ when: (payload) => typeof payload.value === "object" && payload.value !== null },
			)
			.transform((value) => {
				const target = targetOf(value, currency);

				// The refinement above has reported why there is no target.
				if (target === null || Array.isArray(target)) {
					return z.NEVER;
				}

				return {
					name: value.name,
					kind: value.kind,
					target,
					// A reserve is kept, not reached by a day: Sure's
					// `clear_target_date_for_maintained`.
					targetDate: value.kind === "maintained" ? null : value.targetDate,
					color: value.color,
					icon: value.icon,
					notes: value.notes,
					accounts: value.accounts,
				};
			})
	);
}

/** What the dialog's form holds: the text typed, before the schema parses it. */
export type GoalFormInput = z.input<ReturnType<typeof goalSchema>>;

export type GoalRequest = z.output<ReturnType<typeof goalSchema>>;
