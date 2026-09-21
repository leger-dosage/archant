import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { MAX_MINOR_UNITS, minorUnitsOf, toMinorUnits } from "@archant/data/money";

/**
 * A non-negative decimal read exactly from the query, `units / 10^scale`:
 * `42,9` is `{ units: 429n, scale: 1 }`. Parsed once, before any currency is
 * known, then scaled per currency by `amountBoundsFor`.
 */
export type DecimalAmount = { units: bigint; scale: number };

/** Bounds on the absolute value of an amount, in minor units of one currency. */
export type AmountRange = { min: MinorUnits | null; max: MinorUnits | null };

const MAX = BigInt(MAX_MINOR_UNITS);

/**
 * `value` in minor units of a currency with `decimals` decimals, rounded up
 * when `up`, down otherwise. Bigint, so a long fraction cannot lose a digit.
 */
function toMinor(value: DecimalAmount, decimals: number, up: boolean): bigint {
	if (value.scale <= decimals) {
		return value.units * 10n ** BigInt(decimals - value.scale);
	}

	const divisor = 10n ** BigInt(value.scale - decimals);
	const quotient = value.units / divisor;

	return up && value.units % divisor !== 0n ? quotient + 1n : quotient;
}

/**
 * The absolute-value bounds `min` and `max` in minor units of `currency`, as
 * Sure's `EntrySearch` compares them: `20` to `50` finds `-42,90` and
 * `+42,90`. A bound finer than the currency's minor unit rounds inward, so
 * `0,005` to `0,009` in euros holds no cent at all and gives `null`: nothing in
 * that currency can match.
 */
export function amountBoundsFor(
	min: DecimalAmount | undefined,
	max: DecimalAmount | undefined,
	currency: CurrencyCode,
): AmountRange | null {
	const decimals = minorUnitsOf(currency);
	const low = min === undefined ? null : toMinor(min, decimals, true);
	const high = max === undefined ? null : toMinor(max, decimals, false);

	// No stored amount goes past `MAX_MINOR_UNITS`: a lower bound above it
	// matches nothing, an upper bound above it is no bound at all.
	if ((low !== null && low > MAX) || (low !== null && high !== null && low > high)) {
		return null;
	}

	return {
		min: low === null ? null : toMinorUnits(Number(low)),
		max: high === null || high > MAX ? null : toMinorUnits(Number(high)),
	};
}

/** The character `escapeLike` prefixes, for the query's `escape` clause. */
export const LIKE_ESCAPE = "\\";

/**
 * `q` with the characters `LIKE` reads as wildcards, and the escape character
 * itself, prefixed by `LIKE_ESCAPE`, so a search for `50%` finds `Remise 50%` and not
 * `Remise 500`. The query must declare it in its `escape` clause.
 */
export function escapeLike(q: string): string {
	return q.replaceAll(/[\\%_]/gu, (character) => `${LIKE_ESCAPE}${character}`);
}
