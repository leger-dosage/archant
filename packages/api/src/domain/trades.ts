import type { IsoDate } from "./dates.ts";

import type { Micros } from "@archant/data/micros";
import { divideHalfEven, toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { MAX_MINOR_UNITS, isCurrencyCode, minorUnitsOf, toMinorUnits } from "@archant/data/money";

/** « Achat » or « Vente »: the sign of a trade's quantity. */
export const TRADE_SIDES = ["buy", "sell"] as const;

export type TradeSide = (typeof TRADE_SIDES)[number];

/** The stored quantity of a side and an unsigned quantity: positive for a buy. */
export function signedQuantity(side: TradeSide, quantity: Micros): Micros {
	return toMicros(side === "buy" ? quantity : 0 - quantity);
}

/** Which side a stored quantity, never zero, records. */
export function sideOf(quantity: Micros): TradeSide {
	return quantity > 0 ? "buy" : "sell";
}

/** Millionths in one unit, squared: a quantity times a price. */
const MICROS_SQUARED = 10n ** 12n;

/**
 * `quantity × price` in minor units of `currency` (AD-22): the product
 * computed in `BigInt` and rounded half to even to the minor unit. A code
 * outside ISO 4217 has two decimals, as `toDecimalString` writes it.
 */
export function marketValue(quantity: Micros, price: Micros, currency: string): bigint {
	const minor = 10n ** BigInt(isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);

	return divideHalfEven(BigInt(quantity) * BigInt(price) * minor, MICROS_SQUARED);
}

/**
 * A trade's cash amount (AD-22, AD-5): `-(quantity × price + fee)`, the
 * product rounded as `marketValue` does, as Sure's `signed_qty * price + fee`
 * with AD-5's sign. A buy is negative, a sale positive less its fee. `null`
 * past `MAX_MINOR_UNITS` either way, which no balance could then sum safely.
 */
export function tradeAmount(
	trade: { quantity: Micros; price: Micros; fee: MinorUnits },
	currency: string,
): MinorUnits | null {
	const amount = -(marketValue(trade.quantity, trade.price, currency) + BigInt(trade.fee));
	const limit = BigInt(MAX_MINOR_UNITS);

	return amount > limit || amount < -limit ? null : toMinorUnits(Number(amount));
}

/**
 * The first day a security's running quantity falls below zero, its trades
 * summed per day in date order; `null` when it never does. Per day, as
 * holdings are: a sale and the buy that covers it on the same day hold.
 */
export function firstShortfall(
	movements: readonly { date: IsoDate; quantity: Micros }[],
): IsoDate | null {
	const byDay = new Map<IsoDate, bigint>();

	for (const { date, quantity } of movements) {
		byDay.set(date, (byDay.get(date) ?? 0n) + BigInt(quantity));
	}

	let running = 0n;

	for (const [date, quantity] of [...byDay].toSorted(([a], [b]) => a.localeCompare(b))) {
		running += quantity;

		if (running < 0n) {
			return date;
		}
	}

	return null;
}

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/u;

/**
 * Whether `isin` is an ISO 6166 code: a country's two letters, nine letters
 * or digits, and a check digit, the Luhn algorithm run over every letter
 * spelled as its number (A is 10, Z is 35). Upper case only.
 */
export function isValidIsin(isin: string): boolean {
	if (!ISIN_PATTERN.test(isin)) {
		return false;
	}

	const digits = isin.replaceAll(/[A-Z]/gu, (letter) => String(Number.parseInt(letter, 36)));
	let sum = 0;

	// From the right, every second digit doubled, its digits added.
	for (let index = 0; index < digits.length; index += 1) {
		const digit = Number(digits.charAt(digits.length - 1 - index)) * (index % 2 === 1 ? 2 : 1);
		sum += digit > 9 ? digit - 9 : digit;
	}

	return sum % 10 === 0;
}
