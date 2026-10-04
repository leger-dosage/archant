import type { TempDatabase } from "../../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../lib/logger.ts";
import {
	configuredBank,
	linkedConnection,
	syncApp,
	template,
	useSignedInApp,
} from "../../testing/app.ts";
import { addViewer, buildTestApp, withSession } from "../../testing/auth.ts";
import { mockProvider } from "../../testing/enable-banking.ts";

useSignedInApp();

/** The connection as the database holds it, lease and attempt included. */
async function syncState(db: TempDatabase["db"], connectionId: string) {
	const [row] = await db.all<{
		syncStartedAt: number | null;
		syncAttemptedAt: number | null;
		lastSyncedAt: number | null;
	}>(
		sql`select sync_started_at as syncStartedAt, sync_attempted_at as syncAttemptedAt, last_synced_at as lastSyncedAt from bank_connections where id = ${connectionId}`,
	);

	return row;
}

const transactionReads = (requests: ReturnType<typeof mockProvider>) =>
	requests.filter(({ path }) => path.endsWith("/transactions"));

describe("the first visit of the day", () => {
	const DAY = 86_400_000;

	/** A linked connection whose last attempt was yesterday, as on a new day. */
	async function dueConnection() {
		const { db, auth, app } = await syncApp();
		const linked = await linkedConnection(app);
		await db.run(
			sql`update bank_connections set sync_attempted_at = ${Date.now() - DAY} where id = ${linked.connection.id}`,
		);

		return { db, auth, app, ...linked };
	}

	it("starts the sync on an authenticated request, whose own answer says it runs", async () => {
		const { db, app, client, connection, accountId } = await dueConnection();
		const requests = mockProvider();
		// `vi.waitFor` moves the fake clock as it polls.
		const now = Date.now();

		const response = await client.$get();

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual([
			expect.objectContaining({ id: connection.id, syncing: true, lastSyncedAt: null }),
		]);
		await expect(syncState(db, connection.id)).resolves.toMatchObject({
			syncStartedAt: now,
			syncAttemptedAt: now,
		});

		await vi.waitFor(
			async () => {
				await expect(syncState(db, connection.id)).resolves.toEqual({
					syncStartedAt: null,
					syncAttemptedAt: now,
					lastSyncedAt: now,
				});
			},
			// A loaded CI runner can take more than the default second.
			{ timeout: 10_000 },
		);
		expect(transactionReads(requests)).toHaveLength(2);
		const synced = await client.$get();
		expect((await synced.json()).data).toEqual([
			expect.objectContaining({ id: connection.id, syncing: false, lastSyncedAt: now }),
		]);
		const lines = await testClient(withSession(app, template.cookie)).api.transactions.$get({
			query: { account: accountId },
		});
		expect((await lines.json()).data.items.length).toBeGreaterThan(0);
		// The day's attempt is spent: a later request reads nothing more.
		expect(transactionReads(requests)).toHaveLength(2);
	});

	it("starts the sync on a viewer's first read, as Sure's AutoSync runs for every member", async () => {
		const { db, auth, connection } = await dueConnection();
		const silent = createLogger("silent");
		const cookie = await addViewer(buildTestApp(db, silent, auth), auth);
		const viewer = withSession(buildTestApp(db, silent, auth, {}, configuredBank()), cookie);
		const requests = mockProvider();
		const now = Date.now();

		const response = await viewer.request("/api/accounts");

		expect(response.status).toBe(200);
		await expect(syncState(db, connection.id)).resolves.toMatchObject({ syncAttemptedAt: now });
		await vi.waitFor(
			async () => {
				await expect(syncState(db, connection.id)).resolves.toMatchObject({
					syncStartedAt: null,
					lastSyncedAt: now,
				});
			},
			{ timeout: 10_000 },
		);
		expect(transactionReads(requests)).toHaveLength(2);
	});

	it("lets the button's sync through as the day's first request, a write starting nothing", async () => {
		const { db, client, connection } = await dueConnection();
		const requests = mockProvider();

		const response = await client[":id"].sync.$post({ param: { id: connection.id } });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: { lastSyncedAt: Date.now(), lastError: null },
		});
		expect(transactionReads(requests)).toHaveLength(2);
		await expect(syncState(db, connection.id)).resolves.toMatchObject({ syncStartedAt: null });
	});

	it("answers the request when the day's sync cannot start, and logs why", async () => {
		const { db, connection } = await dueConnection();
		const before = await syncState(db, connection.id);
		const lines: string[] = [];
		const logger = createLogger("info", { write: (text: string) => lines.push(text) });
		// A stored pair is read from `settings`: failing that read throws
		// something other than `BANK_CONNECTOR_UNAVAILABLE`.
		const app = withSession(
			buildTestApp(db, logger, undefined, {}, { ...configuredBank(), bankCredentials: null }),
			template.cookie,
		);
		await db.run(sql`alter table settings rename to settings_gone`);

		try {
			const response = await app.request("/api/accounts");

			expect(response.status).toBe(200);
			expect(lines.join("\n")).toContain("daily bank sync failed to start");
			await expect(syncState(db, connection.id)).resolves.toEqual(before);
		} finally {
			await db.run(sql`alter table settings_gone rename to settings`);
		}
	});

	it("starts nothing from the health check or from a request without a session", async () => {
		const { db, connection } = await dueConnection();
		const before = await syncState(db, connection.id);
		const requests = mockProvider();
		const app = buildTestApp(db, createLogger("silent"), undefined, {}, configuredBank());

		const health = await app.request("/api/health");
		const signedOut = await app.request("/api/accounts");

		expect([health.status, signedOut.status]).toEqual([200, 401]);
		await expect(syncState(db, connection.id)).resolves.toEqual(before);
		expect(before?.syncStartedAt).toBeNull();
		expect(requests).toEqual([]);
	});

	it("starts nothing while the bank is unconfigured, and every page still answers", async () => {
		const { db, connection } = await dueConnection();
		const before = await syncState(db, connection.id);
		const unconfigured = withSession(
			buildTestApp(
				db,
				createLogger("silent"),
				undefined,
				{},
				{
					...configuredBank(),
					encryptionKey: null,
				},
			),
			template.cookie,
		);

		const response = await unconfigured.request("/api/accounts");

		expect(response.status).toBe(200);
		await expect(syncState(db, connection.id)).resolves.toEqual(before);
	});
});
