import type { TempDatabase } from "../testing/temp-database.ts";
import type { PriceDeps } from "./securities.ts";

import { asc, eq } from "drizzle-orm";
import { HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";

import { createLogger } from "../lib/logger.ts";
import { deleteSecurities, holdSecurity, insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { TEST_YAHOO_URL, chartBody, mockYahoo, yahooFixtures } from "../testing/yahoo.ts";
import { priceStatus, setPricesEnabled, startDailyPrices, updatePrices } from "./prices.ts";
import { heldSecurities, searchSecurities } from "./securities.ts";

const NOW = Date.parse("2026-09-21T10:00:00Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

let temp: TempDatabase;
let logLines: string[];

function deps(): PriceDeps {
	logLines = [];

	return {
		db: temp.db,
		timeZone: "Europe/Paris",
		logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
		priceApiUrl: TEST_YAHOO_URL,
	};
}

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

beforeEach(async () => {
	vi.restoreAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	await deleteSecurities(temp.db);
	await temp.db.delete(settings);
});

const newSecurity = async (
	fields: Parameters<typeof insertSecurity>[1] = {},
	options: Parameters<typeof insertSecurity>[2] = {},
) => insertSecurity(temp.db, fields, options);

async function enable() {
	await setPricesEnabled(deps(), true);
}

async function pricesOf(securityId: string) {
	return temp.db
		.select({
			date: securityPrices.date,
			price: securityPrices.price,
			provisional: securityPrices.provisional,
			source: securityPrices.source,
		})
		.from(securityPrices)
		.where(eq(securityPrices.securityId, securityId))
		.orderBy(asc(securityPrices.date));
}

async function securityRow(id: string) {
	return temp.db
		.select({
			offline: securities.offline,
			failedFetchCount: securities.failedFetchCount,
			firstPriceOn: securities.firstPriceOn,
		})
		.from(securities)
		.where(eq(securities.id, id))
		.get();
}

async function setting(key: string) {
	const row = await temp.db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, key))
		.get();

	return row?.value ?? null;
}

const epoch = (date: string, time: string) => String(Date.parse(`${date}T${time}Z`) / 1000);

/** Every day of `chartMcPa` from Monday 14, the weekend carried from Friday. */
const FIRST_FETCH = [
	{ date: "2026-09-14", price: 604_500_000, provisional: true, source: "provider" },
	{ date: "2026-09-15", price: 611_100_000, provisional: true, source: "provider" },
	{ date: "2026-09-16", price: 619_900_000, provisional: true, source: "provider" },
	{ date: "2026-09-17", price: 622_300_000, provisional: true, source: "provider" },
	{ date: "2026-09-18", price: 625_000_000, provisional: true, source: "provider" },
	{ date: "2026-09-19", price: 625_000_000, provisional: true, source: "provider" },
	{ date: "2026-09-20", price: 625_000_000, provisional: true, source: "provider" },
	{ date: "2026-09-21", price: 628_100_000, provisional: true, source: "provider" },
];

describe("price fetching off", () => {
	it("reaches nothing: no daily run, the button refused, an empty search", async () => {
		const requests = mockYahoo();
		await newSecurity();

		await expect(startDailyPrices(deps())).resolves.toBeNull();
		await expect(updatePrices(deps())).rejects.toMatchObject({ code: "PRICES_DISABLED" });
		await expect(searchSecurities(deps(), "MC")).resolves.toEqual({
			enabled: false,
			known: [expect.objectContaining({ ticker: "MC.PA" })],
			items: [],
			unavailable: false,
		});
		await expect(priceStatus(deps())).resolves.toEqual({
			enabled: false,
			host: "query1.finance.yahoo.com",
			lastUpdatedAt: null,
			lastError: null,
			updating: false,
		});
		expect(requests).toEqual([]);
	});

	it("is the state a row naming no known provider leaves", async () => {
		const requests = mockYahoo();
		await temp.db
			.insert(settings)
			.values({ key: "price_provider", value: "boursorama", updatedAt: NOW });

		await expect(startDailyPrices(deps())).resolves.toBeNull();
		await expect(priceStatus(deps())).resolves.toMatchObject({ enabled: false });
		expect(requests).toEqual([]);
	});

	it("keeps every price once turned off again", async () => {
		mockYahoo();
		const id = await newSecurity();
		await enable();
		await updatePrices(deps());

		await expect(setPricesEnabled(deps(), false)).resolves.toMatchObject({ enabled: false });

		await expect(setting("price_provider")).resolves.toBeNull();
		await expect(pricesOf(id)).resolves.toHaveLength(8);
	});
});

describe("searchSecurities", () => {
	it("asks the provider once fetching is on", async () => {
		const requests = mockYahoo();
		await enable();

		const { enabled, items } = await searchSecurities(deps(), "mc");

		expect(enabled).toBe(true);
		expect(items[0]).toEqual({
			ticker: "MC.PA",
			name: "LVMH Moët Hennessy - Louis Vuitton, Société Européenne",
			mic: "XPAR",
			currency: "EUR",
			provider: "yahoo",
		});
		expect(requests.map(({ params }) => params["q"])).toEqual(["MC"]);
	});

	it("offers the known securities first, by name, ticker or ISIN, case and accents aside", async () => {
		mockYahoo();
		const lvmh = await newSecurity({ name: "LVMH Moët Hennessy" }, { held: false });
		const fund = await newSecurity(
			{ name: "Fonds euros", ticker: null, mic: null, provider: null, isin: null },
			{ held: false },
		);
		await newSecurity(
			{ name: "Air Liquide", ticker: "AI.PA", isin: "FR0000120073" },
			{ held: false },
		);

		const byName = await searchSecurities(deps(), "MOET");
		const byTicker = await searchSecurities(deps(), "mc.p");
		const byIsin = await searchSecurities(deps(), "fr000012");
		const typedByHand = await searchSecurities(deps(), "euros");

		expect(byName.known).toEqual([
			{
				id: lvmh,
				name: "LVMH Moët Hennessy",
				ticker: "MC.PA",
				mic: "XPAR",
				isin: "FR0000121014",
				currency: "EUR",
			},
		]);
		expect(byTicker.known.map(({ id }) => id)).toEqual([lvmh]);
		expect(byIsin.known.map(({ name }) => name)).toEqual(["Air Liquide", "LVMH Moët Hennessy"]);
		expect(typedByHand.known.map(({ id }) => id)).toEqual([fund]);
	});

	it("offers ten known securities at most", async () => {
		await Promise.all(
			Array.from({ length: 12 }, async (_, index) =>
				newSecurity({ name: `Titre ${index}`, ticker: `T${index}.PA` }, { held: false }),
			),
		);

		const { known } = await searchSecurities(deps(), "titre");

		expect(known).toHaveLength(10);
	});

	it("leaves out the provider's listings already known, whatever the ticker's case", async () => {
		mockYahoo();
		await enable();
		await newSecurity({ ticker: "mc.pa" }, { held: false });
		// The same symbol on another venue is another listing.
		await newSecurity({ ticker: "MC.MI", mic: "XPAR" }, { held: false });

		const { known, items } = await searchSecurities(deps(), "mc");

		expect(known.map(({ ticker }) => ticker ?? "").toSorted((a, b) => a.localeCompare(b))).toEqual([
			"MC.MI",
			"mc.pa",
		]);
		expect(items.map(({ ticker }) => ticker)).toEqual([
			"LVMUY",
			"MC.MI",
			"MCHP",
			"MOH.DE",
			"MOH.F",
		]);
	});

	it("keeps offering a stored listing the text does not find among the known ones", async () => {
		mockYahoo();
		await enable();
		// Stored from a search, without the ISIN the owner now types.
		await newSecurity({ isin: null }, { held: false });

		const { known, items } = await searchSecurities(deps(), "FR0000121014");

		expect(known).toEqual([]);
		expect(items.map(({ ticker }) => ticker)).toContain("MC.PA");
	});

	it("answers the known part, unavailable, when the provider fails", async () => {
		mockYahoo({ search: () => new HttpResponse(null, { status: 500 }) });
		await enable();
		await newSecurity({}, { held: false });

		await expect(searchSecurities(deps(), "LVMH")).resolves.toEqual({
			enabled: true,
			known: [expect.objectContaining({ ticker: "MC.PA" })],
			items: [],
			unavailable: true,
		});
	});
});

describe("heldSecurities", () => {
	it("holds each traded security from its first trade, a sold one too, and no other", async () => {
		// Created a week before its first trade: the trade, not the row, decides.
		const late = await newSecurity({ ticker: "AI.PA" }, { held: false });
		await holdSecurity(temp.db, late, "2026-09-16");
		await holdSecurity(temp.db, late, "2026-09-18");
		const early = await newSecurity();
		await newSecurity({ ticker: "OR.PA" }, { held: false });

		await expect(heldSecurities(deps())).resolves.toEqual([
			{ securityId: early, from: "2026-09-14" },
			{ securityId: late, from: "2026-09-16" },
		]);
	});
});

describe("updatePrices", () => {
	it("fetches a new security from the day it is held, a row a day, the last seven provisional", async () => {
		const requests = mockYahoo();
		const id = await newSecurity();
		await enable();

		const status = await updatePrices(deps());

		expect(requests).toEqual([
			expect.objectContaining({
				path: "/v8/finance/chart/MC.PA",
				params: {
					period1: epoch("2026-09-07", "00:00:00"),
					period2: epoch("2026-09-21", "23:59:59"),
					interval: "1d",
				},
			}),
		]);
		await expect(pricesOf(id)).resolves.toEqual(FIRST_FETCH);
		await expect(securityRow(id)).resolves.toEqual({
			offline: false,
			failedFetchCount: 0,
			firstPriceOn: null,
		});
		expect(status).toEqual({
			enabled: true,
			host: "query1.finance.yahoo.com",
			lastUpdatedAt: NOW,
			lastError: null,
			updating: false,
		});
	});

	it("fetches the provisional days again the next day, and the new one", async () => {
		mockYahoo();
		const id = await newSecurity();
		await enable();
		await updatePrices(deps());
		vi.setSystemTime(NOW + DAY);
		const requests = mockYahoo({
			chart: () =>
				HttpResponse.json(
					chartBody([
						["2026-09-11", 600],
						["2026-09-14", 601],
						["2026-09-15", 602],
						["2026-09-16", 603],
						["2026-09-17", 604],
						["2026-09-18", 605],
						["2026-09-21", 606],
						["2026-09-22", 607],
					]),
				),
		});

		await updatePrices(deps());

		expect(requests.map(({ params }) => params["period1"])).toEqual([
			epoch("2026-09-07", "00:00:00"),
		]);
		await expect(pricesOf(id)).resolves.toEqual(
			[
				["2026-09-14", 601, false],
				["2026-09-15", 602, true],
				["2026-09-16", 603, true],
				["2026-09-17", 604, true],
				["2026-09-18", 605, true],
				["2026-09-19", 605, true],
				["2026-09-20", 605, true],
				["2026-09-21", 606, true],
				["2026-09-22", 607, true],
			].map(([date, price, provisional]) => ({
				date,
				price: Number(price) * 1_000_000,
				provisional,
				source: "provider",
			})),
		);
	});

	it("asks nothing for a security stored for good up to today", async () => {
		const id = await newSecurity();
		await temp.db.insert(securityPrices).values(
			["2026-09-14", "2026-09-21"].map((date) => ({
				securityId: id,
				date,
				price: toMicros(1),
				currency: "EUR",
				provisional: false,
				source: "provider" as const,
			})),
		);
		const requests = mockYahoo();
		await enable();

		await expect(updatePrices(deps())).resolves.toMatchObject({ lastError: null });

		expect(requests).toEqual([]);
	});

	it("never writes over a typed price", async () => {
		mockYahoo();
		const id = await newSecurity();
		await temp.db.insert(securityPrices).values({
			securityId: id,
			date: "2026-09-17",
			price: toMicros(1_000_000),
			currency: "EUR",
			source: "manual",
		});
		await enable();

		await updatePrices(deps());

		const rows = await pricesOf(id);
		expect(rows.find(({ date }) => date === "2026-09-17")).toEqual({
			date: "2026-09-17",
			price: 1_000_000,
			provisional: false,
			source: "manual",
		});
		// Every other day of the window is the provider's.
		expect(rows).toHaveLength(8);
	});

	it("keeps a typed price written while the run fetched", async () => {
		const id = await newSecurity();
		mockYahoo({
			chart: async () => {
				await temp.db.insert(securityPrices).values({
					securityId: id,
					date: "2026-09-17",
					price: toMicros(1_000_000),
					currency: "EUR",
					source: "manual",
				});

				return HttpResponse.json(yahooFixtures.chartMcPa);
			},
		});
		await enable();

		await updatePrices(deps());

		const rows = await pricesOf(id);
		expect(rows.find(({ date }) => date === "2026-09-17")).toEqual({
			date: "2026-09-17",
			price: 1_000_000,
			provisional: false,
			source: "manual",
		});
		expect(rows).toHaveLength(8);
	});

	it("resumes after the provider's last day, not after a later typed price", async () => {
		const id = await newSecurity();
		await temp.db.insert(securityPrices).values([
			...["2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({
				securityId: id,
				date,
				price: toMicros(600_000_000),
				currency: "EUR",
				source: "provider" as const,
			})),
			{
				securityId: id,
				date: "2026-09-20",
				price: toMicros(1_000_000),
				currency: "EUR",
				source: "manual" as const,
			},
		]);
		const requests = mockYahoo();
		await enable();

		await updatePrices(deps());

		expect(requests.map(({ params }) => params["period1"])).toEqual([
			epoch("2026-09-10", "00:00:00"),
		]);
		await expect(pricesOf(id)).resolves.toEqual([
			...["2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({
				date,
				price: 600_000_000,
				provisional: false,
				source: "provider",
			})),
			...FIRST_FETCH.slice(3, 6),
			{ date: "2026-09-20", price: 1_000_000, provisional: false, source: "manual" },
			{ date: "2026-09-21", price: 628_100_000, provisional: true, source: "provider" },
		]);
	});

	it("keeps the provider's first day once known", async () => {
		const id = await newSecurity({ firstPriceOn: "2026-09-10" });
		mockYahoo();
		await enable();

		await updatePrices(deps());

		await expect(securityRow(id)).resolves.toMatchObject({ firstPriceOn: "2026-09-10" });
		await expect(pricesOf(id)).resolves.toEqual(FIRST_FETCH);
	});

	it("updates with no security at all, asking nothing", async () => {
		const requests = mockYahoo();
		await enable();

		await expect(updatePrices(deps())).resolves.toMatchObject({
			lastUpdatedAt: NOW,
			lastError: null,
		});
		expect(requests).toEqual([]);
	});

	it("asks nothing more once fetching is turned off during a run", async () => {
		const first = await newSecurity({ ticker: "MC.PA" });
		// Created later, so asked for second.
		await newSecurity({ ticker: "AI.PA", createdAt: Date.parse("2026-09-14T09:00:00Z") });
		const requests = mockYahoo({
			chart: async () => {
				await setPricesEnabled(deps(), false);

				return HttpResponse.json(yahooFixtures.chartMcPa);
			},
		});
		await enable();

		await expect(updatePrices(deps())).resolves.toMatchObject({
			enabled: false,
			lastError: null,
		});

		expect(requests.map(({ path }) => path)).toEqual(["/v8/finance/chart/MC.PA"]);
		await expect(pricesOf(first)).resolves.toHaveLength(8);
	});

	it("skips the days before the provider's first one, and remembers it", async () => {
		const id = await newSecurity();
		mockYahoo({
			chart: () =>
				HttpResponse.json(
					chartBody([
						["2026-09-16", 20],
						["2026-09-17", 21],
					]),
				),
		});
		await enable();

		await updatePrices(deps());

		await expect(pricesOf(id)).resolves.toEqual(
			[
				["2026-09-16", 20],
				["2026-09-17", 21],
				["2026-09-18", 21],
				["2026-09-19", 21],
				["2026-09-20", 21],
				["2026-09-21", 21],
			].map(([date, price]) => ({
				date,
				price: Number(price) * 1_000_000,
				provisional: true,
				source: "provider",
			})),
		);
		await expect(securityRow(id)).resolves.toMatchObject({ firstPriceOn: "2026-09-16" });
	});

	it("fetches only the securities with a provider and a ticker", async () => {
		const requests = mockYahoo();
		await newSecurity({ provider: null, ticker: null, mic: null, name: "Fonds euros" });
		await newSecurity({ provider: null, ticker: "XYZ", mic: null });
		await newSecurity({ ticker: null, mic: null });
		await enable();

		await updatePrices(deps());

		expect(requests).toEqual([]);
	});

	it("counts a security's failure, and its fifth in a row sets it offline while the run goes on", async () => {
		const failing = await newSecurity({ ticker: "GONE.PA", failedFetchCount: 4 });
		const next = await newSecurity({ ticker: "AI.PA" });
		mockYahoo({
			chart: (symbol) =>
				symbol === "GONE.PA"
					? HttpResponse.json(yahooFixtures.chartNotFound, { status: 404 })
					: HttpResponse.json(yahooFixtures.chartMcPa),
		});
		await enable();

		const status = await updatePrices(deps());

		await expect(securityRow(failing)).resolves.toMatchObject({
			offline: true,
			failedFetchCount: 5,
		});
		await expect(pricesOf(next)).resolves.toHaveLength(8);
		expect(status).toMatchObject({ lastUpdatedAt: NOW, lastError: "PRICE_UNAVAILABLE" });
	});

	it("counts a listing priced in another currency than the security's", async () => {
		const id = await newSecurity({ currency: "USD" });
		mockYahoo();
		await enable();

		await expect(updatePrices(deps())).resolves.toMatchObject({ lastError: "PRICE_UNAVAILABLE" });

		await expect(securityRow(id)).resolves.toMatchObject({ offline: false, failedFetchCount: 1 });
		await expect(pricesOf(id)).resolves.toEqual([]);
	});

	it("stops on a provider failure, counting it against no security and keeping the last update", async () => {
		const first = await newSecurity({ ticker: "MC.PA" });
		const second = await newSecurity({ ticker: "AI.PA" });
		const requests = mockYahoo({
			chart: () => new HttpResponse("Service Unavailable", { status: 503 }),
		});
		await temp.db
			.insert(settings)
			.values({ key: "prices_updated_at", value: String(NOW - DAY), updatedAt: NOW - DAY });
		await enable();

		const status = await updatePrices(deps());

		expect(requests).toHaveLength(1);
		await expect(securityRow(first)).resolves.toMatchObject({ failedFetchCount: 0 });
		await expect(securityRow(second)).resolves.toMatchObject({ failedFetchCount: 0 });
		expect(status).toMatchObject({
			lastUpdatedAt: NOW - DAY,
			lastError: "PRICE_PROVIDER_ERROR",
			updating: false,
		});
		await expect(setting("prices_finished_at")).resolves.toBe(String(NOW));
	});

	it("brings an offline security back on a success, and clears the last error", async () => {
		const id = await newSecurity({ offline: true, failedFetchCount: 5 });
		await temp.db
			.insert(settings)
			.values({ key: "prices_last_error", value: "PRICE_UNAVAILABLE", updatedAt: NOW - DAY });
		mockYahoo();
		await enable();

		await expect(updatePrices(deps())).resolves.toMatchObject({ lastError: null });

		await expect(securityRow(id)).resolves.toMatchObject({ offline: false, failedFetchCount: 0 });
		await expect(setting("prices_last_error")).resolves.toBeNull();
	});

	it("is refused while a run holds the lease, which frees itself after ten minutes", async () => {
		mockYahoo();
		await enable();
		await temp.db
			.insert(settings)
			.values({ key: "prices_started_at", value: String(NOW - 9 * MINUTE), updatedAt: NOW });

		await expect(priceStatus(deps())).resolves.toMatchObject({ updating: true });
		await expect(updatePrices(deps())).rejects.toMatchObject({
			code: "PRICE_UPDATE_IN_PROGRESS",
		});

		vi.setSystemTime(NOW + 2 * MINUTE);

		await expect(updatePrices(deps())).resolves.toMatchObject({ updating: false });
	});

	it("logs ids, counts, durations and codes, never a ticker, an ISIN, a name or a price", async () => {
		const failing = await newSecurity({ ticker: "GONE.PA" });
		await newSecurity();
		mockYahoo({
			chart: (symbol) =>
				symbol === "GONE.PA"
					? HttpResponse.json(yahooFixtures.chartNotFound, { status: 404 })
					: HttpResponse.json(yahooFixtures.chartMcPa),
		});
		await enable();
		const runDeps = deps();

		await updatePrices(runDeps);

		const text = logLines.join("\n");
		expect(text).toContain(`"securityId":"${failing}"`);
		expect(text).toContain('"code":"PRICE_UNAVAILABLE"');
		expect(text).toContain('"msg":"security prices updated"');
		expect(text).toMatch(/"durationMs":\d+/u);
		for (const secret of [
			"MC.PA",
			"GONE.PA",
			"FR0000121014",
			"LVMH",
			"XPAR",
			"628100000",
			"628.1",
			"Not Found",
		]) {
			expect(text).not.toContain(secret);
		}
	});
});

