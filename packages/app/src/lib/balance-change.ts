import type { MinorUnits } from "@archant/data/money";
import { formatMoney, isCurrencyCode, minorUnitsOf } from "@archant/data/money";

/** A change of balance: `+12,40 €` up, `−12,40 €` down, `0,00 €` flat. */
export function formatSignedMoney(amount: MinorUnits, currency: string): string {
	const formatted = formatMoney({ amount, currency });

	return amount > 0 ? `+${formatted}` : formatted;
}

function isDecimalString(value: string): value is `${number}` {
	return /^-?\d+(?:\.\d+)?$/u.test(value);
}

const compactFormats = new Map<string, Intl.NumberFormat>();

function compactFormat(currency: string): Intl.NumberFormat {
	let format = compactFormats.get(currency);

	if (format === undefined) {
		format = new Intl.NumberFormat("fr-FR", {
			style: "currency",
			currency,
			notation: "compact",
			maximumFractionDigits: 1,
		});
		compactFormats.set(currency, format);
	}

	return format;
}

/**
 * A chart's axis label: `275 k€`, `1,2 M€`, `−3 k€`. The value is rebuilt as
 * a decimal string, as `formatMoney` does, so no float division touches it.
 */
export function formatCompactMoney(amount: MinorUnits, currency: string): string {
	const decimals = isCurrencyCode(currency) ? minorUnitsOf(currency) : 2;
	const digits = String(Math.abs(amount)).padStart(decimals + 1, "0");
	const decimal =
		decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
	const exact = `${amount < 0 ? "-" : ""}${decimal}`;

	if (!isDecimalString(exact)) {
		throw new RangeError("Cannot format a non-integer amount.");
	}

	const parts = compactFormat(currency).formatToParts(exact);

	return (
		parts
			// ICU puts a space between `k` and `€`; the design reads « 275 k€ ».
			// A currency shown as its code, `k JPY`, keeps the space.
			.filter((part, index) => {
				const next = parts[index + 1];

				return !(
					part.type === "literal" &&
					parts[index - 1]?.type === "compact" &&
					next?.type === "currency" &&
					!/^[A-Z]{3}$/u.test(next.value)
				);
			})
			.map((part) => part.value)
			.join("")
			// CLDR's French minus is a hyphen; typography and DESIGN.md want U+2212.
			.replace("-", "−")
	);
}

const percentFormat = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
	signDisplay: "exceptZero",
});

/** Percentage points from the API, one decimal, signed: `+1,0 %`, `−25,0 %`. */
export function formatSignedPercent(percent: number): string {
	// U+2212, as `formatMoney` does, so the amount and its percentage match.
	return percentFormat.format(percent / 100).replace("-", "−");
}

const tooltipDate = new Intl.DateTimeFormat("fr-FR", {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const tableDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const dayTick = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});
const monthTick = new Intl.DateTimeFormat("fr-FR", {
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

// At UTC midnight, so the browser's zone cannot move a stored day.
const atMidnight = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** `lundi 21 septembre 2026`, under the chart's cursor. */
export const formatTooltipDate = (iso: string) => tooltipDate.format(atMidnight(iso));

/** `21 septembre 2026`, in the data table. */
export const formatTableDate = (iso: string) => tableDate.format(atMidnight(iso));

/** `12 sept. 2026`, where a sentence names a day. */
export const formatShortDate = (iso: string) => shortDate.format(atMidnight(iso));

/**
 * An axis tick: `21 sept.` over a few months, `sept. 2025` once the series
 * spans more than about six months, where the same day can appear at both
 * ends of the axis.
 */
export function formatTick(iso: string, longRange: boolean): string {
	return (longRange ? monthTick : dayTick).format(atMidnight(iso));
}
