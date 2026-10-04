import type { IsoDate } from "./dates.ts";

import type { IncomeKind } from "@archant/data/income-kinds";
import { INCOME_KINDS } from "@archant/data/income-kinds";
import type { Micros } from "@archant/data/micros";
import { divideHalfEven, toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { MAX_MINOR_UNITS, isCurrencyCode, minorUnitsOf, toMinorUnits } from "@archant/data/money";

/** « Achat » or « Vente »: the sign of a trade's quantity. */
export const TRADE_SIDES = ["buy", "sell"] as const;

export type TradeSide = (typeof TRADE_SIDES)[number];

/** What a trade records, in the order the form offers it. */
export const TRADE_TYPES = [...TRADE_SIDES, ...INCOME_KINDS] as const;

export type TradeType = (typeof TRADE_TYPES)[number];

/** « Dividende » or « Intérêts »: a trade of quantity zero whose amount is income. */
export function isIncomeSide(type: TradeType): type is IncomeKind {
	return (INCOME_KINDS as readonly TradeType[]).includes(type);
}

/** Whether a trade, or what makes one, is an income: narrows a union by its side. */
export function isIncome<Trade extends { side: TradeType }>(
	trade: Trade,
): trade is Extract<Trade, { side: IncomeKind }> {
	return isIncomeSide(trade.side);
}

/**
 * Whether a transaction's amount is one `type` moves (AD-5): a buy takes
 * money out or nothing, a sale brings money in or nothing, an income brings
 * money in.
 */
export function signFits(type: TradeType, amount: MinorUnits): boolean {
	if (type === "buy") {
		return amount <= 0;
	}

	return type === "sell" ? amount >= 0 : amount > 0;
}

/** The stored quantity of a side and an unsigned quantity: positive for a buy. */
export function signedQuantity(side: TradeSide, quantity: Micros): Micros {
	return toMicros(side === "buy" ? quantity : 0 - quantity);
}

/** Which side a stored quantity, never zero, records. */
export function sideOf(quantity: Micros): TradeSide {
	return quantity > 0 ? "buy" : "sell";
}

/** What a stored trade records: its income kind, else its quantity's side. */
export function typeOf(trade: { quantity: Micros; incomeKind: IncomeKind | null }): TradeType {
	return trade.incomeKind ?? sideOf(trade.quantity);
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
 * The fee a transaction converted into a buy or a sale leaves, so the
 * trade's amount is the transaction's exactly (AD-20, AD-22): `-amount -
 * quantity × price` for a buy, `quantity × price - amount` for a sale, the
 * product rounded as `marketValue` does. `null` below zero, an amount the
 * quantity and price do not reach, or past `MAX_MINOR_UNITS`.
 */
export function conversionFee(
	side: TradeSide,
	trade: { quantity: Micros; price: Micros },
	amount: MinorUnits,
	currency: string,
): MinorUnits | null {
	const value = marketValue(trade.quantity, trade.price, currency);
	const fee = side === "buy" ? -BigInt(amount) - value : value - BigInt(amount);

	return fee < 0n || fee > BigInt(MAX_MINOR_UNITS) ? null : toMinorUnits(Number(fee));
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
