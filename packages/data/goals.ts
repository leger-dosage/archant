// Apart from the `goals` table, so the interface reads the limits and the
// values without bundling Drizzle.

import type { AccountType } from "./account-types.ts";
import type { CategoryColor, CategoryIcon } from "./category-presets.ts";

import { CATEGORY_COLORS } from "./category-presets.ts";

/**
 * Sure's goal states. A goal is created `active`, then moves through
 * `GOAL_EVENTS`. A new value is a check rebuilt, no data migration.
 */
export const GOAL_STATES = ["active", "paused", "completed", "archived"] as const;

export type GoalState = (typeof GOAL_STATES)[number];

/**
 * Sure's AASM events on a goal, `unarchive` named `restore`. The page offers
 * the ones `goalTransition` allows, which are the ones the server accepts.
 */
export const GOAL_EVENTS = ["pause", "resume", "complete", "archive", "restore", "reopen"] as const;

export type GoalEvent = (typeof GOAL_EVENTS)[number];

/**
 * Sure's `kind`: a `one_off` goal saves toward a target by a date, a
 * `maintained` one is a reserve kept full, which Story 21.3 brings.
 */
export const GOAL_KINDS = ["one_off", "maintained"] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

/**
 * Sure's `TARGET_MODES`: a target typed as an amount, or, for a reserve only,
 * a number of months of the household's median monthly expenses, which the
 * target follows when read.
 */
export const GOAL_TARGET_MODES = ["fixed", "months_of_expenses"] as const;

export type GoalTargetMode = (typeof GOAL_TARGET_MODES)[number];

/** Ten years of expenses: more is a typo, not a reserve. */
export const GOAL_TARGET_MONTHS_MAX = 120;

/**
 * Sure's `RELEASED_STATES`: a goal in one of these has let go of its money,
 * so its links reserve nothing and a whole-balance link no longer blocks
 * another goal's. A paused goal keeps its reservation.
 */
export const RELEASED_GOAL_STATES = [
	"completed",
	"archived",
] as const satisfies readonly GoalState[];

const TRANSITIONS = {
	pause: { from: ["active"], to: "paused" },
	resume: { from: ["paused"], to: "active" },
	complete: { from: ["active", "paused"], to: "completed" },
	archive: { from: ["active", "paused", "completed"], to: "archived" },
	restore: { from: ["archived"], to: "active" },
	reopen: { from: ["completed"], to: "active" },
} as const satisfies Record<GoalEvent, { from: readonly GoalState[]; to: GoalState }>;

/**
 * The state `event` takes a goal to, as Sure's `aasm` block, or `null` when
 * it does not apply from `state`. Only a one-off goal completes: completing
 * releases the money, the opposite of what a reserve is for.
 */
export function goalTransition(
	state: GoalState,
	kind: GoalKind,
	event: GoalEvent,
): GoalState | null {
	const { from, to } = TRANSITIONS[event];
	const allowed = (from as readonly GoalState[]).includes(state);

	return allowed && (event !== "complete" || kind === "one_off") ? to : null;
}

export const GOAL_NAME_MAX_LENGTH = 100;

export const GOAL_NOTES_MAX_LENGTH = 1000;

/**
 * The colour « Nouvel objectif » starts from, and the one a goal an assistant
 * creates keeps: a swatch drawn at random, as Sure's `GoalsController#new`
 * and its `create_goal` both take `COLORS.sample`.
 */
export function sampleGoalColor(random: () => number = Math.random): CategoryColor {
	return CATEGORY_COLORS[Math.floor(random() * CATEGORY_COLORS.length)] ?? CATEGORY_COLORS[0];
}

/**
 * The icon « Nouvel objectif » starts from. Sure leaves a new goal's icon
 * empty and shows its initial; Archant's `goals.icon` is required.
 */
export const DEFAULT_GOAL_ICON: CategoryIcon = "piggy-bank";

/**
 * Sure's `FUNDABLE_ACCOUNT_TYPES`: the accounts that hold savings. A card or
 * a loan holds debt, and a house or a car is not money set aside.
 */
export const FUNDABLE_ACCOUNT_TYPES = [
	"depository",
	"investment",
] as const satisfies readonly AccountType[];

/** Whether an account may back a goal: active, and of a type that holds savings. */
export function canBackGoal(account: { active: boolean; type: AccountType }): boolean {
	return account.active && FUNDABLE_ACCOUNT_TYPES.some((fundable) => fundable === account.type);
}
