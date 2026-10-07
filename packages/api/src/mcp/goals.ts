import type { GoalSummary } from "../services/goals.ts";

import { z } from "zod";

import { GOAL_KINDS, GOAL_STATES, GOAL_TARGET_MODES, sampleGoalColor } from "@archant/data/goals";
import type { MinorUnits } from "@archant/data/money";
import { toDecimalString } from "@archant/data/money";

import { createGoalInput, noToolInput } from "../schemas/assistants.ts";
import { createGoal, getGoalsOverview } from "../services/goals.ts";
import { BANK_TEXT, CREATES, READ_ONLY, decimal, defineTool } from "./tool.ts";

const goalOutput = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(GOAL_KINDS).describe('"maintained": a reserve kept full, with no date.'),
	state: z
		.enum(GOAL_STATES)
		.describe(
			'"paused" keeps its accounts\' money; "completed" and "archived" have let it go to the other goals.',
		),
	status: z
		.string()
		.describe(
			'For a goal: "behind" its date at the pace of the last 90 days, "on_track", "no_target_date" or "reached"; for a reserve: "funded" or "depleted".',
		),
	currency: z.string().describe("Its accounts' currency, that of every amount of the goal."),
	targetAmount: decimal("The target; for a reserve in months, the months times monthlyExpenses"),
	targetMode: z.enum(GOAL_TARGET_MODES),
	targetMonths: z.number().int().nullable().describe("A reserve's months of expenses."),
	monthlyExpenses: decimal(
		"The household's median monthly expenses a reserve in months multiplies",
	).nullable(),
	targetDate: z.string().nullable(),
	saved: decimal("What its accounts hold for it; for a completed goal, what it held then"),
	remaining: decimal("What is left to save"),
	percent: z.number().int(),
	monthlyNeeded: decimal("What to put aside each month to reach the target by its date").nullable(),
	notes: z.string().nullable(),
	accounts: z.array(
		z.object({
			accountId: z.string(),
			name: z.string(),
			allocatedAmount: decimal("The fixed amount held for this goal")
				.nullable()
				.describe(
					"null: the goal takes the account's whole balance; while it is active or paused, no other goal may.",
				),
			share: decimal("What the account backs for this goal once the other goals have theirs"),
		}),
	),
});

function goalOf(goal: GoalSummary): z.input<typeof goalOutput> {
	const { currency } = goal;
	const money = (amount: MinorUnits) => toDecimalString({ amount, currency });

	return {
		id: goal.id,
		name: goal.name,
		kind: goal.kind,
		state: goal.state,
		status: goal.status,
		currency,
		targetAmount: money(goal.targetAmount),
		targetMode: goal.targetMode,
		targetMonths: goal.targetMonths,
		// In the reporting currency, which is the goal's: months of expenses are
		// refused for a goal in any other.
		monthlyExpenses: goal.monthlyExpenses === null ? null : money(goal.monthlyExpenses),
		targetDate: goal.targetDate,
		saved: money(goal.saved),
		remaining: money(goal.remaining),
		percent: goal.percent,
		monthlyNeeded: goal.monthlyNeeded === null ? null : money(goal.monthlyNeeded),
		notes: goal.notes,
		accounts: goal.accounts.map((account) => ({
			accountId: account.accountId,
			name: account.name,
			allocatedAmount: account.allocatedAmount === null ? null : money(account.allocatedAmount),
			share: money(account.share),
		})),
	};
}

export const getGoals = defineTool({
	name: "get_goals",
	title: "Savings goals",
	description: `Every savings goal as « Objectifs » lists them in Archant, active ones needing attention first, then paused, completed and archived ones: each goal's target, what its accounts hold for it, what remains and what to put aside each month, with each account's share. Then the dashboard card's totals over the active and paused goals in the reporting currency, naming the goals left out for their currency. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({
		goals: z.array(goalOutput),
		totals: z.object({
			currency: z.string().describe("The reporting currency."),
			count: z.number().int().describe("The active and paused goals."),
			saved: decimal("What those in the reporting currency hold"),
			target: decimal("What those in the reporting currency aim for"),
			behind: z.number().int().describe("The active goals behind their date."),
			leftOut: z
				.array(z.object({ id: z.string(), name: z.string() }))
				.describe(
					"Goals in another currency, left out of saved and target until exchange rates exist: say so to the owner.",
				),
		}),
	}),
	run: async (deps) => {
		const { goals, summary } = await getGoalsOverview(deps);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: summary.currency });

		return {
			result: {
				goals: goals.map(goalOf),
				totals: {
					currency: summary.currency,
					count: summary.count,
					saved: money(summary.saved),
					target: money(summary.target),
					behind: summary.behind,
					leftOut: summary.leftOut,
				},
			},
			changedRows: 0,
		};
	},
});

export const createGoalTool = defineTool({
	name: "create_goal",
	title: "Create a savings goal",
	description: `Creates an active savings goal or a reserve, as « Nouvel objectif » does in Archant, held in its accounts' currency. Each account is an active current, savings or investment account, all in one currency; it holds a fixed amount for the goal, or its whole balance, which only one goal holding its money may take. A refused field answers VALIDATION_ERROR with its path and code. It answers the goal as get_goals gives it, and the url of its page in Archant to point the owner to. Editing, pausing, completing, archiving and deleting a goal stay in Archant's interface. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: CREATES,
	input: createGoalInput,
	output: goalOutput.extend({
		url: z.string().describe("The goal's page in Archant, as Sure's create_goal answers it."),
	}),
	run: async (deps, input) => {
		const created = await createGoal(deps, {
			name: input.name,
			kind: input.kind,
			targetMode: input.targetMonths === undefined ? "fixed" : "months_of_expenses",
			targetAmount: input.targetAmount ?? "",
			targetMonths: input.targetMonths === undefined ? "" : String(input.targetMonths),
			targetDate: input.targetDate ?? null,
			color: sampleGoalColor(),
			icon: null,
			notes: input.notes ?? null,
			accounts: input.accounts.map((account) => ({
				accountId: account.accountId,
				allocatedAmount: account.allocatedAmount ?? "",
			})),
		});

		return {
			result: {
				...goalOf(created),
				url: `${new URL(deps.trustedOrigin).origin}/goals/${created.id}`,
			},
			changedRows: 1,
		};
	},
});
