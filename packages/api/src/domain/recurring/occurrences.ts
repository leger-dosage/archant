import type { IsoDate } from "../dates.ts";
import type { Schedule } from "./schedule.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { OccurrenceStatus } from "@archant/data/recurring";

import { addDays, maxDate } from "../dates.ts";
import { firstOccurrenceAfter, planEnd } from "./schedule.ts";

/** Sure's `DEFAULT_NOTIFY_DAYS`: an occurrence is due from this many days before its date. */
const NOTIFY_DAYS = 3;

/** Sure's `DEFAULT_GRACE_DAYS`: an occurrence is overdue this many days after its date. */
const GRACE_DAYS = 3;

/** Sure's `amount_tolerance_pct` of 7.5, per mille: a single payment this close to the expected amount is the bill. */
export const AMOUNT_TOLERANCE = 75;

/** Sure's `MAX_LEARNED_TOLERANCE_PCT` of 25, per mille: a manual attach never teaches a wider band. */
export const MAX_LEARNED_TOLERANCE = 250;

/** Sure's `CLOSE_EPSILON`: payments within one minor unit of the expected amount pay it. */
const CLOSE_EPSILON = 1;

/** Sure's `OccurrenceGenerator::HORIZON_DAYS`. */
const HORIZON_DAYS = 90;

/** Sure's `FIRST_RUN_BACKFILL_MONTHS`: how far back « Détecter » rebuilds a series' history. */
export const BACKFILL_MONTHS = 6;

/** What an open occurrence shows: Sure's `derived_state`, never stored. */
export type DerivedState = "upcoming" | "due" | "overdue" | Exclude<OccurrenceStatus, "scheduled">;

/**
 * `numerator / denominator` rounded half up, as Ruby's `BigDecimal#round`,
 * for a numerator of zero or more and a positive denominator. The callers
 * compute both as numbers, exact integers below 2^53 for any household
 * amount; `BigInt` keeps the doubling and the sum below exact too.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
	const twice = 2n * BigInt(denominator);

	return Number((2n * BigInt(numerator) + BigInt(denominator)) / twice);
}

/**
 * Sure's `resolved_expected_amount` under the `fixed` strategy: the frozen
 * amount, else the series' magnitude.
 */
export function resolvedExpected(
	occurrence: { expectedAmount: MinorUnits | null },
	seriesAmount: MinorUnits,
): MinorUnits {
	return occurrence.expectedAmount ?? toMinorUnits(Math.abs(seriesAmount));
}

/** Sure's `effective_due_on`: a snooze postpones the date without moving the schedule. */
export function effectiveDueOn(occurrence: {
	dueOn: IsoDate;
	snoozedUntil: IsoDate | null;
}): IsoDate {
	return occurrence.snoozedUntil === null
		? occurrence.dueOn
		: maxDate(occurrence.dueOn, occurrence.snoozedUntil);
}

/**
 * Sure's `derived_state`: a closed occurrence reads its status; an open one
 * is overdue past the grace days, due from the notice days before, else upcoming.
 */
export function derivedState(
	occurrence: { status: OccurrenceStatus; dueOn: IsoDate; snoozedUntil: IsoDate | null },
	today: IsoDate,
): DerivedState {
	if (occurrence.status !== "scheduled") {
		return occurrence.status;
	}

	const effective = effectiveDueOn(occurrence);

	if (today > addDays(effective, GRACE_DAYS)) {
		return "overdue";
	}

	return today >= addDays(effective, -NOTIFY_DAYS) ? "due" : "upcoming";
}

/**
 * Sure's `Allocator#close_worthy?`: a single confirmed payment within 7.5 %
 * of the expected amount is the bill; otherwise the confirmed payments must
 * sum to it, within one minor unit. `confirmed` are the amounts of the
 * occurrence's confirmed payments.
 */
export function isCloseWorthy(expected: MinorUnits, confirmed: readonly MinorUnits[]): boolean {
	if (expected <= 0 || confirmed.length === 0) {
		return false;
	}

	const [only] = confirmed;

	if (confirmed.length === 1 && Math.abs(only! - expected) * 1000 <= AMOUNT_TOLERANCE * expected) {
		return true;
	}

	return confirmed.reduce((sum, amount) => sum + amount, 0) >= expected - CLOSE_EPSILON;
}

