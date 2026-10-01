import { sql } from "drizzle-orm";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, refreshStatistics } from "./client.ts";

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

	// Windows has no POSIX modes to assert.
	it.skipIf(process.platform === "win32")(
		"creates a missing file readable by its owner only, and its -wal and -shm alike",
		async () => {
			const path = join(directory, "private.db");
			const db = await createDb(`file:${path}`);
			await db.run(sql`create table t (id integer)`);

			try {
				const modes = await Promise.all(
					[path, `${path}-wal`, `${path}-shm`].map(async (file) => (await stat(file)).mode & 0o777),
				);

				expect(modes).toEqual([0o600, 0o600, 0o600]);
			} finally {
				db.$client.close();
			}
		},
	);

	it.skipIf(process.platform === "win32")("leaves the mode of a file that exists", async () => {
		const path = join(directory, "existing.db");
		await writeFile(path, "");
		await chmod(path, 0o640);

		const db = await createDb(`file:${path}`);
		db.$client.close();

		expect((await stat(path)).mode & 0o777).toBe(0o640);
	});
});

describe("refreshStatistics", () => {
	it("leaves statistics the planner can read", async () => {
		const db = await createDb(`file:${join(directory, "statistics.db")}`);
		await db.run(sql`create table t (id integer primary key, kind text)`);
		await db.run(sql`create index t_kind on t (kind)`);
		await db.run(sql`insert into t (kind) values ('a'), ('b'), ('a')`);

		await refreshStatistics(db);

		const rows = await db.all<{ idx: string }>(sql`select idx from sqlite_stat1`);

		expect(rows.map((row) => row.idx)).toContain("t_kind");
		db.$client.close();
	});
});
