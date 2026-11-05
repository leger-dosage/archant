import type { Quantity } from "@archant/data/decimals";
import type { Micros } from "@archant/data/micros";
import { toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { bookFigures, percentOf, weightOf } from "./positions.ts";

/** One account's holding of a security today, as `currentHoldings` reads it. */
export type PortfolioRow = {
	security: { id: string; name: string; ticker: string | null };
	quantity: Quantity;
	amount: MinorUnits;
	costBasis: Micros | null;
};

/** Sure's `Trend#direction`, which picks its colour. */
export type TrendDirection = "up" | "down" | "flat";

/**
 * Sure's `Trend` of a value against its book value: the gain, and its
 * percentage of the book value's size, infinite on a zero book value with a
 * gain, as Sure's `Trend#percent`, or past what a number holds exactly.
 */
export type PortfolioReturn = {
	gain: MinorUnits;
	percent: Micros | "+infinity" | "-infinity";
	trend: TrendDirection;
};

/** A security rolled up across the accounts that hold it. */
export type RolledUpHolding = {
	security: PortfolioRow["security"];
	amount: MinorUnits;
	/** The rows above zero it sums, which its return reads. */
	rows: PortfolioRow[];
};

export type TopHolding = {
	security: PortfolioRow["security"];
	amount: MinorUnits;
	weight: Micros | null;
	/** `null` when none of its rows has a cost basis. */
	return: PortfolioReturn | null;
};

/**
 * Sure's `Trend` over `rows` with a cost basis, their values against their
 * book values; the others are left out, as Sure's `unrealized_gains_trend`.
 * `null` when none has one.
 */
export function returnOf(rows: readonly PortfolioRow[], currency: string): PortfolioReturn | null {
	let gain = 0n;
	let bookValue = 0n;
	let counted = false;

	for (const row of rows) {
		const figures = bookFigures(row, currency);

		if (figures !== null) {
			counted = true;
			gain += figures.gain;
			bookValue += figures.bookValue;
		}
	}

	if (!counted) {
		return null;
	}

	const trend: TrendDirection = gain > 0n ? "up" : gain < 0n ? "down" : "flat";
	const infinite = gain < 0n ? "-infinity" : "+infinity";
	const percent =
		gain === 0n
			? toMicros(0)
			: (percentOf(gain, bookValue < 0n ? -bookValue : bookValue) ?? infinite);

	return { gain: toMinorUnits(Number(gain)), percent, trend };
}

/**
 * Sure's `holdings_rolled_up_by_security`: each security's rows above zero
 * summed, row by row rather than on the netted total, so a negative row in
 * one account never nets the good one of another down; a security without
 * such a row is dropped. By value, largest first, then name.
 */
export function rollUp(rows: readonly PortfolioRow[]): RolledUpHolding[] {
	const bySecurity = new Map<string, RolledUpHolding>();

	for (const row of rows) {
		if (row.amount > 0) {
			const held = bySecurity.get(row.security.id);

			if (held === undefined) {
				bySecurity.set(row.security.id, {
					security: row.security,
					amount: row.amount,
					rows: [row],
				});
			} else {
				held.amount = toMinorUnits(held.amount + row.amount);
				held.rows.push(row);
			}
		}
	}

	return [...bySecurity.values()].toSorted(
		(a, b) =>
			b.amount - a.amount ||
			a.security.name.localeCompare(b.security.name) ||
			a.security.id.localeCompare(b.security.id),
	);
}

/**
 * Sure's `top_holdings`: the `limit` largest securities rolled up across
 * accounts, each weighed over the larger of the portfolio's value, cash
 * included, and the holdings' total, Sure's `weight_denominator`, so cash
 * below zero never pushes a weight past 100 %. Empty when nothing is held
 * above zero.
 */
export function topHoldings(
	rows: readonly PortfolioRow[],
	portfolioValue: MinorUnits,
	limit: number,
	currency: string,
): TopHolding[] {
	const rolled = rollUp(rows);
	const holdingsTotal = rolled.reduce((sum, held) => sum + held.amount, 0);

	if (holdingsTotal === 0) {
		return [];
	}

	const denominator = toMinorUnits(Math.max(portfolioValue, holdingsTotal));

	return rolled.slice(0, limit).map((held) => ({
		security: held.security,
		amount: held.amount,
		weight: weightOf(held.amount, denominator),
		return: returnOf(held.rows, currency),
	}));
}
