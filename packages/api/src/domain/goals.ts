import type { DailyBalance } from "./balances/forward.ts";
import type { IsoDate } from "./dates.ts";

import type { GoalKind, GoalState, GoalTargetMode } from "@archant/data/goals";
import { RELEASED_GOAL_STATES } from "@archant/data/goals";
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

/** Sure's month when it counts in days: a goal's date two days off asks for a fraction of one. */
const DAYS_PER_MONTH = 30;

export const GOAL_PACE_DAYS = 90;
export const GOAL_BALANCE_PACE_DAYS = 365;

/** The chart begins at most 90 days ago and never before the accounts' earliest history. */
export function goalHistoryStart(today: IsoDate, startDate: IsoDate | null): IsoDate {
	const start = addDays(today, -GOAL_PACE_DAYS);

	return startDate === null ? start : minDate(maxDate(start, startDate), today);
}

export type AccountPace = { change: MinorUnits; months: 3 | 12 };

/** Sum first, then round as Sure does, so opposing transfers cancel even at a fraction of a cent. */
function monthlyPace(accounts: readonly (AccountPace | undefined)[]): MinorUnits | null {
	let scaled = 0n;

	for (const account of accounts) {
		if (account === undefined) {
			return null;
		}

		scaled += BigInt(account.change) * BigInt(12 / account.months);
	}

	const rounded = scaled < 0n ? (scaled - 6n) / 12n : (scaled + 6n) / 12n;

	return toMinorUnits(Number(rounded));
}

/**
 * Where each of Sure's display statuses sorts among active goals, as its
 * `ACTIVE_DISPLAY_STATUS_RANK`: what needs attention first, a reserve below
 * its target beside a goal behind its pace, a funded reserve beside a
 * reached goal.
 */
const STATUS_RANKS = {
	behind: 0,
	depleted: 0,
	on_track: 1,
	no_target_date: 2,
	pace_unknown: 2,
	reached: 3,
	funded: 3,
} as const;

export type GoalStatus = keyof typeof STATUS_RANKS;

export type GoalProgress = {
	saved: MinorUnits;
	remaining: MinorUnits;
	/** Floored, and 99 at most until nothing remains, so a ring never shows full too early. */
	percent: number;
	/** What to put aside each month to reach the target by its date; `null` without a date, or for a reserve. */
	monthlyNeeded: MinorUnits | null;
	/** Monthly pace across the whole linked accounts, or null if any account is unmeasured. */
	pace: MinorUnits | null;
	status: GoalStatus;
};

/** A completed goal stays reached on its frozen amount; a reserve asks for no monthly amount. */
export function goalProgress(input: {
	kind: GoalKind;
	target: MinorUnits;
	saved: MinorUnits;
	targetDate: IsoDate | null;
	today: IsoDate;
	accounts: readonly (AccountPace | undefined)[];
	completed: boolean;
}): GoalProgress {
	const { target, saved, completed } = input;
	const remaining = toMinorUnits(Math.max(target - saved, 0));
	const percent =
		completed || remaining === 0 ? 100 : Math.min(Math.floor((saved * 100) / target), 99);
	const pace = monthlyPace(input.accounts);
	const reserve = input.kind === "maintained";
	const monthlyNeeded =
		reserve || input.targetDate === null
			? null
			: monthlyAmount(remaining, input.today, input.targetDate);

	return {
		saved,
		remaining,
		percent,
		monthlyNeeded,
		pace,
		status: completed
			? "reached"
			: reserve
				? reserveStatus(remaining)
				: statusOf(remaining, monthlyNeeded, pace),
	};
}

function reserveStatus(remaining: MinorUnits): GoalStatus {
	return remaining === 0 ? "funded" : "depleted";
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
	pace: MinorUnits | null,
): GoalStatus {
	if (remaining === 0) {
		return "reached";
	}

	if (monthlyNeeded === null) {
		return "no_target_date";
	}

	if (pace === null) {
		return "pace_unknown";
	}

	return monthlyNeeded <= pace ? "on_track" : "behind";
}

/**
 * A reserve's target in months of expenses, as Sure's
 * `months_of_expenses_amount`: the median monthly expenses times the months,
 * or `null` without a median above zero, since a target of zero would read
 * as a reserve already funded.
 */
export function monthsOfExpenses(months: number, median: MinorUnits | null): MinorUnits | null {
	return median === null || median <= 0 ? null : toMinorUnits(months * median);
}

/**
 * A goal's target when read, and the median it multiplies. A fixed target is
 * the amount stored. A reserve in months of expenses follows the median
 * monthly expenses, which only exist in the reporting currency (AD-6): in
 * another currency, or without a median, the target stored when it was last
 * saved stands, as Sure's « a stale floor beats a wrong one ».
 */
