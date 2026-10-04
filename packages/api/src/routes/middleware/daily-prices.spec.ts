import { eq, sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

import { securityPrices } from "@archant/data/schema/securities";

import { createLogger } from "../../lib/logger.ts";
import { buildApp, ownDatabase, template, useSignedInApp } from "../../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../../testing/auth.ts";
import { insertSecurity } from "../../testing/prices.ts";
import { mockYahoo } from "../../testing/yahoo.ts";

useSignedInApp();

const NOW = Date.parse("2026-09-21T10:00:00Z");
const DAY = 86_400_000;

/** Fetching on, one security held, and the requests Yahoo receives. */
async function pricedApp() {
	const own = await ownDatabase();
	const app = buildApp(own.db);
	const securityId = await insertSecurity(own.db);
	await testClient(app).api.prices.settings.$put({ json: { enabled: true } });
	const requests = mockYahoo();

	return { db: own.db, app, securityId, requests };
}

const pricesOf = async (db: Awaited<ReturnType<typeof ownDatabase>>["db"], securityId: string) =>
	db.select().from(securityPrices).where(eq(securityPrices.securityId, securityId));

describe("the first visit of the day", () => {
	it("fetches the day's prices beside the request, whose own answer says they are coming", async () => {
		const { db, app, securityId, requests } = await pricedApp();
		const client = testClient(app).api.prices;

		const response = await client.$get();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ data: { updating: true } });
		await vi.waitFor(
			async () => {
				const { data } = await (await client.$get()).json();

				expect(data.updating).toBe(false);
				// `vi.waitFor` moves the fake clock as it polls: any time will do.
				expect(data.lastUpdatedAt).not.toBeNull();
				expect(data.lastError).toBeNull();
			},
			{ timeout: 10_000 },
		);
		await expect(pricesOf(db, securityId)).resolves.toHaveLength(8);
		expect(requests).toHaveLength(1);

		// Twice a day: a later visit starts nothing.
		await client.$get();
		await testClient(app).api.accounts.$get();
		expect(requests).toHaveLength(1);
	});

	it("starts on a viewer's first read, as the day's bank sync does", async () => {
		const { db, securityId, requests } = await pricedApp();
		const silent = createLogger("silent");
		const auth = createTestAuth(db);
		const cookie = await addViewer(buildTestApp(db, silent, auth), auth);
		const viewer = withSession(buildTestApp(db, silent, auth), cookie);

		const response = await viewer.request("/api/accounts");

		expect(response.status).toBe(200);
		await vi.waitFor(
			async () => {
				expect(requests).toHaveLength(1);
				await expect(pricesOf(db, securityId)).resolves.toHaveLength(8);
			},
			{ timeout: 10_000 },
		);
	});

	it("runs again the next day", async () => {
		const { app, requests } = await pricedApp();
		await testClient(app).api.prices.update.$post();
		vi.setSystemTime(NOW + DAY);

		await testClient(app).api.accounts.$get();

		await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 10_000 });
	});

	it("starts nothing from a write, which would hold the lease against itself", async () => {
		const { app, requests } = await pricedApp();

		const response = await testClient(app).api.prices.update.$post();

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
	});

	it("starts nothing while fetching is off", async () => {
		const own = await ownDatabase();
		await insertSecurity(own.db);
		const requests = mockYahoo();

		const response = await testClient(buildApp(own.db)).api.accounts.$get();

		expect(response.status).toBe(200);
		expect(requests).toEqual([]);
	});

	it("starts nothing from the health check or from a request without a session", async () => {
		const { db, requests } = await pricedApp();
		const app = buildTestApp(db, createLogger("silent"));

		const health = await app.request("/api/health");
		const signedOut = await app.request("/api/prices");

		expect([health.status, signedOut.status]).toEqual([200, 401]);
		expect(requests).toEqual([]);
	});

	it("answers the request when the day's fetch cannot start, and logs why", async () => {
		const { db, requests } = await pricedApp();
		const lines: string[] = [];
		const app = withSession(
			buildTestApp(db, createLogger("info", { write: (text: string) => lines.push(text) })),
			template.cookie,
		);
		await db.run(sql`alter table settings rename to settings_gone`);

		try {
			const response = await app.request("/api/accounts");

			expect(response.status).toBe(200);
			expect(lines.join("\n")).toContain("daily price update failed to start");
			expect(requests).toEqual([]);
		} finally {
			await db.run(sql`alter table settings_gone rename to settings`);
		}
	});
});
