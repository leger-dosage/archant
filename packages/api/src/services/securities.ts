import type { PriceProvider, SecurityMatch } from "../connectors/prices/price-provider.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";

import { asc, eq } from "drizzle-orm";

import { PRICE_PROVIDER_IDS, securities } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";

import { createPriceProvider } from "../connectors/registry.ts";
import { today } from "../domain/dates.ts";

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
 * The securities whose prices are fetched, oldest first. Every security,
 * from its creation day in `APP_TIMEZONE`, until Story 22.2's trades say
 * which are held and since when.
 */
export async function heldSecurities(
	deps: Pick<PriceDeps, "db" | "timeZone">,
): Promise<HeldSecurity[]> {
	const rows = await deps.db
		.select({ id: securities.id, createdAt: securities.createdAt })
		.from(securities)
		.orderBy(asc(securities.createdAt), asc(securities.id));

	return rows.map(({ id, createdAt }) => ({
		securityId: id,
		from: today(deps.timeZone, new Date(createdAt)),
	}));
}

/**
 * Sure's `Security.search_provider`, for Story 22.2's trade form: the
 * provider's listings for `query`. Off, the provider hears nothing and the
 * form offers a security typed by hand alone.
 */
export async function searchSecurities(
	deps: Pick<PriceDeps, "db" | "priceApiUrl">,
	query: string,
): Promise<{ enabled: boolean; items: SecurityMatch[] }> {
	const provider = await enabledProvider(deps);

	if (provider === null) {
		return { enabled: false, items: [] };
	}

	return { enabled: true, items: await provider.searchSecurities(query) };
}