export function targetAsRead(
	goal: {
		targetMode: GoalTargetMode;
		targetMonths: number | null;
		targetAmount: MinorUnits;
		currency: string;
	},
	expenses: { currency: string; median: MinorUnits | null },
): { targetAmount: MinorUnits; monthlyExpenses: MinorUnits | null } {
	const computed =
		goal.targetMode === "months_of_expenses" &&
		goal.targetMonths !== null &&
		goal.currency === expenses.currency
			? monthsOfExpenses(goal.targetMonths, expenses.median)
			: null;

	return computed === null
		? { targetAmount: goal.targetAmount, monthlyExpenses: null }
		: { targetAmount: computed, monthlyExpenses: expenses.median };
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Where a goal that is not active sorts: after every active one, in this order. */
const AFTER_ACTIVE = Math.max(...Object.values(STATUS_RANKS)) + 1;

const STATE_RANKS = {
	paused: AFTER_ACTIVE,
	completed: AFTER_ACTIVE + 1,
	archived: AFTER_ACTIVE + 2,
} as const satisfies Record<Exclude<GoalState, "active">, number>;

function rankOf(goal: { state: GoalState; status: GoalStatus }): number {
	return goal.state === "active" ? STATUS_RANKS[goal.status] : STATE_RANKS[goal.state];
}

/**
 * Sure's `active_display_sort` then its index: active goals behind and
 * depleted reserves first, then on track, without a date or pace, reached and funded;
 * then paused, completed and archived goals; by name in French order within
 * each.
 */
export function compareGoals(
	a: { state: GoalState; status: GoalStatus; name: string },
	b: { state: GoalState; status: GoalStatus; name: string },
): number {
	return rankOf(a) - rankOf(b) || byName.compare(a.name, b.name);
}

export type SavedPoint = { date: IsoDate; saved: MinorUnits };

/** Apply today's backing ratio to the whole historical balances, as Sure's projection payload. */
export function goalSeries(input: {
	from: IsoDate;
	to: IsoDate;
	saved: MinorUnits;
	accounts: readonly (readonly DailyBalance[])[];
}): SavedPoint[] {
	const totals = new Map<IsoDate, bigint>();

	for (const account of input.accounts) {
		for (const { date, balance } of account) {
			totals.set(date, (totals.get(date) ?? 0n) + BigInt(balance));
		}
	}

	const whole = totals.get(input.to) ?? 0n;
	const numerator = whole > 0n ? BigInt(input.saved) : 0n;
	const denominator = maxOf(maxOf(whole, numerator), 1n);

	return Array.from({ length: daysBetween(input.from, input.to) + 1 }, (_, index) => {
		const date = addDays(input.from, index);
		const scaled = ((totals.get(date) ?? 0n) * numerator) / denominator;

		return { date, saved: toMinorUnits(Number(scaled)) };
	});
}

const RELEASED: readonly GoalState[] = RELEASED_GOAL_STATES;

/** How many goals the dashboard's card lists, as Sure's `goals.first(5)`. */
const SUMMARY_GOALS = 5;

type Summarised = {
	id: string;
	name: string;
	state: GoalState;
	status: GoalStatus;
	currency: string;
	saved: MinorUnits;
	targetAmount: MinorUnits;
};

/**
 * The Plan card, as Sure's `Goal.summary_for`: the
 * goals that hold their money, active and paused, counted; what they saved
 * and aim for, summed over those in `currency`, the others named as left out
 * (AD-6); how many active ones are behind, as Sure's `behind_pace?`, which
 * leaves a paused goal out; and the first five in the list's order.
 */
export function goalsSummary<Goal extends Summarised>(goals: readonly Goal[], currency: string) {
	const holding = goals.filter((goal) => !RELEASED.includes(goal.state));
	const counted = holding.filter((goal) => goal.currency === currency);
	const active = holding.filter((goal) => goal.state === "active");

	return {
		currency,
		count: holding.length,
		saved: toMinorUnits(counted.reduce((sum, goal) => sum + goal.saved, 0)),
		target: toMinorUnits(counted.reduce((sum, goal) => sum + goal.targetAmount, 0)),
		behind: active.filter((goal) => goal.status === "behind").length,
		paceUnknown: active.filter((goal) => goal.status === "pace_unknown").length,
		leftOut: holding
			.filter((goal) => goal.currency !== currency)
			.map((goal) => ({ id: goal.id, name: goal.name })),
		goals: holding.slice(0, SUMMARY_GOALS),
	};
}
