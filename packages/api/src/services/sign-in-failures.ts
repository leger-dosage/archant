import type { ServiceDeps } from "./deps.ts";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import { signInFailures } from "@archant/data/schema/auth";

export type SignInCeilingOptions = {
	/**
	 * Sign-ins, all addresses together, a window lets reach Better Auth: every
	 * failure keeps its slot, any other answer gives it back.
	 */
	max: number;
	windowMs: number;
	/** The clock, injectable so a spec need not wait out a window. */
	now: () => number;
};

/**
 * Twenty failures per ten minutes: the owner mistyping never comes near it,
 * and Better Auth's own limit already holds one address to three attempts per
 * ten seconds, so it takes several addresses to reach it.
 */
export const SIGN_IN_CEILING: SignInCeilingOptions = {
	max: 20,
	windowMs: 10 * 60 * 1000,
	// Read at each call, not captured: a spec's fake clock replaces `Date`.
	now: () => Date.now(),
};

type Deps = Pick<ServiceDeps, "db">;

const ROW = "all";

/** The window a reserved attempt belongs to, to give its slot back in. */
export type Reservation = { windowStartedAt: number };

/**
 * Takes one of the window's `max` slots for a sign-in about to reach Better
 * Auth, opening a new window when the current one is over; `null` when every
 * slot is taken. Reserved before the attempt rather than counted after it: a
 * burst from many addresses would otherwise all pass while the count still
 * read below `max`. One statement, so two attempts never take the same slot.
 */
export async function reserveAttempt(
	deps: Deps,
	{ max, windowMs, now }: SignInCeilingOptions = SIGN_IN_CEILING,
): Promise<Reservation | null> {
	const time = now();
	const expired = sql`${signInFailures.windowStartedAt} <= ${time - windowMs}`;

	const [row] = await deps.db
		.insert(signInFailures)
		.values({ id: ROW, count: 1, windowStartedAt: time })
		.onConflictDoUpdate({
			target: signInFailures.id,
			set: {
				count: sql`case when ${expired} then 1 else ${signInFailures.count} + 1 end`,
				windowStartedAt: sql`case when ${expired} then ${time} else ${signInFailures.windowStartedAt} end`,
			},
			setWhere: sql`${expired} or ${lt(signInFailures.count, max)}`,
		})
		.returning({ windowStartedAt: signInFailures.windowStartedAt });

	return row ?? null;
}

/**
 * Gives a slot back: the attempt did not fail, so only failures stay counted.
 * A slot of a window since replaced is not given back to the new one.
 */
export async function releaseAttempt(deps: Deps, { windowStartedAt }: Reservation): Promise<void> {
	await deps.db
		.update(signInFailures)
		.set({ count: sql`${signInFailures.count} - 1` })
		.where(
			and(
				eq(signInFailures.id, ROW),
				eq(signInFailures.windowStartedAt, windowStartedAt),
				gt(signInFailures.count, 0),
			),
		);
}
