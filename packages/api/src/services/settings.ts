import type { CurrencyCode } from "@archant/data/money";
import { DEFAULT_CURRENCY } from "@archant/data/money";

/**
 * The currency totals are computed in (AD-6). Every caller goes through here,
 * so moving the value into a `settings` row later changes this body only.
 */
export function getReportingCurrency(): CurrencyCode {
	return DEFAULT_CURRENCY;
}
