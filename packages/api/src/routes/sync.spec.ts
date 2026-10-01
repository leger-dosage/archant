import type { buildTestApp } from "../testing/auth.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

import {
	configuredBank,
	errorBody,
	linkedConnection,
	syncApp,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { withSession } from "../testing/auth.ts";

useSignedInApp();

/** The scheduled sync, as a cron's `curl -X POST` sends it: no body, no origin. */
const cron = (app: ReturnType<typeof buildTestApp>, authorization?: string) =>
	app.request("/api/sync", {
		method: "POST",
		headers: authorization === undefined ? {} : { authorization },
	});

describe("bank sync routes", () => {
	const SECRET = "a-sync-secret-of-at-least-32-characters";

	it("refuses a missing, wrong or unset secret before reading anything", async () => {
		const { db, app } = await syncApp({ ...configuredBank(), syncSecret: SECRET });
		const select = vi.spyOn(db, "select");

		const responses = [
			await cron(app),
			await cron(app, `Bearer ${SECRET}x`),
			await cron(app, SECRET),
			await cron(app, "Bearer "),
			await cron(app, `Basic ${SECRET}`),
		];
		const unset = await cron((await syncApp()).app, `Bearer ${SECRET}`);

		expect([...responses, unset].map((response) => response.status)).toEqual([
			401, 401, 401, 401, 401, 401,
		]);
		expect(errorBody.parse(await unset.json()).error.code).toBe("UNAUTHORIZED");
		expect(select).not.toHaveBeenCalled();
	});

	it("syncs every connection for the cron, then skips one synced within the hour", async () => {
		const { app } = await syncApp({ ...configuredBank(), syncSecret: SECRET });
		const { connection, accountId } = await linkedConnection(app);

		const first = await cron(app, `Bearer ${SECRET}`);

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			data: { connections: [{ id: connection.id, result: "synced" }] },
		});
		const synced = await testClient(withSession(app, template.cookie)).api.transactions.$get({
			query: { account: accountId },
		});
		expect((await synced.json()).data.items.map((item) => item.source)).toContainEqual({
			kind: "bank",
			connector: "enable-banking",
		});

		// The scheme is case-insensitive (RFC 7235).
		const second = await cron(app, `bearer ${SECRET}`);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({
			data: { connections: [{ id: connection.id, result: "skipped" }] },
		});
	});

	it("answers 503 to a right secret while the bank is unconfigured", async () => {
		const { app } = await syncApp({
			...configuredBank(),
			encryptionKey: null,
			syncSecret: SECRET,
		});

		const response = await cron(app, `Bearer ${SECRET}`);

		expect(response.status).toBe(503);
		expect(errorBody.parse(await response.json()).error.code).toBe("BANK_CONNECTOR_UNAVAILABLE");
	});

	it("syncs a connection from its button, then refuses a second run within the hour", async () => {
		const { app } = await syncApp();
		const { client, connection } = await linkedConnection(app);

		const first = await client[":id"].sync.$post({ param: { id: connection.id } });

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			data: { lastSyncedAt: Date.now(), lastError: null },
		});
		const connections = await client.$get();
		expect((await connections.json()).data).toEqual([
			expect.objectContaining({ id: connection.id, lastSyncedAt: Date.now(), lastError: null }),
		]);

		const second = await client[":id"].sync.$post({ param: { id: connection.id } });

		expect(second.status).toBe(409);
		expect(errorBody.parse(await second.json()).error.code).toBe("SYNC_TOO_RECENT");
	});

	it("never lists again a synced transaction deleted since the last sync", async () => {
		const { app } = await syncApp();
		const { client, connection, accountId } = await linkedConnection(app);
		const api = testClient(withSession(app, template.cookie)).api;
		await client[":id"].sync.$post({ param: { id: connection.id } });
		const labels = async () =>
			(await (await api.transactions.$get({ query: { account: accountId } })).json()).data.items;
		const netflix = (await labels()).find((item) => item.label.includes("NETFLIX"));

		const deleted = await api.transactions[":id"].$delete({ param: { id: netflix?.id ?? "" } });
		// Past the hour a sync from the button waits.
		vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
		const synced = await client[":id"].sync.$post({ param: { id: connection.id } });

		expect(deleted.status).toBe(200);
		expect(synced.status).toBe(200);
		expect((await labels()).map((item) => item.label)).not.toContainEqual(
			expect.stringContaining("NETFLIX"),
		);
	});

	it("answers CONSENT_EXPIRED from the button, and reports it to the cron", async () => {
		const { app, db } = await syncApp({ ...configuredBank(), syncSecret: SECRET });
		const { client, connection } = await linkedConnection(app);
		await db.run(
			sql`update bank_connections set consent_expires_at = ${Date.now() - 1} where id = ${connection.id}`,
		);

		const button = await client[":id"].sync.$post({ param: { id: connection.id } });
		const scheduled = await cron(app, `Bearer ${SECRET}`);

		expect(button.status).toBe(409);
		expect(errorBody.parse(await button.json()).error.code).toBe("CONSENT_EXPIRED");
		expect(await scheduled.json()).toEqual({
			data: { connections: [{ id: connection.id, result: "consent_expired" }] },
		});
		const expired = (await (await client.$get()).json()).data;
		expect(expired).toEqual([
			expect.objectContaining({ id: connection.id, alert: "consent_expired", lastSyncedAt: null }),
		]);
	});

	it("answers SYNC_IN_PROGRESS while a sync holds the lease", async () => {
		const { app, db } = await syncApp();
		const { client, connection } = await linkedConnection(app);
		await db.run(
			sql`update bank_connections set sync_started_at = ${Date.now() - 120_000} where id = ${connection.id}`,
		);

		const response = await client[":id"].sync.$post({ param: { id: connection.id } });

		expect(response.status).toBe(409);
		expect(errorBody.parse(await response.json()).error.code).toBe("SYNC_IN_PROGRESS");
	});

	it("guards the button with the session and answers 503 while unconfigured", async () => {
		const { app } = await syncApp();
		const signedOut = await app.request("/api/bank-connections/c1/sync", {
			method: "POST",
			headers: { origin: "http://localhost:5173" },
		});
		const { app: unconfigured } = await syncApp({
			...configuredBank(),
			encryptionKey: null,
		});
		const refused = await withSession(unconfigured, template.cookie).request(
			"/api/bank-connections/c1/sync",
			{ method: "POST" },
		);
		const unknown = await testClient(withSession(app, template.cookie)).api["bank-connections"][
			":id"
		].sync.$post({ param: { id: "nope" } });

		expect([signedOut.status, refused.status, unknown.status]).toEqual([401, 503, 404]);
	});
});
