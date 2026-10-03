import { sql } from "drizzle-orm";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, readSnapshot, refreshStatistics } from "./client.ts";

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

/** A file database with one row in `t`, written before any snapshot opens. */
async function ledger(name: string) {
	const db = await createDb(`file:${join(directory, name)}`);
	await db.run(sql`create table t (id integer primary key, label text)`);
	await db.run(sql`insert into t (label) values ('before')`);

	return db;
}

describe("readSnapshot", () => {
	it("keeps reading the state it opened on, and blocks no write meanwhile", async () => {
		const db = await ledger("snapshot.db");
		const snapshot = await readSnapshot(db);

		try {
			// Under the ledger's own lock, as every ledger write takes it: it
			// commits at once rather than waiting for the snapshot to end.
			await db.transaction(
				async (tx) => {
					await tx.run(sql`insert into t (label) values ('after')`);
				},
				{ behavior: "immediate" },
			);

			const seen = await snapshot.db.all<{ label: string }>(sql`select label from t`);
			const now = await db.all<{ label: string }>(sql`select label from t order by id`);

			expect(seen.map((row) => row.label)).toEqual(["before"]);
			expect(now.map((row) => row.label)).toEqual(["before", "after"]);
		} finally {
			snapshot.close();
			db.$client.close();
		}
	});

	it("runs a batch in the snapshot, and refuses to open a transaction or migrate in it", async () => {
		const db = await ledger("batch.db");
		const snapshot = await readSnapshot(db);

		try {
			const [first, second] = await snapshot.db.$client.batch([
				"select count(*) as count from t",
				["select label from t where id = ?", [1]],
			]);
			const text = await snapshot.db.$client.execute("select label from t where id = ?", [1]);

			expect(first?.rows[0]?.["count"]).toBe(1);
			expect(second?.rows[0]?.["label"]).toBe("before");
			expect(text.rows[0]?.["label"]).toBe("before");
			await snapshot.db.$client.executeMultiple("select 1; select 2;");
			expect(snapshot.db.$client.protocol).toBe("file");
			expect(() => snapshot.db.$client.transaction()).toThrow("A read snapshot only reads.");
			expect(() => snapshot.db.$client.migrate([])).toThrow("A read snapshot only reads.");
			expect(() => snapshot.db.$client.sync()).toThrow("A read snapshot only reads.");
			expect(() => snapshot.db.$client.reconnect()).toThrow("A read snapshot only reads.");
		} finally {
			snapshot.close();
			db.$client.close();
		}
	});

	it("gives its connection back once closed", async () => {
		const db = await ledger("closed.db");
		const snapshot = await readSnapshot(db);

		expect(snapshot.db.$client.closed).toBe(false);
		snapshot.db.$client.close();

		expect(snapshot.db.$client.closed).toBe(true);
		await expect(snapshot.db.all(sql`select label from t`)).rejects.toThrow();
		await expect(db.all(sql`select label from t`)).resolves.toHaveLength(1);
		db.$client.close();
	});

	it("opens nothing on a client that is closed", async () => {
		const db = await ledger("gone.db");
		db.$client.close();

		await expect(readSnapshot(db)).rejects.toThrow();
	});
});
