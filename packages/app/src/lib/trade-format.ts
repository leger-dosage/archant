import { isCurrencyCode, minorUnitsOf } from "@archant/data/money";

// The API answers quantities and prices as plain decimal strings, such as
// `"612.4"`, read here without ever becoming a float: `Intl.NumberFormat`
// formats the string itself.

/** Six decimals at most, as AD-22 stores them. */
const MAX_DECIMALS = 6;

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: MAX_DECIMALS });

function isDecimalString(value: string): value is `${number}` {
	return /^-?\d+(?:\.\d+)?$/u.test(value);
}

/** `"2.5"` as `2,5`, grouped the French way. */
export function formatQuantity(quantity: string): string {
	return isDecimalString(quantity) ? quantityFormat.format(quantity) : quantity;
}

/**
 * A unit price in its currency, as many decimals as the currency has and up
 * to six when the price carries more: `"612.4"` is `612,40 €`.
 */
export function formatPrice(price: string, currency: string): string {
	if (!isDecimalString(price)) {
		return price;
	}

	const decimals = isCurrencyCode(currency) ? minorUnitsOf(currency) : 2;

	return new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency,
		minimumFractionDigits: decimals,
		maximumFractionDigits: Math.max(decimals, MAX_DECIMALS),
	}).format(price);
}

/** A decimal string as the form shows it for an edit: `"612.4"` is `612,4`. */
export function decimalToText(value: string): string {
	return value.replace(".", ",");
}

const shareFormat = new Intl.NumberFormat("fr-FR", {
	style: "percent",
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

/**
 * A percentage from the API, a decimal string such as `"60"` or `"-2.5"`,
 * with one decimal: `60,0 %`, `−2,5 %`. Only shown, so dividing the float
 * by a hundred costs nothing that matters.
 */
export function formatShare(percent: string): string {
	return isDecimalString(percent)
		? shareFormat.format(Number(percent) / 100).replace("-", "−")
		: percent;
}
