import { intlLocale } from "@/lib/locale";

// `42 %`, the narrow no-break space French typography puts before the sign.
const wholePercentFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 0,
});

/** A whole percentage from the API, 0 to 100, as French writes it: `42 %`. */
export function formatWholePercent(percent: number): string {
	return wholePercentFormat.format(percent / 100);
}

const tenthPercentFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 1,
});

const signedTenthPercentFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 1,
	signDisplay: "always",
});

/** A percentage with one decimal at most, Sure's `round(1)`: `12,5 %`. */
export function formatTenthPercent(percent: number): string {
	return tenthPercentFormat.format(percent / 100);
}

/** A change, signed even at zero as Sure's `+0%`: `+12,5 %`, `-3 %`. */
export function formatChangePercent(percent: number): string {
	// `-0` would read « -0 % »; Sure's zero is positive.
	return signedTenthPercentFormat.format(percent === 0 ? 0 : percent / 100);
}
