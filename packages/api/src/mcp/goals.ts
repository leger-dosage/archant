import type { ServiceDeps } from "../services/deps.ts";
import type { GoalAccountChoice, GoalSummary } from "../services/goals.ts";

import { z } from "zod";

import { GOAL_KINDS, GOAL_TARGET_MONTHS_MAX, sampleGoalColor } from "@archant/data/goals";
import type { MinorUnits } from "@archant/data/money";

import { AppError } from "../lib/errors.ts";
import { listPageInput } from "../schemas/assistants/fields.ts";
import { createGoalInput } from "../schemas/assistants/goals.ts";
import { createGoal, goalAccountChoices, listGoals } from "../services/goals.ts";
import { fundableAccountsNamed } from "../services/names.ts";
import {
	BANK_TEXT,
	CREATES,
	READ_ONLY,
	defineTool,
	formatMoney,
	formatted,
	pageOf,
	pageOutput,
	refuse,
	sureDecimalText,
} from "./tool.ts";

/** The goal's page in Archant, as Sure's `absolute_url_for`. */
function goalUrl(trustedOrigin: string, id: string): string {
	return `${new URL(trustedOrigin).origin}/goals/${id}`;
}

/** What Sure's `create_goal` answers of a goal, which `get_goals` starts each goal with. */
const createdFields = {
	goal_id: z.string(),
	name: z.string(),
	target_amount_formatted: formatted(
		"The target; for a reserve in months, the months times the median monthly expenses it stores",
	),
	currency: z.string().describe("Its accounts' currency, that of every amount of the goal."),
	target_date: z.string().nullable(),
	url: z.string().describe("The goal's page in Archant, to point the owner to."),
	linked_account_names: z.array(z.string()).describe("Its accounts' names."),
};

const goalOutput = z.object({
	...createdFields,
	notes: z.string().nullable(),
	kind: z.enum(GOAL_KINDS).describe('"maintained": a reserve kept full, with no date.'),
	target_months: z.number().int().nullable().describe("A reserve's months of expenses."),
	status: z
		.string()
		.describe(
			'Sure\'s display status: "archived", "paused" or "completed", else for a goal "behind" its date at the pace of the last 90 days, "on_track", "no_target_date" or "reached", for a reserve "funded" or "depleted".',
		),
	progress_percent: z
		.number()
		.int()
		.describe("Floored, 99 at most until nothing remains; 100 once completed."),
	current_balance: formatted(
		"What its accounts hold for it; for a completed goal, what it held then",
	),
	remaining_amount: formatted("What is left to save"),
	monthly_target_amount: formatted("What to put aside each month to reach the target by its date")
		.nullable()
		.describe("null without a date, and for a reserve."),
	pace: formatted("Its accounts' monthly change over the last 90 days"),
	earmarks: z
		.record(z.string(), z.string())
		.describe(
			"The fixed amount each account holds for it, by account name, formatted; an account left out gives its whole balance, which no other goal holding its money may take.",
		),
});

/** Sure's `display_status`: a goal's state where it is not active, else its progress. */
function displayStatus(goal: GoalSummary): string {
	return goal.state === "active" ? goal.status : goal.state;
}

function goalOf(goal: GoalSummary, trustedOrigin: string): z.input<typeof goalOutput> {
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: goal.currency });

	return {
		goal_id: goal.id,
		name: goal.name,
		target_amount_formatted: money(goal.targetAmount),
		currency: goal.currency,
		target_date: goal.targetDate,
		url: goalUrl(trustedOrigin, goal.id),
		linked_account_names: goal.accounts.map((account) => account.name),
		notes: goal.notes,
		kind: goal.kind,
		target_months: goal.targetMonths,
		status: displayStatus(goal),
		progress_percent: goal.percent,
		current_balance: money(goal.saved),
		remaining_amount: money(goal.remaining),
		monthly_target_amount: goal.monthlyNeeded === null ? null : money(goal.monthlyNeeded),
		pace: money(goal.pace),
		earmarks: Object.fromEntries(
			goal.accounts.flatMap((account) =>
				account.allocatedAmount === null ? [] : [[account.name, money(account.allocatedAmount)]],
			),
		),
	};
}

