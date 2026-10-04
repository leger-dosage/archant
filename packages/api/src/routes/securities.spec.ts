import { testClient } from "hono/testing";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

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
