import type { IsoDate } from "../domain/dates.ts";
import type { JsonBodyType } from "msw";

import { http, HttpResponse } from "msw";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { server } from "../../vitest.setup.ts";

/** `YAHOO_FINANCE_URL`'s default, which msw answers in every spec. */
export const TEST_YAHOO_URL = "https://query1.finance.yahoo.com";

async function load(name: string): Promise<JsonBodyType> {
	return z
		.json()
		.parse(
			JSON.parse(
				await readFile(new URL(`../connectors/prices/fixtures/${name}`, import.meta.url), "utf8"),
			),
		);
}

/**
 * Shaped as Yahoo Finance answers, field for field, not recorded live: no
 * test reaches Yahoo. `chartMcPa` is LVMH on Euronext Paris from 2026-09-07
 * to 2026-09-21, a holiday's close missing and the last day twice, as Yahoo
 * adds the session's live bar after its open.
 */
export const yahooFixtures = {
	search: await load("search-mc.json"),
	chartMcPa: await load("chart-mc-pa.json"),
	chartNotFound: await load("chart-not-found.json"),
	chartNoData: await load("chart-no-data.json"),
};

/** A Paris session's open, 09:00 CEST, as Yahoo stamps a daily bar. */
const OPEN_UTC = "T07:00:00Z";

/**
 * A chart answer in the shape of `chartMcPa`, with one bar per day given:
 * what the price service specs fetch for any window they choose.
 */
export function chartBody(
	closes: [IsoDate, number | null][],
	currency: string | null = "EUR",
): JsonBodyType {
	return {
		chart: {
			result: [
				{
					meta: { currency, symbol: "MC.PA", exchangeName: "PAR", gmtoffset: 7200 },
					timestamp: closes.map(([date]) => Date.parse(`${date}${OPEN_UTC}`) / 1000),
					indicators: { quote: [{ close: closes.map(([, close]) => close) }] },
				},
			],
			error: null,
		},
	};
}

export type YahooRequest = {
	path: string;
	params: Record<string, string>;
	userAgent: string | null;
};

type YahooHandlers = {
	search?: (url: URL) => Response | Promise<Response>;
	chart?: (symbol: string, url: URL) => Response | Promise<Response>;
};

/**
 * Serves Yahoo's search and chart endpoints, from the fixtures or from
 * `handlers`, and records every request so a spec can read what was sent.
 */
export function mockYahoo(handlers: YahooHandlers = {}): YahooRequest[] {
	const requests: YahooRequest[] = [];
	const record = (request: Request) => {
		const url = new URL(request.url);
		requests.push({
			path: url.pathname,
			params: Object.fromEntries(url.searchParams),
			userAgent: request.headers.get("user-agent"),
		});

		return url;
	};

	server.use(
		http.get(`${TEST_YAHOO_URL}/v1/finance/search`, async ({ request }) => {
			const url = record(request);

			return handlers.search === undefined
				? HttpResponse.json(yahooFixtures.search)
				: handlers.search(url);
		}),
		http.get(`${TEST_YAHOO_URL}/v8/finance/chart/:symbol`, async ({ request, params }) => {
			const url = record(request);

			return handlers.chart === undefined
				? HttpResponse.json(yahooFixtures.chartMcPa)
				: handlers.chart(String(params["symbol"]), url);
		}),
	);

	return requests;
}
