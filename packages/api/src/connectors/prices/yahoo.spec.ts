import type { JsonBodyType } from "msw";

import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { TEST_YAHOO_URL, chartBody, mockYahoo, yahooFixtures } from "../../testing/yahoo.ts";
import { createPriceProvider } from "../registry.ts";
import { micOf, priceDate, yahooSymbol } from "./yahoo.ts";

// A trailing slash on the URL must not double the one of each path.
const yahoo = createPriceProvider("yahoo", { apiUrl: `${TEST_YAHOO_URL}/` });

const USER_AGENTS = /^Mozilla\/5\.0 \(.+\) (?:AppleWebKit|Gecko)\//u;

const request = { ticker: "MC", mic: "XPAR", from: "2026-09-07", to: "2026-09-21" } as const;

/** A chart answer as given, for the shapes no fixture holds. */
const series = (body: JsonBodyType) => () => HttpResponse.json(body);

const meta = { currency: "EUR", gmtoffset: 7200 };

/**
 * Every bar of `chartMcPa` but the holiday's, the last day's live bar
 * winning, rounded to its `priceHint` of two decimals: 612.4000244140625 is
 * 612.40.
 */
const MC_PA_PRICES = [
	{ date: "2026-09-07", price: 612_400_000 },
	{ date: "2026-09-08", price: 618_200_000 },
	{ date: "2026-09-09", price: 615_000_000 },
	{ date: "2026-09-11", price: 609_800_000 },
	{ date: "2026-09-14", price: 604_500_000 },
	{ date: "2026-09-15", price: 611_100_000 },
	{ date: "2026-09-16", price: 619_900_000 },
	{ date: "2026-09-17", price: 622_300_000 },
	{ date: "2026-09-18", price: 625_000_000 },
	{ date: "2026-09-21", price: 628_100_000 },
];

/** One bar on 2026-09-21 closing at `close`, with `fields` added to its `meta`. */
const oneBar = (close: number, fields: Record<string, number | string | null> = {}) =>
	series({
		chart: {
			result: [
				{
					meta: { ...meta, ...fields },
					timestamp: [Date.parse("2026-09-21T07:00:00Z") / 1000],
					indicators: { quote: [{ close: [close] }] },
				},
			],
			error: null,
		},
	});

describe("searchSecurities", () => {
	it("asks Yahoo's search for the query upper-cased, with Sure's headers", async () => {
		const requests = mockYahoo();

		await yahoo.searchSecurities("  mc ");

		expect(requests.map(({ path, params }) => ({ path, params }))).toEqual([
			{ path: "/v1/finance/search", params: { q: "MC", quotesCount: "25" } },
		]);
		expect(requests[0]?.userAgent).toMatch(USER_AGENTS);
	});

	it("maps each quote to a listing, its venue from Yahoo's code or the symbol's suffix", async () => {
		mockYahoo();

		await expect(yahoo.searchSecurities("MC")).resolves.toEqual([
			{
				ticker: "MC.PA",
				name: "LVMH Moët Hennessy - Louis Vuitton, Société Européenne",
				mic: "XPAR",
				currency: "EUR",
				provider: "yahoo",
			},
			// An over-the-counter code is no venue Archant knows, nor its currency.
			{
				ticker: "LVMUY",
				name: "LVMH Moët Hennessy - Louis Vuitton, Société Européenne",
				mic: null,
				currency: null,
				provider: "yahoo",
			},
			// `MIL` is unknown to Sure's map; the `.MI` suffix names Milan.
			{ ticker: "MC.MI", name: "LVMH", mic: "XMIL", currency: "EUR", provider: "yahoo" },
			// A venue whose currency Sure's table does not give.
			{
				ticker: "MCHP",
				name: "Microchip Technology Incorporated",
				mic: "XNAS",
				currency: null,
				provider: "yahoo",
			},
			// An empty long name falls back on the short one.
			{ ticker: "MOH.DE", name: "LVMH", mic: "XETR", currency: "EUR", provider: "yahoo" },
			// No name at all: the symbol. The index and the exchange rate after
			// it are left out, whatever the case of their type: no account holds one.
			{ ticker: "MOH.F", name: "MOH.F", mic: "XFRA", currency: "EUR", provider: "yahoo" },
		]);
	});

	it("keeps a quote that names no type", async () => {
		mockYahoo({
			search: () =>
				HttpResponse.json({
					quotes: [{ symbol: "AI.PA", exchange: "PAR", shortname: "AIR LIQUIDE" }],
				}),
		});

		await expect(yahoo.searchSecurities("AI")).resolves.toEqual([
			{ ticker: "AI.PA", name: "AIR LIQUIDE", mic: "XPAR", currency: "EUR", provider: "yahoo" },
		]);
	});

	it("finds nothing when Yahoo lists no quote", async () => {
		mockYahoo({ search: () => HttpResponse.json({ count: 0, news: [] }) });

		await expect(yahoo.searchSecurities("ZZZZ")).resolves.toEqual([]);
	});

	it.each([
		["a server error", () => new HttpResponse("Internal Server Error", { status: 500 })],
		[
			"a rate limit",
			() => HttpResponse.json({ finance: { error: "Too Many Requests" } }, { status: 429 }),
		],
		["a body that is not JSON", () => new HttpResponse("<html>", { status: 200 })],
		["quotes that are not a list", () => HttpResponse.json({ quotes: "MC.PA" })],
		["a network failure", () => HttpResponse.error()],
	])("answers PRICE_PROVIDER_ERROR on %s, keeping nothing of it", async (_, answer) => {
		mockYahoo({ search: answer });

		await expect(yahoo.searchSecurities("MC")).rejects.toMatchObject({
			code: "PRICE_PROVIDER_ERROR",
			message: "The price provider request failed.",
		});
	});
});

