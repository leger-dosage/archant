import { testClient } from "hono/testing";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { accounts } from "@archant/data/schema/accounts";
import { securityPrices } from "@archant/data/schema/securities";

import { buildApp, errorBody, ownDatabase, useSignedInApp } from "../testing/app.ts";
import { insertSecurity } from "../testing/prices.ts";
import { mockYahoo } from "../testing/yahoo.ts";

useSignedInApp();

async function api() {
	const own = await ownDatabase();
	const client = testClient(buildApp(own.db)).api;

	return { db: own.db, securities: client.securities, prices: client.prices };
}

describe("GET /api/securities", () => {
	it("offers the known securities alone and asks no one while fetching is off", async () => {
		const { db, securities } = await api();
		const id = await insertSecurity(db, {}, { held: false });
		const requests = mockYahoo();

		const response = await securities.$get({ query: { q: "MC" } });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: {
				enabled: false,
				known: [
					{
						id,
						name: "LVMH",
						ticker: "MC.PA",
						mic: "XPAR",
						isin: "FR0000121014",
						currency: "EUR",
					},
				],
				items: [],
				unavailable: false,
			},
		});
		expect(requests).toEqual([]);
	});

	it("answers the provider's listings once fetching is on", async () => {
		const { securities, prices } = await api();
		await prices.settings.$put({ json: { enabled: true } });
		const requests = mockYahoo();

		const response = await securities.$get({ query: { q: " lvmh " } });

		expect(response.status).toBe(200);
		const { data } = await response.json();
		expect(data.enabled).toBe(true);
		expect(data.items).toHaveLength(6);
		expect(data.items[0]).toEqual({
			ticker: "MC.PA",
			name: "LVMH Moët Hennessy - Louis Vuitton, Société Européenne",
			mic: "XPAR",
			currency: "EUR",
			provider: "yahoo",
		});
		expect(requests.map(({ params }) => params["q"])).toEqual(["LVMH"]);
	});

	it.each(["", "   ", "x".repeat(65)])("refuses the query %j", async (q) => {
		const { securities } = await api();
		const requests = mockYahoo();

		const response = await securities.$get({ query: { q } });

		expect(response.status).toBe(400);
		expect(errorBody.parse(await response.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [expect.objectContaining({ path: "q" })],
		});
		expect(requests).toEqual([]);
	});

	it("answers the known part, unavailable, when the provider fails", async () => {
		const { securities, prices } = await api();
		await prices.settings.$put({ json: { enabled: true } });
		mockYahoo({ search: () => new HttpResponse(null, { status: 500 }) });

		const response = await securities.$get({ query: { q: "MC" } });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: { enabled: true, known: [], items: [], unavailable: true },
		});
	});
});

describe("POST /api/securities/:id/prices", () => {
	it("types a price for a security priced by hand, and its holder's balance follows", async () => {
		const { db, securities } = await api();
		const id = await insertSecurity(db, {
			ticker: null,
			mic: null,
			provider: null,
			name: "Fonds euros",
		});
		const [holder] = await db.select({ id: accounts.id }).from(accounts);

		const response = await securities[":id"].prices.$post({
			param: { id },
			json: { date: "2026-09-21", price: "105,00" },
		});

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			data: { securityId: id, date: "2026-09-21", price: "105", currency: "EUR", source: "manual" },
		});
		const account = await testClient(buildApp(db)).api.accounts[":id"].$get({
			param: { id: holder?.id ?? "" },
		});
		// One share bought at 1.00 € from an opening at zero, now worth 105.00 €.
		expect((await account.json()).data.balance).toBe(10_400);
	});

	it("refuses a security its provider prices with PRICE_FROM_PROVIDER, and a bad body with its fields", async () => {
		const { db, securities } = await api();
		const listed = await insertSecurity(db, {}, { held: false });
		const typed = await insertSecurity(
			db,
			{ ticker: null, mic: null, provider: null },
			{ held: false },
		);

		const refused = await securities[":id"].prices.$post({
			param: { id: listed },
			json: { date: "2026-09-21", price: "105" },
		});
		const invalid = await securities[":id"].prices.$post({
			param: { id: typed },
			json: { date: "2026-09-22", price: "-1" },
		});

		expect(refused.status).toBe(409);
		expect(errorBody.parse(await refused.json()).error.code).toBe("PRICE_FROM_PROVIDER");
		expect(invalid.status).toBe(400);
		expect(errorBody.parse(await invalid.json()).error.fields).toEqual([
			{ path: "date", code: "date_in_future" },
			{ path: "price", code: "invalid_price" },
		]);
		await expect(db.select().from(securityPrices)).resolves.toEqual([]);
	});
});