export const getGoals = defineTool({
	name: "get_goals",
	title: "Savings goals",
	description: `Every savings goal as « Objectifs » lists them in Archant, a page at a time as Sure's get_categories: active ones needing attention first, then paused, completed and archived ones. Each goal gives create_goal's answer, then its notes, kind, status, progress, what its accounts hold for it, what remains, what to put aside each month, its pace and the fixed amount each account holds for it, amounts formatted. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({ goals: z.array(goalOutput), ...pageOutput }),
	run: async (deps, { page, page_size: pageSize }) => {
		const { items, ...fields } = pageOf(await listGoals(deps), page, pageSize);

		return {
			result: { goals: items.map((goal) => goalOf(goal, deps.trustedOrigin)), ...fields },
			changedRows: 0,
		};
	},
});

/** Sure's `parse_decimal` followed by its `> 0`: the decimal text of a positive amount, else `null`. */
function positiveText(value: string | number | undefined): string | null {
	const text = value === undefined ? null : sureDecimalText(value);

	return text === null || text.startsWith("-") || /^[0.]+$/u.test(text) ? null : text;
}

/** Sure's `parse_date`: an ISO 8601 day, anything else ignored. */
function dateOf(value: string | null | undefined): string | null {
	const text = value?.trim() ?? "";

	return z.iso.date().safeParse(text).success ? text : null;
}

/** Rails' `Array#to_sentence`: « A », « A and B », « A, B, and C ». */
function toSentence(words: readonly string[]): string {
	if (words.length <= 2) {
		return words.join(" and ");
	}

	return `${words.slice(0, -1).join(", ")}, and ${words.at(-1) ?? ""}`;
}

/** Sure's `depository_account_payload`: what each account could still give a new goal. */
async function availableAccounts(
	deps: ServiceDeps,
	read: Promise<GoalAccountChoice[]> = goalAccountChoices(deps),
) {
	return (await read).map((choice) => ({
		name: choice.name,
		currency: choice.currency,
		free_to_earmark: formatMoney({ amount: choice.freeToEarmark, currency: choice.currency }),
		claimed_in_full: choice.claimedInFull,
	}));
}

/**
 * Rails' full message for each refusal of « Nouvel objectif »'s checks, by
 * the field and code the service names, Sure's words where its model has
 * the same check.
 */
const GOAL_MESSAGES: Readonly<Record<string, string>> = {
	"name too_long": "Name is too long (maximum is 100 characters)",
	"notes too_long": "Notes is too long (maximum is 1000 characters)",
	"targetAmount invalid_amount": "Target amount is not a number",
	"targetAmount not_positive": "Target amount must be greater than 0",
	"targetMode reserve_only":
		"Only a reserve you maintain can have a target set in months of expenses.",
	"targetMonths invalid_months": `Target months must be a whole number from 1 to ${GOAL_TARGET_MONTHS_MAX}`,
	"targetMonths no_expenses":
		"Target months need monthly expenses to count from, and the household has none yet",
	"targetMonths not_reporting_currency":
		"Months of expenses only apply to accounts in the reporting currency",
	"accounts no_account": "Pick at least one account to fund this goal.",
	"accounts duplicate_account": "Linked accounts must not name an account twice",
	"accounts not_fundable": "All linked accounts must be cash or investment accounts.",
	"accounts currency_mismatch": "All linked accounts must share the same currency.",
	"accounts invalid_amount": "Earmarks must be amounts in the goal's currency",
	"accounts not_positive": "Earmarks must be greater than 0",
	"accounts whole_balance_taken":
		"This account is already fully earmarked for another goal. Enter an amount to split it.",
};

/** A refused field's sentence: `accounts.0.accountId` reads as its list's. */
function sentenceOf(path: string, code: string): string {
	const field = path.split(".")[0] ?? path;

	return GOAL_MESSAGES[`${field} ${code}`] ?? `${field} ${code}`;
}

/** The service's own refusals as Sure's `validation_failed`, sentences joined by `; `. */
async function savedAsSure<Written>(
	write: () => Promise<Written>,
	sentences: readonly string[],
): Promise<Written> {
	if (sentences.length > 0) {
		refuse("validation_failed", sentences.join("; "));
	}

	try {
		return await write();
	} catch (error) {
		if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
			const refused = (error.fields ?? []).map((field) => sentenceOf(field.path, field.code));

			refuse("validation_failed", [...new Set(refused)].join("; ") || error.message);
		}

		throw error;
	}
}

export const createGoalTool = defineTool({
	name: "create_goal",
	title: "Create a savings goal",
	description: `Creates an active savings goal, as Sure's create_goal and « Nouvel objectif » in Archant. Before calling, confirm the key details by paraphrasing back to the owner: the name, target amount, target date (if mentioned), and which of their accounts will fund it, with any amount reserved from each. Only call once they've confirmed. The goal links to at least one of the household's active current, savings or investment accounts, named exactly as get_accounts gives them, case included, all in one currency, which becomes the goal's. An account another goal claims in full needs an amount in earmarks. On success it answers the goal's url to point the owner to; on a soft failure, such as a name that matches no account, it answers available_accounts, each with what a new goal could still reserve on it, so you can ask again. Archant's own kind "maintained" makes a reserve kept full, with no date, whose target may be target_months of expenses. Editing, pausing, completing, archiving and deleting a goal stay in Archant's interface. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: CREATES,
	input: createGoalInput,
	output: z.object({
		success: z.literal(true),
		...createdFields,
		message: z.string(),
	}),
	run: async (deps, input) => {
		const name = input.name.trim();
		const reserve = input.kind === "maintained";
		// A one-off goal given months is refused by the service, as Sure's
		// `months_requires_maintained`.
		const months = input.target_months;
		const targetAmount = positiveText(input.target_amount);
		// Sure's `where(name: names)` links an account named twice once.
		const names = [
			...new Set(input.linked_account_names.map((item) => item.trim()).filter(Boolean)),
		];

		if (name === "") {
			refuse("name_required", "Please provide a name for the goal.");
		}

		if (targetAmount === null && (!reserve || months === undefined)) {
			refuse("target_amount_invalid", "Target amount must be greater than zero.");
		}

		if (names.length === 0) {
			refuse(
				"no_linked_accounts",
				"Please specify at least one Depository account to link to this goal.",
				{ available_accounts: await availableAccounts(deps) },
			);
		}

		const found = await fundableAccountsNamed(deps, names);
		const missing = names.filter((item) => !found.some((row) => row.name === item));

		if (missing.length > 0) {
			refuse(
				"unknown_accounts",
				"Some account names didn't match the user's Depository accounts.",
				{
					unknown_names: missing,
					available_accounts: await availableAccounts(deps),
				},
			);
		}

		const ambiguous = [...new Set(found.map((row) => row.name))].filter(
			(item) => found.filter((row) => row.name === item).length > 1,
		);

		if (ambiguous.length > 0) {
			refuse(
				"ambiguous_accounts",
				"Multiple accounts share a name. Ask the user which one to use.",
				{
					ambiguous_names: ambiguous,
					available_accounts: await availableAccounts(deps),
				},
			);
		}

		const matched = names.flatMap((item) => found.filter((row) => row.name === item));
		const currencies = [...new Set(matched.map((row) => row.currency))];

		if (currencies.length > 1) {
			refuse(
				"currency_mismatch",
				`All linked accounts must share the same currency. Found: ${currencies.join(", ")}.`,
			);
		}

		const earmarks = new Map(
			Object.entries(input.earmarks ?? {}).flatMap(([key, value]) => {
				const amount = positiveText(value);

				return amount === null ? [] : [[key.trim(), amount] as const];
			}),
		);
		const reading = goalAccountChoices(deps);
		const choices = await reading;
		const claimed = matched.filter(
			(row) =>
				!earmarks.has(row.name) &&
				choices.some((choice) => choice.id === row.id && choice.claimedInFull),
		);

		if (claimed.length > 0) {
			const claimedNames = claimed.map((row) => row.name);

			refuse(
				"account_claimed_in_full",
				`Another goal already claims ${toSentence(claimedNames)} in full. Ask the user how much to reserve from ${claimed.length === 1 ? "it" : "them"}, then pass it in \`earmarks\`.`,
				{
					claimed_account_names: claimedNames,
					available_accounts: await availableAccounts(deps, reading),
				},
			);
		}

		const targetDate = dateOf(input.target_date);
		const created = await savedAsSure(
			async () =>
				createGoal(deps, {
					name,
					kind: input.kind,
					targetMode: months === undefined ? "fixed" : "months_of_expenses",
					targetAmount: targetAmount ?? "",
					targetMonths: months === undefined ? "" : String(months),
					targetDate,
					color: sampleGoalColor(),
					icon: null,
					notes: input.notes ?? null,
					accounts: matched.map((row) => ({
						accountId: row.id,
						allocatedAmount: earmarks.get(row.name) ?? "",
					})),
				}),
			// The dialog hides a reserve's date and the service drops it: the
			// owner would agree to a date nothing keeps.
			[
				...(reserve && input.target_amount !== undefined && months !== undefined
					? ["Give target_amount or target_months, not both"]
					: []),
				...(reserve && targetDate !== null
					? ["Target date can't be set on a reserve you maintain"]
					: []),
			],
		);
		const goal = goalOf(created, deps.trustedOrigin);

		return {
			result: {
				success: true as const,
				goal_id: goal.goal_id,
				name: goal.name,
				target_amount_formatted: goal.target_amount_formatted,
				currency: goal.currency,
				target_date: goal.target_date,
				url: goal.url,
				linked_account_names: matched.map((row) => row.name),
				message: `Created goal '${goal.name}' (target ${goal.target_amount_formatted}). View it at ${goal.url}.`,
			},
			changedRows: 1,
		};
	},
});
