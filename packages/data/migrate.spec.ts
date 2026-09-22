import type { Database } from "./client.ts";

import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "./client.ts";
import { migrateFromEnv, runMigrations } from "./migrate.ts";

let directory: string;
let url: string;
let db: Database | undefined;

beforeEach(async () => {
	// A file rather than `:memory:`: every libSQL connection to `:memory:` gets a
	// database of its own, so the result could not be inspected afterwards.
	directory = await mkdtemp(join(tmpdir(), "archant-migrate-"));
	url = `file:${join(directory, "test.db")}`;
});

afterEach(async () => {
	db?.$client.close();
	db = undefined;
	await rm(directory, { recursive: true, force: true });
});

async function migrated(): Promise<Database> {
	await runMigrations(url);
	db = await createDb(url);

	return db;
}

const insertAccount = (database: Database, id: string, type: string, subtype: string | null) =>
	database.run(
		sql`insert into accounts (id, name, type, subtype, currency, created_at, updated_at) values (${id}, 'A', ${type}, ${subtype}, 'EUR', 0, 0)`,
	);

const insertEntry = (
	database: Database,
	id: string,
	kind: string,
	valuationKind: string | null,
	date = "2026-09-01",
	accountId = "a1",
) =>
	database.run(
		sql`insert into entries (id, account_id, kind, valuation_kind, date, amount, currency, created_at, updated_at) values (${id}, ${accountId}, ${kind}, ${valuationKind}, ${date}, 100, 'EUR', 0, 0)`,
	);

describe("runMigrations", () => {
	it("creates the ledger tables", async () => {
		const database = await migrated();

		const tables = await database.all<{ name: string }>(
			sql`select name from sqlite_master where type = 'table' and name in ('accounts', 'entries', 'balances', 'transactions', 'imports', 'entry_keys') order by name`,
		);

		expect(tables.map((table) => table.name)).toEqual([
			"accounts",
			"balances",
			"entries",
			"entry_keys",
			"imports",
			"transactions",
		]);
	});

	it("is safe to run twice, which is what a start-up migration would do", async () => {
		await runMigrations(url);

		await expect(runMigrations(url)).resolves.toBeUndefined();
	});

	it("refuses a subtype that does not belong to the type", async () => {
		const database = await migrated();

		await expect(insertAccount(database, "a1", "credit_card", "savings")).rejects.toThrow();
		await expect(insertAccount(database, "a2", "depository", null)).rejects.toThrow();
		await expect(insertAccount(database, "a3", "loan", null)).rejects.toThrow();
		await expect(insertAccount(database, "a4", "credit_card", null)).resolves.toBeDefined();
	});

	it("allows one opening anchor per account", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");

		await insertEntry(database, "e1", "valuation", "opening_anchor");

		await expect(insertEntry(database, "e2", "valuation", "opening_anchor")).rejects.toThrow();
		await expect(insertEntry(database, "e3", "valuation", "reconciliation")).resolves.toBeDefined();
	});

	it("allows one reconciliation per account and date", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertAccount(database, "a2", "depository", "checking");
		await insertEntry(database, "e1", "valuation", "reconciliation", "2026-09-05");

		await expect(
			insertEntry(database, "e2", "valuation", "reconciliation", "2026-09-05"),
		).rejects.toThrow();
		await expect(
			insertEntry(database, "e3", "valuation", "reconciliation", "2026-09-06"),
		).resolves.toBeDefined();
		await expect(
			insertEntry(database, "e4", "valuation", "reconciliation", "2026-09-05", "a2"),
		).resolves.toBeDefined();
		await expect(
			insertEntry(database, "e5", "transaction", null, "2026-09-05"),
		).resolves.toBeDefined();
	});

	it("refuses a valuation kind on a transaction and an unknown kind", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");

		await expect(insertEntry(database, "e1", "transaction", "opening_anchor")).rejects.toThrow();
		await expect(insertEntry(database, "e2", "valuation", null)).rejects.toThrow();
		await expect(insertEntry(database, "e3", "transfer", null)).rejects.toThrow();
	});

	it("starts a transaction with no locked field and refuses to delete its entry first", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);

		await database.run(
			sql`insert into transactions (entry_id, label) values ('e1', 'Boulangerie')`,
		);

		await expect(
			database.get<{ locked: string }>(
				sql`select locked_fields as locked from transactions where entry_id = 'e1'`,
			),
		).resolves.toEqual({ locked: "[]" });
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
	});

	it("starts an account active and included in reports", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");

		await expect(
			database.get<{ active: number; excluded: number }>(
				sql`select active, excluded_from_reports as excluded from accounts where id = 'a1'`,
			),
		).resolves.toEqual({ active: 1, excluded: 0 });
	});

	it("refuses a transaction row without its entry", async () => {
		const database = await migrated();

		await expect(
			database.run(sql`insert into transactions (entry_id, label) values ('nope', 'Boulangerie')`),
		).rejects.toThrow();
	});

	it("refuses an entry for an account that does not exist", async () => {
		const database = await migrated();

		await expect(insertEntry(database, "e1", "valuation", "opening_anchor")).rejects.toThrow();
	});
});

