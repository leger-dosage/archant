import type { PriceProvider, SecurityMatch } from "../connectors/prices/price-provider.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";

import { asc, eq } from "drizzle-orm";

import { PRICE_PROVIDER_IDS, securities } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";

import { createPriceProvider } from "../connectors/registry.ts";
import { AppError } from "../lib/errors.ts";
import { tradedSecurities } from "./ledger/trades.ts";

/** What the price routes and the daily fetch need. */
export type PriceDeps = ServiceDeps & {
	logger: Logger;
	/** `YAHOO_FINANCE_URL`. */
	priceApiUrl: string;
};

/**
 * The `settings` row that turns price fetching on, holding the provider's
 * id. No row, the default, means off: nothing then reaches a provider.
 */
export const PRICE_PROVIDER_SETTING = "price_provider";

/**
 * The provider price fetching is turned on with, `null` while it is off. A
 * row naming no known provider counts as off.
 */
export async function enabledProvider(
	deps: Pick<PriceDeps, "db" | "priceApiUrl">,
): Promise<PriceProvider | null> {
	const row = await deps.db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, PRICE_PROVIDER_SETTING))
		.get();
	const id = PRICE_PROVIDER_IDS.find((known) => known === row?.value);

	return id === undefined ? null : createPriceProvider(id, { apiUrl: deps.priceApiUrl });
}

/** A security the household holds, and the first day it needs a price for. */
export type HeldSecurity = { securityId: string; from: IsoDate };

/**
 * The securities whose prices are fetched, oldest first: each one traded,
 * from its first trade's date, a sold one included, since the past is valued
 * from its prices.
 */
export async function heldSecurities(deps: Pick<PriceDeps, "db">): Promise<HeldSecurity[]> {
	return tradedSecurities(deps.db);
}

/** A security already known, as the trade form offers it before the provider's. */
export type KnownSecurity = {
	id: string;
	name: string;
	ticker: string | null;
	mic: string | null;
	isin: string | null;
	currency: string;
};

/** How many known securities a search offers. */
const KNOWN_LIMIT = 10;

/** Lower case without accents, so « societe » finds « Société ». */
const folded = (text: string) =>
	text
		.normalize("NFD")
		.replaceAll(/\p{Diacritic}/gu, "")
		.toLowerCase();

/**
 * The known securities whose name, ticker or ISIN contains `query`, case and
 * accents aside, by name. Read whole and filtered here: a household holds a
 * few dozen, and SQLite's `like` folds the case of ASCII letters only.
 */
async function knownSecurities(
	deps: Pick<PriceDeps, "db">,
	query: string,
): Promise<KnownSecurity[]> {
	const needle = folded(query.trim());
	const rows = await deps.db
		.select({
			id: securities.id,
			name: securities.name,
			ticker: securities.ticker,
			mic: securities.mic,
			isin: securities.isin,
			currency: securities.currency,
		})
		.from(securities)
		.orderBy(asc(securities.name), asc(securities.id));

	return rows
		.filter((row) =>
			[row.name, row.ticker, row.isin].some(
				(text) => text !== null && folded(text).includes(needle),
			),
		)
		.slice(0, KNOWN_LIMIT);
}

/** A key a listing and a known security share: the ticker upper-cased and the venue. */
const listingKey = (ticker: string, mic: string | null) => `${ticker.toUpperCase()} ${mic ?? ""}`;

/**
 * Sure's `Security.search_provider`, for the trade form: the securities
 * already known, read even while fetching is off, then the provider's
 * listings not among those. Off, the provider hears nothing; failing, the
 * known part still answers, with `unavailable` set.
 */
export async function searchSecurities(
	deps: Pick<PriceDeps, "db" | "priceApiUrl">,
	query: string,
): Promise<{
	enabled: boolean;
	known: KnownSecurity[];
	items: SecurityMatch[];
	unavailable: boolean;
}> {
	const known = await knownSecurities(deps, query);
	const provider = await enabledProvider(deps);

	if (provider === null) {
		return { enabled: false, known, items: [], unavailable: false };
	}

	let listings: SecurityMatch[];

	try {
		listings = await provider.searchSecurities(query);
	} catch (error) {
		if (error instanceof AppError && error.code === "PRICE_PROVIDER_ERROR") {
			return { enabled: true, known, items: [], unavailable: true };
		}

		throw error;
	}

	// Against the known securities answered only: a stored listing the text
	// does not match, such as `MC.PA` stored without the ISIN typed, stays
	// offered, and picking it finds the stored one again.
	const knownKeys = new Set(
		known.flatMap(({ ticker, mic }) => (ticker === null ? [] : [listingKey(ticker, mic)])),
	);

	return {
		enabled: true,
		known,
		items: listings.filter((listing) => !knownKeys.has(listingKey(listing.ticker, listing.mic))),
		unavailable: false,
	};
}
