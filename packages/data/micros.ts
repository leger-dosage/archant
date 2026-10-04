// AD-22: quantities and prices are integers in millionths, beside `money.ts`'s
// minor units. A price of 12.345678 EUR is 12 345 678; a quantity of 0.5 is
// 500 000.

declare const microsBrand: unique symbol;

/**
 * A quantity in millionths of a unit, or a price in millionths of its
 * currency's major unit. Branded so that a bare `number` cannot pass for one
 * without going through `parseMicros`.
 */
export type Micros = number & { readonly [microsBrand]: true };

/** How many millionths make one unit. */
const SCALE = 6;

function isMicros(value: number): value is Micros {
	return Number.isSafeInteger(value);
}

/** Brands a safe integer as millionths; throws on anything else, as `toMinorUnits` does. */
export function toMicros(value: number): Micros {
	// `-0` would compare and format as a signed zero.
	const normalized = value === 0 ? 0 : value;

	if (!isMicros(normalized)) {
		throw new RangeError("Millionths must be a safe integer.");
	}

	return normalized;
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/u;

/**
 * `numerator / denominator` rounded half to even, as AD-22 rounds a value to
 * its minor unit: a tie goes to the even neighbour, so a long run of rounded
 * values does not drift upward. Throws on a zero denominator.
 */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
	if (denominator === 0n) {
		throw new RangeError("Cannot divide by zero.");
	}

	const negative = numerator < 0n !== denominator < 0n;
	const dividend = numerator < 0n ? -numerator : numerator;
	const divisor = denominator < 0n ? -denominator : denominator;
	const quotient = dividend / divisor;
	const twiceRemainder = (dividend % divisor) * 2n;
	const rounded =
		twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n === 1n)
			? quotient + 1n
			: quotient;

	return negative ? -rounded : rounded;
}

/**
 * Reads a plain decimal string such as `"12.345"` or `"-0.5"` into
 * millionths, rounding half to even beyond six decimals. Returns `null` for
 * anything else, an exponent or a grouped digit included, and for a value
 * whose millionths are not a safe integer.
 */
export function parseMicros(text: string): Micros | null {
	const match = DECIMAL_PATTERN.exec(text);

	if (match === null) {
		return null;
	}

	const [, sign, integerPart = "", fraction = ""] = match;
	const digits = BigInt(`${integerPart}${fraction}`);
	const magnitude =
		fraction.length > SCALE
			? divideHalfEven(digits, 10n ** BigInt(fraction.length - SCALE))
			: digits * 10n ** BigInt(SCALE - fraction.length);

	// `-0` would compare and format as a signed zero.
	const value = Number(sign === undefined || magnitude === 0n ? magnitude : -magnitude);

	return isMicros(value) ? value : null;
}

// Grouped digits use a space, a no-break space or a narrow no-break space, as
// `money.ts`'s `parseAmount` reads them, and a decimal comma or point.
const TYPED_PATTERN = /^([-−])?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?$/u;

/**
 * Reads a quantity or a price typed the French way (`1 234,5`) or the
 * English way (`1234.5`) into millionths. Returns `null` for anything else,
 * more than six decimals included: a seventh would be rounded away without
 * the owner seeing it, where `parseMicros` rounds a provider's float on purpose.
 */
export function readMicros(text: string): Micros | null {
	const match = TYPED_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, sign, integerPart = "", fraction = ""] = match;

	if (fraction.length > SCALE) {
		return null;
	}

	const magnitude = BigInt(integerPart.replace(/\D/gu, "") + fraction.padEnd(SCALE, "0"));

	if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
		return null;
	}

	return toMicros(Number(sign === undefined ? magnitude : -magnitude));
}

/**
 * Millionths as a plain decimal string, without trailing zeros: `"612.4"`,
 * `"-4"`, `"0.000001"`. What crosses a boundary where a JSON number would
 * round, and what `readMicros` and `parseMicros` read back.
 */
export function formatMicros(value: Micros): string {
	const digits = String(Math.abs(value)).padStart(SCALE + 1, "0");
	const fraction = digits.slice(-SCALE).replace(/0+$/u, "");
	const integer = digits.slice(0, -SCALE);

	return `${value < 0 ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}