const insertImport = (database: Database, id: string, status: string, source = "ofx") =>
	database.run(
		sql`insert into imports (id, account_id, source, file_name, status, content, options, created_at) values (${id}, 'a1', ${source}, 'releve.ofx', ${status}, x'00', '{}', 0)`,
	);

const insertKey = (database: Database, key: string, entryId = "e1", source = "ofx") =>
	database.run(
		sql`insert into entry_keys (entry_id, account_id, source, key, import_id) values (${entryId}, 'a1', ${source}, ${key}, null)`,
	);

describe("imports and entry keys", () => {
	it("refuses an unknown import status or source", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");

		await expect(insertImport(database, "i1", "previewed")).resolves.toBeDefined();
		await expect(insertImport(database, "i2", "confirmed")).resolves.toBeDefined();
		await expect(insertImport(database, "i3", "reverted")).rejects.toThrow();
		await expect(insertImport(database, "i4", "previewed", "csv")).rejects.toThrow();
	});

	it("holds a key once per account and source, and protects its entry", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertEntry(database, "e2", "transaction", null);

		await expect(insertKey(database, "fp:1")).resolves.toBeDefined();
		await expect(insertKey(database, "fp:1", "e2")).rejects.toThrow();
		await expect(insertKey(database, "fp:2", "e1", "qif")).rejects.toThrow();
		await expect(insertKey(database, "fp:3", "nope")).rejects.toThrow();
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
	});

	it("links a snapshot to the import that wrote it, and protects that import", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertImport(database, "i1", "confirmed");
		await insertEntry(database, "e1", "valuation", "reconciliation");

		await expect(
			database.run(sql`update entries set import_id = 'nope' where id = 'e1'`),
		).rejects.toThrow();
		await database.run(sql`update entries set import_id = 'i1' where id = 'e1'`);
		await expect(database.run(sql`delete from imports where id = 'i1'`)).rejects.toThrow();
		await expect(
			database.get<{ importId: string | null }>(
				sql`select import_id as importId from entries where id = 'e1'`,
			),
		).resolves.toEqual({ importId: "i1" });
		const indexes = await database.all<{ name: string }>(
			sql`select name from pragma_index_list('entries') where name = 'entries_import'`,
		);
		expect(indexes).toEqual([{ name: "entries_import" }]);
	});

	it("starts a transaction not flagged as a possible duplicate", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await database.run(
			sql`insert into transactions (entry_id, label) values ('e1', 'Boulangerie')`,
		);

		await expect(
			database.get<{ flag: number }>(
				sql`select possible_duplicate as flag from transactions where entry_id = 'e1'`,
			),
		).resolves.toEqual({ flag: 0 });
	});
});

describe("migrateFromEnv", () => {
	it("names DATABASE_URL when it is missing", async () => {
		await expect(migrateFromEnv({})).rejects.toThrow(/DATABASE_URL/);
	});

	it("names DATABASE_URL when it is empty", async () => {
		await expect(migrateFromEnv({ DATABASE_URL: "" })).rejects.toThrow(/DATABASE_URL/);
	});

	it("migrates the database the environment points at, ignoring an empty token", async () => {
		await expect(
			migrateFromEnv({ DATABASE_URL: url, DATABASE_AUTH_TOKEN: "" }),
		).resolves.toBeUndefined();
	});
});