describe("startDailyPrices", () => {
	it("runs once a day, skipping offline securities, which the button retries", async () => {
		const online = await newSecurity({ ticker: "MC.PA" });
		const offline = await newSecurity({ ticker: "AI.PA", offline: true, failedFetchCount: 5 });
		const requests = mockYahoo();
		await enable();

		const daily = await startDailyPrices(deps());

		expect(daily).not.toBeNull();
		await expect(priceStatus(deps())).resolves.toMatchObject({ updating: true });
		await daily?.run();
		expect(requests.map(({ path }) => path)).toEqual(["/v8/finance/chart/MC.PA"]);
		await expect(pricesOf(online)).resolves.toHaveLength(8);
		await expect(priceStatus(deps())).resolves.toMatchObject({
			updating: false,
			lastUpdatedAt: NOW,
		});

		// Twice a day: the second visit starts nothing.
		vi.setSystemTime(NOW + 3 * 60 * MINUTE);
		await expect(startDailyPrices(deps())).resolves.toBeNull();

		await updatePrices(deps());
		expect(requests.map(({ path }) => path)).toContain("/v8/finance/chart/AI.PA");
		await expect(securityRow(offline)).resolves.toMatchObject({ offline: false });
	});

	it("starts nothing while a run holds the lease, and runs again the next day", async () => {
		mockYahoo();
		await enable();
		await temp.db
			.insert(settings)
			.values({ key: "prices_started_at", value: String(NOW - MINUTE), updatedAt: NOW });

		await expect(startDailyPrices(deps())).resolves.toBeNull();

		vi.setSystemTime(NOW + DAY);

		await expect(startDailyPrices(deps())).resolves.not.toBeNull();
	});

	it("ends its run with the failure that kept it from reading the securities", async () => {
		mockYahoo();
		await newSecurity();
		await enable();
		const runDeps = deps();
		const daily = await startDailyPrices(runDeps);
		vi.spyOn(temp.db, "select").mockImplementationOnce(() => {
			throw new Error("database is locked");
		});

		await daily?.run();

		await expect(setting("prices_last_error")).resolves.toBe("INTERNAL_ERROR");
		await expect(setting("prices_finished_at")).resolves.toBe(String(NOW));
		// No security was read: the last update stays the one before.
		await expect(setting("prices_updated_at")).resolves.toBeNull();
		expect(logLines.join("\n")).not.toContain("database is locked");
	});
});
