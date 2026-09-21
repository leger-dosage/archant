declare const minorUnitsBrand: unique symbol;

/**
 * An amount in the smallest unit of its currency: cents for EUR, yen for JPY.
 * Branded so that a bare `number` cannot pass for money without going through
 * `toMinorUnits` or `parseAmount`.
 */
export type MinorUnits = number & { readonly [minorUnitsBrand]: true };

export type Money = { amount: MinorUnits; currency: string };

// ISO 4217 active codes and their minor units, as published by SIX. Kept static
// rather than read from `Intl`: ICU rounds some currencies differently from the
// standard (IDR, HUF, ISK among them), and the API and a browser must never
// disagree on how many decimals an amount has.
const MINOR_UNITS = {
	AED: 2,
	AFN: 2,
	ALL: 2,
	AMD: 2,
	AOA: 2,
	ARS: 2,
	AUD: 2,
	AWG: 2,
	AZN: 2,
	BAM: 2,
	BBD: 2,
	BDT: 2,
	BGN: 2,
	BHD: 3,
	BIF: 0,
	BMD: 2,
	BND: 2,
	BOB: 2,
	BOV: 2,
	BRL: 2,
	BSD: 2,
	BTN: 2,
	BWP: 2,
	BYN: 2,
	BZD: 2,
	CAD: 2,
	CDF: 2,
	CHE: 2,
	CHF: 2,
	CHW: 2,
	CLF: 4,
	CLP: 0,
	CNY: 2,
	COP: 2,
	COU: 2,
	CRC: 2,
	CUP: 2,
	CVE: 2,
	CZK: 2,
	DJF: 0,
	DKK: 2,
	DOP: 2,
	DZD: 2,
	EGP: 2,
	ERN: 2,
	ETB: 2,
	EUR: 2,
	FJD: 2,
	FKP: 2,
	GBP: 2,
	GEL: 2,
	GHS: 2,
	GIP: 2,
	GMD: 2,
	GNF: 0,
	GTQ: 2,
	GYD: 2,
	HKD: 2,
	HNL: 2,
	HTG: 2,
	HUF: 2,
	IDR: 2,
	ILS: 2,
	INR: 2,
	IQD: 3,
	IRR: 2,
	ISK: 0,
	JMD: 2,
	JOD: 3,
	JPY: 0,
	KES: 2,
	KGS: 2,
	KHR: 2,
	KMF: 0,
	KPW: 2,
	KRW: 0,
	KWD: 3,
	KYD: 2,
	KZT: 2,
	LAK: 2,
	LBP: 2,
	LKR: 2,
	LRD: 2,
	LSL: 2,
	LYD: 3,
	MAD: 2,
	MDL: 2,
	MGA: 2,
	MKD: 2,
	MMK: 2,
	MNT: 2,
	MOP: 2,
	MRU: 2,
	MUR: 2,
	MVR: 2,
	MWK: 2,
	MXN: 2,
	MXV: 2,
	MYR: 2,
	MZN: 2,
	NAD: 2,
	NGN: 2,
	NIO: 2,
	NOK: 2,
	NPR: 2,
	NZD: 2,
	OMR: 3,
	PAB: 2,
	PEN: 2,
	PGK: 2,
	PHP: 2,
	PKR: 2,
	PLN: 2,
	PYG: 0,
	QAR: 2,
	RON: 2,
	RSD: 2,
	RUB: 2,
	RWF: 0,
	SAR: 2,
	SBD: 2,
	SCR: 2,
	SDG: 2,
	SEK: 2,
	SGD: 2,
	SHP: 2,
	SLE: 2,
	SOS: 2,
	SRD: 2,
	SSP: 2,
	STN: 2,
	SVC: 2,
	SYP: 2,
	SZL: 2,
	THB: 2,
	TJS: 2,
	TMT: 2,
	TND: 3,
	TOP: 2,
	TRY: 2,
	TTD: 2,
	TWD: 2,
	TZS: 2,
	UAH: 2,
	UGX: 0,
	USD: 2,
	USN: 2,
	UYI: 0,
	UYU: 2,
	UYW: 4,
	UZS: 2,
	VED: 2,
	VES: 2,
	VND: 0,
	VUV: 0,
	WST: 2,
	XAF: 0,
	XCD: 2,
	XCG: 2,
	XOF: 0,
	XPF: 0,
	YER: 2,
	ZAR: 2,
	ZMW: 2,
	ZWG: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof MINOR_UNITS;

export const CURRENCY_CODES: readonly CurrencyCode[] = Object.keys(MINOR_UNITS)
	.filter(isCurrencyCode)
	.toSorted();

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

export function isCurrencyCode(value: string): value is CurrencyCode {
	return Object.hasOwn(MINOR_UNITS, value);
}

export function minorUnitsOf(currency: CurrencyCode): number {
	return MINOR_UNITS[currency];
}

/**
 * The largest amount `parseAmount` accepts: 100 billion in a two-decimal
 * currency. Far beyond any household balance, and low enough that summing
 * every account of a household stays a safe integer, where a sum past 2^53
 * would silently lose cents or fail every later listing.
 */
export const MAX_MINOR_UNITS = 10 ** 13;

function isMinorUnits(value: number): value is MinorUnits {
	return Number.isSafeInteger(value);
}

export function toMinorUnits(value: number): MinorUnits {
	// `-0` would format as a signed zero.
	const normalized = value === 0 ? 0 : value;

	if (!isMinorUnits(normalized)) {
		throw new RangeError("Minor units must be a safe integer.");
	}

	return normalized;
}

function isDecimalString(value: string): value is `${number}` {
	return /^-?\d+(?:\.\d+)?$/u.test(value);
}

// Grouped digits use a space, a no-break space or a narrow no-break space,
// since the last two are what a French-formatted amount copied from this
// interface or a bank's website carries.
const AMOUNT_PATTERN = /^([-−])?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?$/u;

/**
 * Reads an amount typed the French way (`1 234,56`, `-42,90`) or the English
 * way (`42.90`) into minor units of `currency`. Returns `null` for anything
 * else, including more decimals than the currency has: `1,234` is not a valid
 * euro amount and must not silently become 1 234 euros.
 */
export function parseAmount(text: string, currency: string): MinorUnits | null {
	if (!isCurrencyCode(currency)) {
		return null;
	}

	const match = AMOUNT_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, sign, integerPart = "", fraction = ""] = match;
	const decimals = minorUnitsOf(currency);

	if (fraction.length > decimals) {
		return null;
	}

	const digits = integerPart.replace(/\D/gu, "") + fraction.padEnd(decimals, "0");
	const magnitude = Number(digits);

	if (!Number.isSafeInteger(magnitude) || magnitude > MAX_MINOR_UNITS) {
		return null;
	}

	return toMinorUnits(sign === undefined ? magnitude : -magnitude);
}

/**
 * Renders an amount with `Intl.NumberFormat`, from an exact decimal string so
 * that no float division ever touches the value.
 */
export function formatMoney(money: Money, locale = "fr-FR"): string {
	const currency = isCurrencyCode(money.currency) ? money.currency : undefined;
	const decimals = currency === undefined ? 2 : minorUnitsOf(currency);
	const negative = money.amount < 0;
	const digits = String(Math.abs(money.amount)).padStart(decimals + 1, "0");
	const decimal =
		decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;

	const exact = `${negative ? "-" : ""}${decimal}`;

	if (!isDecimalString(exact)) {
		throw new RangeError("Cannot format a non-integer amount.");
	}

	const formatted = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: money.currency,
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(exact);

	// CLDR's French minus is a hyphen; typography and DESIGN.md want U+2212.
	return formatted.replace("-", "−");
}
