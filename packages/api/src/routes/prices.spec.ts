import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";

import { buildApp, errorBody, ownDatabase, request, useSignedInApp } from "../testing/app.ts";
import { insertSecurity } from "../testing/prices.ts";
import { mockYahoo } from "../testing/yahoo.ts";

useSignedInApp();

const NOW = Date.parse("2026-09-21T10:00:00Z");

async function pricesApi() {
	const own = await ownDatabase();

	return { db: own.db, api: testClient(buildApp(own.db)).api.prices };
}

describe("GET /api/prices", () => {
	it("says fetching is off by default, and which host it would reach", async () => {
		const { api } = await pricesApi();

		const response = await api.$get();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: {
				enabled: false,
				host: "query1.finance.yahoo.com",
				lastUpdatedAt: null,
				lastError: null,
				updating: false,
			},
		});
	});
});

describe("PUT /api/prices/settings", () => {
	it("turns fetching on, then off", async () => {
		const { api } = await pricesApi();

		const on = await api.settings.$put({ json: { enabled: true } });
		const off = await api.settings.$put({ json: { enabled: false } });

		expect([on.status, off.status]).toEqual([200, 200]);
		await expect(on.json()).resolves.toMatchObject({ data: { enabled: true } });
		await expect(off.json()).resolves.toMatchObject({ data: { enabled: false } });
	});

	it("refuses a body without a boolean", async () => {
		const { status, body } = await request("PUT", "/api/prices/settings", { enabled: "yes" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "enabled", code: "invalid_type" }],
		});
	});
});

describe("POST /api/prices/update", () => {
	it("answers PRICES_DISABLED while fetching is off, and reaches nothing", async () => {
		const { db, api } = await pricesApi();
		await insertSecurity(db);
		const requests = mockYahoo();

		const response = await api.update.$post();

		expect(response.status).toBe(409);
		expect(errorBody.parse(await response.json()).error.code).toBe("PRICES_DISABLED");
		expect(requests).toEqual([]);
	});

	it("fetches every held security and answers the new state once written", async () => {
		const { db, api } = await pricesApi();
		const id = await insertSecurity(db);
		mockYahoo();
		await api.settings.$put({ json: { enabled: true } });

		const response = await api.update.$post();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: {
				enabled: true,
				host: "query1.finance.yahoo.com",
				lastUpdatedAt: NOW,
				lastError: null,
				updating: false,
			},
		});
		await expect(
			db.select().from(securityPrices).where(eq(securityPrices.securityId, id)),
		).resolves.toHaveLength(8);
	});

	it("answers the run's failure in its state, not as an error", async () => {
		const { db, api } = await pricesApi();
		await insertSecurity(db);
		mockYahoo({ chart: () => new HttpResponse(null, { status: 503 }) });
		await api.settings.$put({ json: { enabled: true } });

		const response = await api.update.$post();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			data: { lastUpdatedAt: null, lastError: "PRICE_PROVIDER_ERROR" },
		});
	});

	it("answers PRICE_UPDATE_IN_PROGRESS while a run holds the lease", async () => {
		const { db, api } = await pricesApi();
		await api.settings.$put({ json: { enabled: true } });
		await db
			.insert(settings)
			.values({ key: "prices_started_at", value: String(NOW - 60_000), updatedAt: NOW });

		const response = await api.update.$post();

		expect(response.status).toBe(409);
		expect(errorBody.parse(await response.json()).error.code).toBe("PRICE_UPDATE_IN_PROGRESS");
	});
});
