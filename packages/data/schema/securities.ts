import type { Micros } from "../micros.ts";

import { sql } from "drizzle-orm";
import {
	check,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { inList } from "./check.ts";

/**
 * The price providers a security can be fetched from (AD-22). `null` on a
 * security is one priced by hand, such as a fonds euros.
 */
export const PRICE_PROVIDER_IDS = ["yahoo"] as const;

export type PriceProviderId = (typeof PRICE_PROVIDER_IDS)[number];

/** Where a price came from: the provider's fetch, or the owner typing it. */
export const PRICE_SOURCES = ["provider", "manual"] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

/**
 * Sure's `Security`: one listing, known by its ISIN, its ticker and its
 * venue's MIC, each optional, as a security created offline by ISIN and name
 * has no ticker. Five failed fetches in a row set `offline`, which the daily
 * fetch skips, as Sure's health check.
 */
export const securities = sqliteTable(
	"securities",
	{
		id: text("id").primaryKey(),
		isin: text("isin"),
		ticker: text("ticker"),
		/** ISO 10383 operating MIC, such as `XPAR`. */
		mic: text("mic"),
		name: text("name").notNull(),
		/** ISO 4217, the currency the listing is priced in. */
		currency: text("currency").notNull(),
		provider: text("provider").$type<PriceProviderId>(),
		offline: integer("offline", { mode: "boolean" }).notNull().default(false),
		failedFetchCount: integer("failed_fetch_count").notNull().default(0),
		/**
		 * `YYYY-MM-DD`: the provider's first day, once a fetch found no price
		 * before it, as Sure's `first_provider_price_on`. No fetch starts earlier.
		 */
		firstPriceOn: text("first_price_on"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// Sure's `index_securities_on_ticker_and_exchange_operating_mic_unique`:
		// one row per listing, whatever the ticker's case. A null ticker is never
		// equal to another, so securities created offline never collide.
		uniqueIndex("securities_ticker_mic_unique").on(
			sql`upper(${table.ticker})`,
			sql`coalesce(${table.mic}, '')`,
		),
		check("securities_provider_check", sql`${table.provider} in ${inList(PRICE_PROVIDER_IDS)}`),
		check("securities_failed_fetch_count_check", sql`${table.failedFetchCount} >= 0`),
	],
);

/**
 * Sure's `Security::Price`: one close per security and calendar day, gaps
 * carried from the last known price. `provisional` marks the last seven
 * days, which the next fetch writes again; a `manual` price is never
 * overwritten by a fetch.
 */
export const securityPrices = sqliteTable(
	"security_prices",
	{
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "cascade" }),
		/** `YYYY-MM-DD`. */
		date: text("date").notNull(),
		/** Millionths of `currency`'s major unit (AD-22). */
		price: integer("price").$type<Micros>().notNull(),
		currency: text("currency").notNull(),
		provisional: integer("provisional", { mode: "boolean" }).notNull().default(false),
		source: text("source").$type<PriceSource>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.securityId, table.date] }),
		check("security_prices_price_check", sql`${table.price} > 0`),
		check("security_prices_source_check", sql`${table.source} in ${inList(PRICE_SOURCES)}`),
	],
);