describe("dailyPrices", () => {
	it("asks for the window's days, from midnight to the last second, one bar a day", async () => {
		const requests = mockYahoo();

		await yahoo.dailyPrices(request);

		expect(requests.map(({ path, params }) => ({ path, params }))).toEqual([
			{
				path: "/v8/finance/chart/MC.PA",
				params: {
					period1: String(Date.parse("2026-09-07T00:00:00Z") / 1000),
					period2: String(Date.parse("2026-09-21T23:59:59Z") / 1000),
					interval: "1d",
				},
			},
		]);
		expect(requests[0]?.userAgent).toMatch(USER_AGENTS);
	});

	it("reads every close into millionths, skipping a missing one, the last bar of a day winning", async () => {
		mockYahoo();

		await expect(yahoo.dailyPrices(request)).resolves.toEqual({
			currency: "EUR",
			prices: MC_PA_PRICES,
		});
	});

	it("turns pence into pounds", async () => {
		mockYahoo({
			chart: () =>
				HttpResponse.json(
					chartBody(
						[
							["2026-09-17", 8945],
							["2026-09-18", 8945.5],
							["2026-09-21", 0.5],
						],
						"GBp",
					),
				),
		});

		await expect(yahoo.dailyPrices({ ...request, ticker: "VUSA", mic: "XLON" })).resolves.toEqual({
			currency: "GBP",
			prices: [
				{ date: "2026-09-17", price: 89_450_000 },
				{ date: "2026-09-18", price: 89_455_000 },
				{ date: "2026-09-21", price: 5000 },
			],
		});
	});

	it.each([
		// No `priceHint`: four decimals, as Sure's `decimal(19,4)`, half to even.
		["no price hint", 12.34567, {}, 12_345_700],
		["no price hint, a tie", 12.34565, {}, 12_345_600],
		["a hint of none", 12.5, { priceHint: 0 }, 12_000_000],
		["a hint below none", 13.5, { priceHint: -1 }, 14_000_000],
		["a hint beyond millionths", 12.3456789, { priceHint: 9 }, 12_345_679],
	])("rounds a close to the venue's decimals with %s", async (_, close, fields, price) => {
		mockYahoo({ chart: oneBar(close, fields) });

		await expect(yahoo.dailyPrices(request)).resolves.toEqual({
			currency: "EUR",
			prices: [{ date: "2026-09-21", price }],
		});
	});

	it("falls back on the venue's currency when Yahoo names none, as Sure", async () => {
		mockYahoo({ chart: oneBar(12.5, { currency: null }) });

		await expect(yahoo.dailyPrices(request)).resolves.toEqual({
			currency: "EUR",
			prices: [{ date: "2026-09-21", price: 12_500_000 }],
		});
	});

	it.each([
		["no venue", null],
		["a venue whose currency Sure's table does not give", "XNAS"],
	])("answers PRICE_UNAVAILABLE without a currency on %s", async (_, mic) => {
		mockYahoo({ chart: oneBar(12.5, { currency: null }) });

		await expect(yahoo.dailyPrices({ ...request, ticker: "AAPL", mic })).rejects.toMatchObject({
			code: "PRICE_UNAVAILABLE",
		});
	});

	it("reads a bar's day in UTC when the venue gives no offset", async () => {
		mockYahoo({
			chart: series({
				chart: {
					result: [
						{
							meta: { currency: "EUR" },
							timestamp: [Date.parse("2026-09-21T23:30:00Z") / 1000],
							indicators: { quote: [{ close: [12.5] }] },
						},
					],
					error: null,
				},
			}),
		});

		await expect(yahoo.dailyPrices(request)).resolves.toEqual({
			currency: "EUR",
			prices: [{ date: "2026-09-21", price: 12_500_000 }],
		});
	});

	it("skips a close that is not positive or not a plain decimal", async () => {
		mockYahoo({
			chart: () =>
				HttpResponse.json(
					chartBody([
						["2026-09-16", 0],
						["2026-09-17", -1.5],
						["2026-09-18", 1e-7],
						["2026-09-21", 12.5],
					]),
				),
		});

		await expect(yahoo.dailyPrices(request)).resolves.toEqual({
			currency: "EUR",
			prices: [{ date: "2026-09-21", price: 12_500_000 }],
		});
	});

	it.each([
		["Yahoo's 404", () => HttpResponse.json(yahooFixtures.chartNotFound, { status: 404 })],
		[
			"Yahoo's 400 for a range without data",
			() => HttpResponse.json(yahooFixtures.chartNoData, { status: 400 }),
		],
		["an error in the answer", series({ chart: { result: null, error: { code: "Not Found" } } })],
		["no result", series({ chart: { result: null, error: null } })],
		["an empty result", series({ chart: { result: [], error: null } })],
		["an empty result and no error field", series({ chart: { result: [] } })],
		[
			"no timestamp",
			series({ chart: { result: [{ meta, indicators: { quote: [{}] } }], error: null } }),
		],
		[
			"no quote",
			series({
				chart: { result: [{ meta, timestamp: [1], indicators: { quote: [] } }], error: null },
			}),
		],
		[
			"no close",
			series({
				chart: { result: [{ meta, timestamp: [1], indicators: { quote: [{}] } }], error: null },
			}),
		],
		["only missing closes", () => HttpResponse.json(chartBody([["2026-09-21", null]]))],
		[
			"a currency outside ISO 4217",
			() => HttpResponse.json(chartBody([["2026-09-21", 12.5]], "ABC")),
		],
	])("answers PRICE_UNAVAILABLE on %s", async (_, answer) => {
		mockYahoo({ chart: answer });

		await expect(yahoo.dailyPrices(request)).rejects.toMatchObject({
			code: "PRICE_UNAVAILABLE",
			message: "The price provider has no price for this security.",
		});
	});

	it.each([
		["a server error", () => new HttpResponse("Service Unavailable", { status: 503 })],
		["an authorisation demand", () => HttpResponse.json({}, { status: 401 })],
		["a body that is not JSON", () => new HttpResponse("<html>", { status: 200 })],
		[
			"an answer its schema refuses",
			series({
				chart: { result: [{ meta, timestamp: ["x"], indicators: { quote: [] } }] },
			}),
		],
		[
			"Yahoo's demand for a crumb, which no listing answers",
			series({
				chart: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } },
			}),
		],
		[
			"a refusal that is not about the listing",
			() => HttpResponse.json({ chart: { result: null, error: null } }, { status: 400 }),
		],
		["a network failure", () => HttpResponse.error()],
	])("answers PRICE_PROVIDER_ERROR on %s", async (_, answer) => {
		mockYahoo({ chart: answer });

		await expect(yahoo.dailyPrices(request)).rejects.toMatchObject({
			code: "PRICE_PROVIDER_ERROR",
		});
	});
});

