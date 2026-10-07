// `42 %`, the narrow no-break space French typography puts before the sign.
const wholePercentFormat = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	maximumFractionDigits: 0,
});

/** A whole percentage from the API, 0 to 100, as French writes it: `42 %`. */
export function formatWholePercent(percent: number): string {
	return wholePercentFormat.format(percent / 100);
}
