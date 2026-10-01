import type { ServiceDeps } from "./deps.ts";

import { and, eq, gt, like, lt, lte, sql } from "drizzle-orm";

import { signInFailures } from "@archant/data/schema/auth";

export type SignInCeilingOptions = {
	/** The row counted: `all` for every address together, `device:<nonce>` for one device. */
	key: string;
	/**
	 * Sign-ins a window lets reach Better Auth, counted on `key`: every address
	 * together for `all`, one device for `device:<nonce>`. Every failure keeps
	 * its slot, any other answer gives it back.
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
	key: "all",
	max: 20,
	windowMs: 10 * 60 * 1000,
	// Read at each call, not captured: a spec's fake clock replaces `Date`.
	now: () => Date.now(),
};

const DEVICE_PREFIX = "device:";

/**
 * What a known device may still fail once the ceiling is full: five, in the
 * same window. The owner mistyping stays well within it, and someone replaying
 * a stolen cookie spends only that device's five, never the owner's other
 * devices'.
 */
export function deviceCeiling(nonce: string): SignInCeilingOptions {
	return { ...SIGN_IN_CEILING, key: `${DEVICE_PREFIX}${nonce}`, max: 5 };
}

type Deps = Pick<ServiceDeps, "db">;

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
	{ key, max, windowMs, now }: SignInCeilingOptions = SIGN_IN_CEILING,
): Promise<Reservation | null> {
	const time = now();
	const expired = sql`${signInFailures.windowStartedAt} <= ${time - windowMs}`;

	// One row per device that ever met a full ceiling would otherwise pile up;
	// a row whose window is over counts nothing any more.
	if (key.startsWith(DEVICE_PREFIX)) {
		await deps.db
			.delete(signInFailures)
			.where(
				and(
					like(signInFailures.id, `${DEVICE_PREFIX}%`),
					lte(signInFailures.windowStartedAt, time - windowMs),
				),
			);
	}

	const [row] = await deps.db
		.insert(signInFailures)
		.values({ id: key, count: 1, windowStartedAt: time })
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
export async function releaseAttempt(
	deps: Deps,
	{ windowStartedAt }: Reservation,
	{ key }: Pick<SignInCeilingOptions, "key"> = SIGN_IN_CEILING,
): Promise<void> {
	await deps.db
		.update(signInFailures)
		.set({ count: sql`${signInFailures.count} - 1` })
		.where(
			and(
				eq(signInFailures.id, key),
				eq(signInFailures.windowStartedAt, windowStartedAt),
				gt(signInFailures.count, 0),
			),
		);
}
