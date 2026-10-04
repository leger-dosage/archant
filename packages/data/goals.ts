// Apart from the `goals` table, so the interface reads the limits and the
// values without bundling Drizzle.

import type { AccountType } from "./account-types.ts";

/**
 * Sure's goal states. A goal is created `active`; pausing, completing and
 * archiving it arrive with Story 21.2. A new value is a check rebuilt, no
 * data migration.
 */
export const GOAL_STATES = ["active", "paused", "completed", "archived"] as const;

export type GoalState = (typeof GOAL_STATES)[number];

/**
 * Sure's `kind`: a `one_off` goal saves toward a target by a date, a
 * `maintained` one is a reserve kept full, which Story 21.3 brings.
 */
export const GOAL_KINDS = ["one_off", "maintained"] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

/**
 * Sure's `RELEASED_STATES`: a goal in one of these has let go of its money,
 * so its links reserve nothing and a whole-balance link no longer blocks
 * another goal's. A paused goal keeps its reservation.
 */
export const RELEASED_GOAL_STATES = [
	"completed",
	"archived",
] as const satisfies readonly GoalState[];

export const GOAL_NAME_MAX_LENGTH = 100;

export const GOAL_NOTES_MAX_LENGTH = 1000;

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