describe("yahooSymbol", () => {
	it.each([
		["MC", "XPAR", "MC.PA"],
		["MC.PA", "XPAR", "MC.PA"],
		["mc.pa", "XPAR", "mc.pa"],
		["VUSA", "XLON", "VUSA.L"],
		["AAPL", "XNAS", "AAPL"],
		["AAPL", null, "AAPL"],
	])("asks for %s on %s as %s", (ticker, mic, symbol) => {
		expect(yahooSymbol(ticker, mic)).toBe(symbol);
	});
});

describe("micOf", () => {
	it.each([
		[" par ", "MC.PA", "XPAR"],
		[null, "MC.PA", "XPAR"],
		[null, "AI.PA", "XPAR"],
		["GER", "SAP.DE", "XETR"],
		["PNK", "LVMUY", null],
	])("reads the exchange %j and the symbol %s as %s", (exchange, symbol, mic) => {
		expect(micOf(exchange, symbol)).toBe(mic);
	});
});

describe("priceDate", () => {
	it("dates a bar on its venue's clock, not on UTC's", () => {
		// 09:00 in Tokyo is midnight UTC the day before.
		expect(priceDate(Date.parse("2026-09-20T23:00:00Z") / 1000, 9 * 3600)).toBe("2026-09-21");
		// 09:30 in New York.
		expect(priceDate(Date.parse("2026-09-21T13:30:00Z") / 1000, -4 * 3600)).toBe("2026-09-21");
	});
});
