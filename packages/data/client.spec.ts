import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "./client.ts";

let directory: string;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "archant-client-"));
});

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("createDb", () => {
	it("turns on WAL, foreign keys and a busy timeout for a file", async () => {
		const db = await createDb(`file:${join(directory, "test.db")}`);

		const journal = await db.get<{ journal_mode: string }>(sql`pragma journal_mode`);
		const timeout = await db.get<{ timeout: number }>(sql`pragma busy_timeout`);

		expect(journal?.journal_mode).toBe("wal");
		expect(timeout?.timeout).toBeGreaterThan(0);

		// A transaction borrows its own pooled connection; the guarantee must hold
		// there too, since that is where the ledger writes.
		await db.transaction(async (tx) => {
			const keys = await tx.get<{ foreign_keys: number }>(sql`pragma foreign_keys`);

			expect(keys?.foreign_keys).toBe(1);
		});

		db.$client.close();
	});

	it("opens an in-memory database without touching the journal mode", async () => {
		const db = await createDb(":memory:");

		const keys = await db.get<{ foreign_keys: number }>(sql`pragma foreign_keys`);

		expect(keys?.foreign_keys).toBe(1);
		db.$client.close();
	});
});
