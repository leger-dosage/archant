import type { Micros } from "@archant/data/micros";
import { divideHalfEven, toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { MAX_MINOR_UNITS, toMinorUnits } from "@archant/data/money";

import { marketValue } from "../trades.ts";

/** One hundred percent, in millionths of a percent. */
const HUNDRED_PERCENT = 100_000_000n;

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `part / whole` as a percentage in millionths of a percent, rounded half to
 * even: 6 000 of 10 000 is 60 000 000. `null` when `whole` is zero or less,
 * where a share would read backwards or divide by nothing, and past what a
 * number holds exactly, a gain of a million euros on a cent.
 */
function percentOf(part: bigint, whole: bigint): Micros | null {
	if (whole <= 0n) {
		return null;
	}

	const percent = divideHalfEven(part * HUNDRED_PERCENT, whole);

	return percent > SAFE || percent < -SAFE ? null : toMicros(Number(percent));
}

/**
 * A line's weight in its account, Sure's `weight`: its value over the
 * account's total, cash included. `null` when the total is zero or less.
 */
export function weightOf(amount: MinorUnits, total: MinorUnits): Micros | null {
	return percentOf(BigInt(amount), BigInt(total));
}

/** What a position's row shows beside its value. */
export type PositionFigures = {
	/** `quantity × costBasis`, rounded as a value is; `null` without a cost basis. */
	bookValue: MinorUnits | null;
	/** « +/- value latente »: the value less the book value; `null` without a cost basis. */
	gain: MinorUnits | null;
	/** The gain over the book value; `null` without a cost basis or with a zero book value. */
	gainPercent: Micros | null;
	weight: Micros | null;
};

/**
 * Sure's holding row: the book value at the average cost, the unrealised gain
 * and its percentage, and the weight in the account's total (AD-22).
 */
export function positionFigures(
	position: { quantity: Micros; amount: MinorUnits; costBasis: Micros | null },
	total: MinorUnits,
	currency: string,
): PositionFigures {
	const weight = weightOf(position.amount, total);

	const bookValue =
		position.costBasis === null
			? null
			: marketValue(position.quantity, position.costBasis, currency);

	// Past `MAX_MINOR_UNITS`, as a trade's amount is refused: a cost basis
	// locked before a later buy grew the quantity can reach it.
	if (bookValue === null || bookValue > BigInt(MAX_MINOR_UNITS)) {
		return { bookValue: null, gain: null, gainPercent: null, weight };
	}

	const gain = BigInt(position.amount) - bookValue;

	return {
		bookValue: toMinorUnits(Number(bookValue)),
		gain: toMinorUnits(Number(gain)),
		// A free share has no book value to measure a gain against.
		gainPercent: percentOf(gain, bookValue),
		weight,
	};
}
