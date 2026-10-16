import type { Quantity, TradePrice } from "@archant/data/decimals";
import {
	QUANTITY_UNIT,
	TRADE_PRICE_UNIT,
	formatQuantity,
	scaledQuantity,
	scaledTradePrice,
} from "@archant/data/decimals";
import type { IncomeKind } from "@archant/data/income-kinds";
import { INCOME_KINDS } from "@archant/data/income-kinds";
import type { Micros } from "@archant/data/micros";
import { divideHalfEven } from "@archant/data/micros";
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
export function signedQuantity(side: TradeSide, quantity: Quantity): Quantity {
	return side === "buy" ? quantity : formatQuantity(-scaledQuantity(quantity));
}

/** A quantity without its sign. */
export function unsignedQuantity(quantity: Quantity): Quantity {
	const scaled = scaledQuantity(quantity);

	return scaled < 0n ? formatQuantity(-scaled) : quantity;
}

/** Which side a stored quantity, never zero, records: its canonical text starts with `-` below zero. */
export function sideOf(quantity: Quantity): TradeSide {
	return quantity.startsWith("-") ? "sell" : "buy";
}

/** What a stored trade records: its income kind, else its quantity's side. */
export function typeOf(trade: { quantity: Quantity; incomeKind: IncomeKind | null }): TradeType {
	return trade.incomeKind ?? sideOf(trade.quantity);
}

/** Millionths in one unit: a stored price's and a cost basis's scale. */
const MICROS_UNIT = 1_000_000n;

/** A quantity times a price in millionths, the scale a cost basis is computed at. */
const QUANTITY_MICROS_UNIT = QUANTITY_UNIT * MICROS_UNIT;

/** Minor units in one major unit of `currency`: two decimals outside ISO 4217. */
export function minorUnitsPerMajor(currency: string): bigint {
	return 10n ** BigInt(isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);
}

/**
 * `quantity × price` in minor units of `currency` (AD-22), a holding's price
 * or a cost basis in millionths: the product computed in `BigInt` and rounded
 * half to even to the minor unit. A code outside ISO 4217 has two decimals,
 * as `toDecimalString` writes it.
 */
export function marketValue(quantity: Quantity, price: Micros, currency: string): bigint {
	return divideHalfEven(
		scaledQuantity(quantity) * BigInt(price) * minorUnitsPerMajor(currency),
		QUANTITY_MICROS_UNIT,
	);
}

/**
 * `quantity × price` of a trade in minor units of `currency`, its price at
 * ten decimals, exact in `BigInt` and rounded half to even to the minor unit
 * (AD-22).
 */
export function tradeValue(quantity: Quantity, price: TradePrice, currency: string): bigint {
	return divideHalfEven(
		scaledQuantity(quantity) * scaledTradePrice(price) * minorUnitsPerMajor(currency),
		QUANTITY_UNIT * TRADE_PRICE_UNIT,
	);
}

/**
 * A trade's cash amount (AD-22, AD-5): `-(quantity × price + fee)`, the
 * product rounded as `tradeValue` does, as Sure's `signed_qty * price + fee`
 * with AD-5's sign. A buy is negative, a sale positive less its fee. `null`
 * past `MAX_MINOR_UNITS` either way, which no balance could then sum safely.
 */
export function tradeAmount(
	trade: { quantity: Quantity; price: TradePrice; fee: MinorUnits },
	currency: string,
): MinorUnits | null {
	const amount = -(tradeValue(trade.quantity, trade.price, currency) + BigInt(trade.fee));
	const limit = BigInt(MAX_MINOR_UNITS);

	return amount > limit || amount < -limit ? null : toMinorUnits(Number(amount));
}

/**
 * Whether a buy's cost per unit, `(quantity × price + fee) / quantity` in
 * millionths, as Sure's `CostBasisTracker` averages it, stays a safe integer:
 * a quantity of 10⁻¹⁸ with a fee of 1 € passes it, and no holding could then
 * store its cost basis. A weighted average never passes its largest buy, so
 * checking each buy is enough. A sale has no cost of its own.
 */
export function buyCostFits(
	trade: { quantity: Quantity; price: TradePrice; fee: MinorUnits },
	currency: string,
): boolean {
	const quantity = scaledQuantity(trade.quantity);

	if (quantity <= 0n) {
		return true;
	}

	const scale = QUANTITY_UNIT * TRADE_PRICE_UNIT;
	const cost = divideHalfEven(
		quantity * scaledTradePrice(trade.price) +
			(BigInt(trade.fee) * scale) / minorUnitsPerMajor(currency),
		quantity * (TRADE_PRICE_UNIT / MICROS_UNIT),
	);

	return cost <= BigInt(Number.MAX_SAFE_INTEGER);
}

/**
 * The fee a transaction converted into a buy or a sale leaves, so the
 * trade's amount is the transaction's exactly (AD-20, AD-22): `-amount -
 * quantity × price` for a buy, `quantity × price - amount` for a sale, the
 * product rounded as `tradeValue` does. `null` below zero, an amount the
 * quantity and price do not reach, or past `MAX_MINOR_UNITS`.
 */
export function conversionFee(
	side: TradeSide,
	trade: { quantity: Quantity; price: TradePrice },
	amount: MinorUnits,
	currency: string,
): MinorUnits | null {
	const value = tradeValue(trade.quantity, trade.price, currency);
	const fee = side === "buy" ? -BigInt(amount) - value : value - BigInt(amount);

	return fee < 0n || fee > BigInt(MAX_MINOR_UNITS) ? null : toMinorUnits(Number(fee));
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