/** Sure's `remaining_amount`: what the confirmed payments leave to pay, never below zero. */
export function remainingOf(expected: MinorUnits, confirmed: readonly MinorUnits[]): MinorUnits {
	return toMinorUnits(Math.max(expected - confirmed.reduce((sum, amount) => sum + amount, 0), 0));
}

/**
 * Sure's `learn_from_manual_attach!` tolerance: the deviation of a payment
 * attached by hand, per mille and rounded half up, when it is the
 * occurrence's only confirmed payment and closes it, strays past 7.5 % and
 * past what was learned, and stays within 25 %; `null` teaches nothing.
 */
export function learnedTolerance(
	paid: MinorUnits,
	expected: MinorUnits,
	current: number | null,
	settles: boolean,
): number | null {
	if (expected <= 0 || !settles) {
		return null;
	}

	const scaled = Math.abs(paid - expected) * 1000;

	return scaled > AMOUNT_TOLERANCE * expected &&
		scaled > (current ?? 0) * expected &&
		scaled <= MAX_LEARNED_TOLERANCE * expected
		? roundHalfUp(scaled, expected)
		: null;
}

/** A paid occurrence as Sure's `PriceChangeDetector` reads it. */
export type PaidOccurrence = {
	dueOn: IsoDate;
	/** The amounts of its confirmed payments. */
	confirmed: readonly MinorUnits[];
	/** The transaction of its single confirmed payment, if any. */
	entryId: string | null;
};

/** A price change the detector would record. */
export type DetectedPriceChange = {
	effectiveOn: IsoDate;
	previousAmount: MinorUnits;
	newAmount: MinorUnits;
	entryId: string | null;
};

/**
 * Sure's `detect_for`: the two latest paid occurrences, latest first, each
 * settled by exactly one confirmed payment, agree within one minor unit on
 * an amount more than one minor unit from the series' magnitude; the change
 * takes effect on the latest due date. `null` when they do not, or when a
 * change on that date or one already at that amount was recorded.
 */
export function priceChangeOf(
	seriesAmount: MinorUnits,
	recent: readonly PaidOccurrence[],
	recorded: readonly { effectiveOn: IsoDate; newAmount: MinorUnits }[],
): DetectedPriceChange | null {
	const [latest, previous] = recent;

	if (
		latest === undefined ||
		previous === undefined ||
		latest.confirmed.length !== 1 ||
		previous.confirmed.length !== 1
	) {
		return null;
	}

	const newAmount = latest.confirmed[0]!;
	const previousAmount = toMinorUnits(Math.abs(seriesAmount));

	if (
		Math.abs(newAmount - previous.confirmed[0]!) > CLOSE_EPSILON ||
		Math.abs(newAmount - previousAmount) <= CLOSE_EPSILON
	) {
		return null;
	}

	const last = recorded.toSorted((a, b) => a.effectiveOn.localeCompare(b.effectiveOn)).at(-1);

	if (
		recorded.some((change) => change.effectiveOn === latest.dueOn) ||
		last?.newAmount === newAmount
	) {
		return null;
	}

	return { effectiveOn: latest.dueOn, previousAmount, newAmount, entryId: latest.entryId };
}

/**
 * Sure's `default_horizon`: 90 days ahead, stretched to the next due date for
 * a yearly bill, and to an installment's last payment.
 */
export function horizonOf(
	schedule: Schedule,
	installment: { anchorDate: IsoDate | null; endAfterCount: number | null },
	today: IsoDate,
): IsoDate {
	const next = firstOccurrenceAfter(schedule, today);
	let horizon = addDays(today, HORIZON_DAYS);

	if (next !== null) {
		horizon = maxDate(horizon, next);
	}

	if (installment.endAfterCount !== null) {
		horizon = maxDate(
			horizon,
			planEnd(schedule, installment.anchorDate ?? today, installment.endAfterCount),
		);
	}

	return horizon;
}
