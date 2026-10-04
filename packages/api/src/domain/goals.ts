import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays, daysBetween, maxDate, minDate } from "./dates.ts";

/** One goal's link to an account: a fixed amount, or `null` for the whole balance. */
export type GoalLink = { goalId: string; allocatedAmount: MinorUnits | null };

/**
 * What each link on one account backs, by goal, as Sure's
 * `backing_share_for`: a balance at or below zero backs nothing; fixed
 * amounts come first, scaled down by `balance / their total` when they ask
 * for more than the balance, floored so the shares never sum above it; a
 * whole-balance link takes what the fixed amounts leave. `links` are the
 * links of goals that hold their money, plus the one goal asked about.
 */
export function backingShares(
	balance: MinorUnits,
	links: readonly GoalLink[],
): Map<string, MinorUnits> {
	const fixed = links.flatMap((link) =>
		link.allocatedAmount === null ? [] : [BigInt(link.allocatedAmount)],
	);
	const totalFixed = fixed.reduce((sum, amount) => sum + amount, 0n);
	const available = BigInt(Math.max(balance, 0));
	const shares = new Map<string, MinorUnits>();

	for (const link of links) {
		if (link.allocatedAmount === null) {
			shares.set(link.goalId, toMinorUnits(Number(maxOf(available - totalFixed, 0n))));
		} else if (totalFixed > available) {
			// `totalFixed` is above `available`, at least zero, so never zero itself.
			shares.set(
				link.goalId,
				toMinorUnits(Number((BigInt(link.allocatedAmount) * available) / totalFixed)),
			);
		} else {
			shares.set(link.goalId, link.allocatedAmount);
		}
	}

	return shares;
}

function maxOf(a: bigint, b: bigint): bigint {
	return a > b ? a : b;
}

/** `a / b` rounded toward negative infinity, `b` positive. */
function floorDiv(a: bigint, b: bigint): bigint {
	const quotient = a / b;

	return a % b < 0n ? quotient - 1n : quotient;
}

/** Sure's month when it counts in days: a goal's date two days off asks for a fraction of one. */
const DAYS_PER_MONTH = 30;

/** The window the pace reads: 90 days, or since the account opened when that is later. */
const PACE_DAYS = 90;

/** What the pace divides the window's change by, three months. */
const PACE_MONTHS = BigInt(PACE_DAYS / DAYS_PER_MONTH);

/**
 * The day a linked account's pace starts from: 90 days ago, or its opening
 * date if later, and never after today, so an account opened at a future
 * date moves nothing yet rather than falling by its opening balance.
 */
export function paceStart(today: IsoDate, openingDate: IsoDate | null): IsoDate {
	const start = addDays(today, -PACE_DAYS);

	return openingDate === null ? start : minDate(maxDate(start, openingDate), today);
}

/**
 * Sure's display statuses of a goal that saves toward a target, in the order
 * its list shows them: what needs attention first.
 */
const GOAL_STATUSES = ["behind", "on_track", "no_target_date", "reached"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type GoalProgress = {
	saved: MinorUnits;
	remaining: MinorUnits;
	/** Floored, and 99 at most until nothing remains, so a ring never shows full too early. */
	percent: number;
	/** What to put aside each month to reach the target by its date; `null` without a date. */
	monthlyNeeded: MinorUnits | null;
	/** The linked accounts' monthly change over their last 90 days, whole accounts as Sure's. */
	pace: MinorUnits;
	status: GoalStatus;
};

/**
 * A goal's figures, as Sure's `Goal`: what remains, the share of the target
 * reached, the monthly amount by the date rounded up to the cent, from 30-day
 * months counted in days, so a date two days off asks for a fraction of a
 * month rather than all of it, and all of it once the date has come. The
 * pace divides the 90-day change by three, even for an account opened since,
 * as Sure's does. `accounts` holds each linked account's balance today and at
 * its `paceStart`.
 */
export function goalProgress(input: {
	target: MinorUnits;
	saved: MinorUnits;
	targetDate: IsoDate | null;
	today: IsoDate;
	accounts: readonly { now: MinorUnits; before: MinorUnits }[];
}): GoalProgress {
	const { target, saved } = input;
	const remaining = toMinorUnits(Math.max(target - saved, 0));
	const percent = remaining === 0 ? 100 : Math.min(Math.floor((saved * 100) / target), 99);
	const change = input.accounts.reduce(
		(sum, account) => sum + BigInt(account.now) - BigInt(account.before),
		0n,
	);
	const pace = toMinorUnits(Number(floorDiv(change, PACE_MONTHS)));
	const monthlyNeeded =
		input.targetDate === null ? null : monthlyAmount(remaining, input.today, input.targetDate);

	return {
		saved,
		remaining,
		percent,
		monthlyNeeded,
		pace,
		status: statusOf(remaining, monthlyNeeded, pace),
	};
}

function monthlyAmount(remaining: MinorUnits, today: IsoDate, targetDate: IsoDate): MinorUnits {
	const days = daysBetween(today, targetDate);

	if (days <= 0) {
		return remaining;
	}

	const scaled = BigInt(remaining) * BigInt(DAYS_PER_MONTH);

	return toMinorUnits(Number((scaled + BigInt(days) - 1n) / BigInt(days)));
}

function statusOf(
	remaining: MinorUnits,
	monthlyNeeded: MinorUnits | null,
	pace: MinorUnits,
): GoalStatus {
	if (remaining === 0) {
		return "reached";
	}

	if (monthlyNeeded === null) {
		return "no_target_date";
	}

	return monthlyNeeded <= pace ? "on_track" : "behind";
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Sure's `active_display_sort`: behind first, then on track, without a date,
 * reached, and by name in French order within each.
 */
export function compareGoals(
	a: { status: GoalStatus; name: string },
	b: { status: GoalStatus; name: string },
): number {
	return (
		GOAL_STATUSES.indexOf(a.status) - GOAL_STATUSES.indexOf(b.status) ||
		byName.compare(a.name, b.name)
	);
}
