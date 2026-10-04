import type { IsoDate } from "../../domain/dates.ts";

import type { Micros } from "@archant/data/micros";
import type { CurrencyCode } from "@archant/data/money";
import type { PriceProviderId } from "@archant/data/schema/securities";

import { AppError } from "../../lib/errors.ts";

/**
 * A listing the provider found for a search, as Sure's `Provider::Security`.
 * Nothing about the household: the provider only ever hears the query.
 */
export type SecurityMatch = {
	/** The provider's symbol, such as `MC.PA`: what a fetch asks for. */
	ticker: string;
	name: string;
	/** ISO 10383 operating MIC, `null` when the venue is unknown. */
	mic: string | null;
	/** The venue's usual currency, `null` when the venue says none. */
	currency: CurrencyCode | null;
	provider: PriceProviderId;
};

/** A listing to price: identifiers only, never a quantity or an amount (AD-22). */
export type PriceRequest = {
	ticker: string;
	mic: string | null;
	/** The first and last calendar days asked for, both included. */
	from: IsoDate;
	to: IsoDate;
};

/**
 * A listing's daily closes, in millionths, sorted by date, one per day, and
 * the currency they are in. Never empty: no usable close is `PRICE_UNAVAILABLE`.
 */
export type DailyPrices = { currency: CurrencyCode; prices: { date: IsoDate; price: Micros }[] };

/**
 * The price port (AD-22), apart from the bank connector port. An adapter
 * never touches the database, and throws only `AppError`s: `PRICE_UNAVAILABLE`
 * when the provider has no usable price for the listing, `PRICE_PROVIDER_ERROR`
 * for anything else, neither carrying the provider's answer.
 */
export type PriceProvider = {
	id: PriceProviderId;
	searchSecurities: (query: string) => Promise<SecurityMatch[]>;
	dailyPrices: (request: PriceRequest) => Promise<DailyPrices>;
};

export type PriceProviderConfig = {
	/** `YAHOO_FINANCE_URL`. */
	apiUrl: string;
};

/**
 * The provider has no usable price for a listing: an unknown symbol, no
 * close, or a currency other than the security's. Counts against it.
 */
export const priceUnavailable = () =>
	new AppError("PRICE_UNAVAILABLE", "The price provider has no price for this security.");
