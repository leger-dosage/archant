import type { MinorUnits } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

/** A change of balance: `+12,40 €` up, `−12,40 €` down, `0,00 €` flat. */
export function formatSignedMoney(amount: MinorUnits, currency: string): string {
	const formatted = formatMoney({ amount, currency });

	return amount > 0 ? `+${formatted}` : formatted;
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
