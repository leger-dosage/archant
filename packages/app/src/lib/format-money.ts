import type { MinorUnits, Money } from "@archant/data/money";
import { formatMoney as formatMoneyIn, isCurrencyCode, minorUnitsOf } from "@archant/data/money";

import { intlLocale } from "@/lib/locale";

/** `formatMoney` in the language of this page: `1 234,56 €`, or `€1,234.56`. */
export function formatMoney(money: Money): string {
	return formatMoneyIn(money, intlLocale);
}

/**
 * `104 725 €`: Sure's `precision: 0`, rounded half up in integers, so a
 * balance never passes through a float on its way to the whole unit.
 */
export function formatWholeMoney(amount: MinorUnits, currency: string): string {
	const unit = 10n ** BigInt(isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);
	const whole = (BigInt(Math.abs(amount)) + unit / 2n) / unit;

	return new Intl.NumberFormat(intlLocale, {
		style: "currency",
		currency,
		maximumFractionDigits: 0,
	})
		.format(amount < 0 ? -whole : whole)
		.replace("-", "−");
}
