// AD-22: a trade's quantity and price, and a holding's quantity, at Sure's
// precision, `decimal(34,18)` and `decimal(19,10)` in its `db/schema.rb`. They
// are stored as canonical decimal text, never as integers: 18 decimals
// overflow SQLite's 64-bit integer past 9.22 units, and 10 decimals overflow
// a JavaScript safe integer past 900 719 per unit, a Bitcoin in yen. Every
// computation on them goes through `BigInt`, scaled by their decimals.

import type { Micros } from "./micros.ts";

import { divideHalfEven, toMicros } from "./micros.ts";

declare const quantityBrand: unique symbol;
declare const tradePriceBrand: unique symbol;

/**
 * A number of units as canonical decimal text, up to 18 decimals and 16
 * integer digits: no exponent, no `+`, no leading zero beyond one, no
 * trailing fractional zero, `0` for zero, a leading `-` below zero.
 */
export type Quantity = string & { readonly [quantityBrand]: true };

/**
 * A trade's price per unit in its currency's major unit, as canonical decimal
 * text, up to 10 decimals and 9 integer digits.
 */
export type TradePrice = string & { readonly [tradePriceBrand]: true };

type Precision = { scale: number; integerDigits: number };

const QUANTITY: Precision = { scale: 18, integerDigits: 16 };
const TRADE_PRICE: Precision = { scale: 10, integerDigits: 9 };

const PLAIN_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/u;

// Grouped digits use a space, a no-break space or a narrow no-break space, as
// `readMicros` reads them, and a decimal comma or point.
const TYPED_PATTERN = /^([-−])?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?$/u;

/**
 * The canonical text of a sign, integer digits and fraction digits, `null`
 * past `precision`: a decimal beyond its scale is refused, never rounded.
 */
function canonical(
	negative: boolean,
	integerDigits: string,
	fractionDigits: string,
	precision: Precision,
): string | null {
	if (fractionDigits.length > precision.scale) {
		return null;
	}

	const integer = integerDigits.replace(/^0+(?=\d)/u, "");
	const fraction = fractionDigits.replace(/0+$/u, "");

	if (integer.length > precision.integerDigits) {
		return null;
	}

	if (integer === "0" && fraction === "") {
		return "0";
	}

	return `${negative ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

function parsePlain(text: string, precision: Precision): string | null {
	const match = PLAIN_PATTERN.exec(text);

	if (match === null) {
		return null;
	}

	const [, sign, integer = "", fraction = ""] = match;

	return canonical(sign !== undefined, integer, fraction, precision);
}

function readTyped(text: string, precision: Precision): string | null {
	const match = TYPED_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, sign, integer = "", fraction = ""] = match;

	return canonical(sign !== undefined, integer.replace(/\D/gu, ""), fraction, precision);
}

function scaled(text: string, precision: Precision): bigint {
	const negative = text.startsWith("-");
	const [integer = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
	const magnitude = BigInt(`${integer}${fraction.padEnd(precision.scale, "0")}`);

	return negative ? -magnitude : magnitude;
}

/** Scaled units as canonical text; `null` past the integer digits `precision` allows. */
function format(value: bigint, precision: Precision): string | null {
	const digits = (value < 0n ? -value : value).toString().padStart(precision.scale + 1, "0");

	return canonical(
		value < 0n,
		digits.slice(0, -precision.scale),
		digits.slice(-precision.scale),
		precision,
	);
}

/** Whether `text` is a quantity in its canonical form. */
export function isQuantity(text: string): text is Quantity {
	return parsePlain(text, QUANTITY) === text;
}

/** Whether `text` is a trade price in its canonical form. */
export function isTradePrice(text: string): text is TradePrice {
	return parsePlain(text, TRADE_PRICE) === text;
}

/**
 * Reads a plain decimal such as `"0.000166666666666667"` or `"-4"`, as the
 * API and the export write it, into its canonical form. `null` for anything
 * else, an exponent included, or past 18 decimals or 16 integer digits.
 */
export function parseQuantity(text: string): Quantity | null {
	const value = parsePlain(text, QUANTITY);

	return value !== null && isQuantity(value) ? value : null;
}

/**
 * Reads a quantity typed the French way (`1 234,5`) or the English way
 * (`1234.5`), as `readMicros` reads a price. A nineteenth decimal is refused,
 * never rounded away without the owner seeing it.
 */
export function readQuantity(text: string): Quantity | null {
	const value = readTyped(text, QUANTITY);

	return value !== null && isQuantity(value) ? value : null;
}

/** A quantity in units of 10⁻¹⁸, the scale every computation on it uses. */
export function scaledQuantity(quantity: Quantity): bigint {
	return scaled(quantity, QUANTITY);
}

/** Units of 10⁻¹⁸ as a quantity; throws past 16 integer digits. */
export function formatQuantity(value: bigint): Quantity {
	const text = format(value, QUANTITY);

	if (text === null || !isQuantity(text)) {
		throw new RangeError("A quantity has at most 16 integer digits.");
	}

	return text;
}

/** A plain decimal as a trade price, as `parseQuantity` reads a quantity, up to 10 decimals and 9 integer digits. */
export function parseTradePrice(text: string): TradePrice | null {
	const value = parsePlain(text, TRADE_PRICE);

	return value !== null && isTradePrice(value) ? value : null;
}

/** A typed trade price, as `readQuantity` reads a quantity; an eleventh decimal is refused. */
export function readTradePrice(text: string): TradePrice | null {
	const value = readTyped(text, TRADE_PRICE);

	return value !== null && isTradePrice(value) ? value : null;
}

/** A trade price in units of 10⁻¹⁰. */
export function scaledTradePrice(price: TradePrice): bigint {
	return scaled(price, TRADE_PRICE);
}

/** Units of 10⁻¹⁰ as a trade price; throws past 9 integer digits. */
export function formatTradePrice(value: bigint): TradePrice {
	const text = format(value, TRADE_PRICE);

	if (text === null || !isTradePrice(text)) {
		throw new RangeError("A trade price has at most 9 integer digits.");
	}

	return text;
}

/**
 * A trade price in millionths, rounded half to even, as a day's last trade
 * price is carried into its holdings, which keep millionths (AD-22).
 */
export function tradePriceToMicros(price: TradePrice): Micros {
	return toMicros(
		Number(divideHalfEven(scaledTradePrice(price), 10n ** BigInt(TRADE_PRICE.scale - 6))),
	);
}

/** Units of 10⁻¹⁸ in one, and of 10⁻¹⁰: what a quantity and a trade price are scaled by. */
export const QUANTITY_UNIT = 10n ** BigInt(QUANTITY.scale);
export const TRADE_PRICE_UNIT = 10n ** BigInt(TRADE_PRICE.scale);
