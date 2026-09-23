import type { Database } from "./client.ts";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
		await expect(insertAccount(database, "a5", "loan", "mortgage")).resolves.toBeDefined();
		await expect(insertAccount(database, "a6", "loan", "savings")).rejects.toThrow();
		await expect(insertAccount(database, "a7", "brokerage", null)).rejects.toThrow();
		await expect(insertAccount(database, "a8", "investment", "pea")).resolves.toBeDefined();
		await expect(insertAccount(database, "a9", "investment", "other")).resolves.toBeDefined();
		await expect(insertAccount(database, "a10", "investment", null)).rejects.toThrow();
		await expect(insertAccount(database, "a11", "investment", "mortgage")).rejects.toThrow();
		await expect(insertAccount(database, "a12", "loan", "pea")).rejects.toThrow();
		await expect(insertAccount(database, "a13", "property", "apartment")).resolves.toBeDefined();
		await expect(insertAccount(database, "a14", "property", null)).rejects.toThrow();
		await expect(insertAccount(database, "a15", "property", "pea")).rejects.toThrow();
		await expect(insertAccount(database, "a16", "vehicle", null)).resolves.toBeDefined();
		await expect(insertAccount(database, "a17", "vehicle", "car")).rejects.toThrow();
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
		await expect(insertImport(database, "i3", "reverted")).resolves.toBeDefined();
		await expect(insertImport(database, "i4", "previewed", "csv")).resolves.toBeDefined();
		await expect(insertImport(database, "i5", "previewed", "qif")).resolves.toBeDefined();
		await expect(insertImport(database, "i6", "previewed", "xls")).rejects.toThrow();
		await expect(insertImport(database, "i7", "cancelled")).rejects.toThrow();
	});

	it("holds a key once per account and source, and protects its entry", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertEntry(database, "e2", "transaction", null);

		await expect(insertKey(database, "fp:1")).resolves.toBeDefined();
		await expect(insertKey(database, "fp:1", "e2")).rejects.toThrow();
		await expect(insertKey(database, "fp:2", "e1", "qif")).resolves.toBeDefined();
		await expect(insertKey(database, "fp:2", "e1", "xls")).rejects.toThrow();
		await expect(insertKey(database, "fp:1", "e1", "csv")).resolves.toBeDefined();
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

function isJournal(value: unknown): value is { entries: { tag: string }[] } {
	return (
		typeof value === "object" &&
		value !== null &&
		"entries" in value &&
		Array.isArray(value.entries) &&
		value.entries.every(
			(entry: unknown) =>
				typeof entry === "object" &&
				entry !== null &&
				"tag" in entry &&
				typeof entry.tag === "string",
		)
	);
}

/**
 * A database migrated up to, not including, the migration whose tag starts
 * with `tag`, from a copy of the folder whose journal stops there.
 */
async function migratedBefore(tag: string): Promise<Database> {
	const folder = join(directory, "drizzle");
	await cp(fileURLToPath(new URL("./drizzle", import.meta.url)), folder, { recursive: true });
	const journalPath = join(folder, "meta", "_journal.json");
	const journal: unknown = JSON.parse(await readFile(journalPath, "utf8"));

	if (!isJournal(journal)) {
		throw new Error("drizzle-kit changed the shape of its journal.");
	}

	await writeFile(
		journalPath,
		JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.tag < tag) }),
	);
	const before = await createDb(url);
	await migrate(before, { migrationsFolder: folder });

	return before;
}

const insertUser = (database: Database, id: string, role: string | null) =>
	database.run(
		sql`insert into users (id, name, email, role) values (${id}, 'A', ${`${id}@example.test`}, ${role})`,
	);

describe("users and settings", () => {
	it("accepts the admin role only, and requires one", async () => {
		const database = await migrated();

		await expect(insertUser(database, "u1", "admin")).resolves.toBeDefined();
		await expect(insertUser(database, "u2", "viewer")).rejects.toThrow();
		await expect(insertUser(database, "u3", null)).rejects.toThrow();
	});

	it("holds a setting once, so inserting its key is a one-time claim", async () => {
		const database = await migrated();
		const claim = () =>
			database.run(
				sql`insert into settings (key, value, updated_at) values ('setup_completed_at', '0', 0)`,
			);

		await expect(claim()).resolves.toBeDefined();
		await expect(claim()).rejects.toThrow();
	});

	it("deletes a user's sessions and credentials with the user", async () => {
		const database = await migrated();
		await insertUser(database, "u1", "admin");
		await database.run(
			sql`insert into sessions (id, expires_at, token, updated_at, user_id) values ('s1', 0, 't1', 0, 'u1')`,
		);
		await database.run(
			sql`insert into auth_accounts (id, account_id, provider_id, user_id, updated_at) values ('c1', 'u1', 'credential', 'u1', 0)`,
		);

		await database.run(sql`delete from users where id = 'u1'`);

		await expect(database.all(sql`select id from sessions`)).resolves.toEqual([]);
		await expect(database.all(sql`select id from auth_accounts`)).resolves.toEqual([]);
	});
});

describe("import mappings", () => {
	it("holds one mapping per account and goes with its account", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		const insertMapping = (accountId: string) =>
			database.run(
				sql`insert into import_mappings (account_id, mapping, updated_at) values (${accountId}, '{}', 0)`,
			);

		await expect(insertMapping("a1")).resolves.toBeDefined();
		await expect(insertMapping("a1")).rejects.toThrow();
		await expect(insertMapping("nope")).rejects.toThrow();

		await database.run(sql`delete from accounts where id = 'a1'`);

		await expect(database.all(sql`select account_id from import_mappings`)).resolves.toEqual([]);
	});

	it("keeps every import and key when 0007 rebuilds their source checks", async () => {
		const before = await migratedBefore("0007");
		await insertAccount(before, "a1", "depository", "checking");
		await insertImport(before, "i1", "confirmed");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(sql`update entries set import_id = 'i1' where id = 'e1'`);
		await before.run(
			sql`insert into entry_keys (entry_id, account_id, source, key, import_id) values ('e1', 'a1', 'ofx', 'fp:1', 'i1')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select entry_id, source, key, import_id from entry_keys`),
		).resolves.toEqual([{ entry_id: "e1", source: "ofx", key: "fp:1", import_id: "i1" }]);
		await expect(database.all(sql`select id, source from imports`)).resolves.toEqual([
			{ id: "i1", source: "ofx" },
		]);
		// The references to the rebuilt table still hold.
		await expect(database.run(sql`delete from imports where id = 'i1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("keeps every import, key and transaction when 0008 admits QIF", async () => {
		const before = await migratedBefore("0008");
		await insertAccount(before, "a1", "depository", "checking");
		await insertImport(before, "i1", "confirmed", "csv");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(sql`insert into transactions (entry_id, label) values ('e1', 'Boulangerie')`);
		await before.run(
			sql`insert into entry_keys (entry_id, account_id, source, key, import_id) values ('e1', 'a1', 'csv', 'fp:1', 'i1')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select entry_id, source, key, import_id from entry_keys`),
		).resolves.toEqual([{ entry_id: "e1", source: "csv", key: "fp:1", import_id: "i1" }]);
		await expect(database.all(sql`select id, source from imports`)).resolves.toEqual([
			{ id: "i1", source: "csv" },
		]);
		await expect(database.all(sql`select label, reference from transactions`)).resolves.toEqual([
			{ label: "Boulangerie", reference: null },
		]);
		await expect(database.run(sql`delete from imports where id = 'i1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("import revert", () => {
	it("keeps every import and its links when 0009 adds the revert columns", async () => {
		const before = await migratedBefore("0009");
		await insertAccount(before, "a1", "depository", "checking");
		await insertImport(before, "i1", "confirmed");
		await insertEntry(before, "e1", "valuation", "reconciliation");
		await before.run(sql`update entries set import_id = 'i1' where id = 'e1'`);
		before.$client.close();

		const database = await migrated();

		// drizzle-kit generated the copy reading the two new columns from the
		// old table, which has neither: the migration failed on every database.
		await expect(
			database.all(
				sql`select id, status, reverted_at as revertedAt, previous_opening_date as previousOpeningDate from imports`,
			),
		).resolves.toEqual([
			{ id: "i1", status: "confirmed", revertedAt: null, previousOpeningDate: null },
		]);
		await expect(database.run(sql`delete from imports where id = 'i1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertCategory = (
	database: Database,
	id: string,
	name: string,
	kind = "expense",
	parentId: string | null = null,
) =>
	database.run(
		sql`insert into categories (id, name, kind, color, icon, parent_id, created_at, updated_at) values (${id}, ${name}, ${kind}, '#e99537', 'tag', ${parentId}, 0, 0)`,
	);

describe("categories", () => {
	it("accepts an income or an expense kind only", async () => {
		const database = await migrated();

		await expect(insertCategory(database, "c1", "Salaire", "income")).resolves.toBeDefined();
		await expect(insertCategory(database, "c2", "Courses", "expense")).resolves.toBeDefined();
		await expect(insertCategory(database, "c3", "Virements", "transfer")).rejects.toThrow();
	});

	it("holds a name once, ignoring case", async () => {
		const database = await migrated();
		await insertCategory(database, "c1", "Courses");

		await expect(insertCategory(database, "c2", "courses")).rejects.toThrow();
		await expect(insertCategory(database, "c3", "COURSES")).rejects.toThrow();
		await expect(insertCategory(database, "c4", "Courses bio")).resolves.toBeDefined();
	});

	it("refuses an unknown parent, and deleting a parent that still has children", async () => {
		const database = await migrated();
		await insertCategory(database, "c1", "Logement");

		await expect(insertCategory(database, "c2", "Loyer", "expense", "nope")).rejects.toThrow();
		await insertCategory(database, "c3", "Loyer", "expense", "c1");
		await expect(database.run(sql`delete from categories where id = 'c1'`)).rejects.toThrow();
	});

	it("leaves a transaction without category, and refuses to delete a category in use", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertCategory(database, "c1", "Courses");
		await database.run(
			sql`insert into transactions (entry_id, label) values ('e1', 'Boulangerie')`,
		);

		await expect(
			database.get(sql`select category_id as categoryId from transactions where entry_id = 'e1'`),
		).resolves.toEqual({ categoryId: null });
		await expect(
			database.run(sql`update transactions set category_id = 'nope' where entry_id = 'e1'`),
		).rejects.toThrow();
		await database.run(
			sql`update transactions set category_id = 'c1', category_origin = 'user' where entry_id = 'e1'`,
		);
		await expect(database.run(sql`delete from categories where id = 'c1'`)).rejects.toThrow();
		await expect(
			database.all(
				sql`select name from pragma_index_list('transactions') where name = 'transactions_category'`,
			),
		).resolves.toEqual([{ name: "transactions_category" }]);
	});

	it("keeps every transaction when 0011 adds the category column", async () => {
		const before = await migratedBefore("0011");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(
			sql`insert into transactions (entry_id, label, locked_fields) values ('e1', 'Boulangerie', '["label"]')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, label, locked_fields as locked, category_id as categoryId from transactions`,
			),
		).resolves.toEqual([
			{ entryId: "e1", label: "Boulangerie", locked: '["label"]', categoryId: null },
		]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("accepts a user, rule or provider origin only", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertCategory(database, "c1", "Courses");
		await database.run(
			sql`insert into transactions (entry_id, label, category_id, category_origin) values ('e1', 'Boulangerie', 'c1', 'user')`,
		);
		const setOrigin = (origin: string) =>
			database.run(sql`update transactions set category_origin = ${origin} where entry_id = 'e1'`);

		await expect(setOrigin("rule")).resolves.toBeDefined();
		await expect(setOrigin("provider")).resolves.toBeDefined();
		await expect(setOrigin("maintenance")).rejects.toThrow();
	});

	it("records an origin exactly when a category is set", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertEntry(database, "e2", "transaction", null);
		await insertEntry(database, "e3", "transaction", null);
		await insertEntry(database, "e4", "transaction", null);
		await insertCategory(database, "c1", "Courses");
		const insertTransaction = (id: string, categoryId: string | null, origin: string | null) =>
			database.run(
				sql`insert into transactions (entry_id, label, category_id, category_origin) values (${id}, 'Boulangerie', ${categoryId}, ${origin})`,
			);

		await expect(insertTransaction("e1", null, null)).resolves.toBeDefined();
		await expect(insertTransaction("e2", "c1", "user")).resolves.toBeDefined();
		await expect(insertTransaction("e3", "c1", null)).rejects.toThrow();
		await expect(insertTransaction("e4", null, "user")).rejects.toThrow();
	});

	it("keeps every transaction and reference when 0012 rebuilds the table", async () => {
		const before = await migratedBefore("0012");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await insertEntry(before, "e2", "transaction", null);
		await insertCategory(before, "c1", "Courses");
		await before.run(
			sql`insert into transactions (entry_id, label, notes, reference, excluded, possible_duplicate, locked_fields, category_id) values ('e1', 'Boulangerie', 'pain', '12', 1, 1, '["label"]', 'c1'), ('e2', 'Loyer', null, null, 0, 0, '[]', null)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, label, notes, reference, excluded, possible_duplicate as possibleDuplicate, locked_fields as locked, category_id as categoryId, category_origin as categoryOrigin from transactions order by entry_id`,
			),
		).resolves.toEqual([
			{
				entryId: "e1",
				label: "Boulangerie",
				notes: "pain",
				reference: "12",
				excluded: 1,
				possibleDuplicate: 1,
				locked: '["label","category"]',
				categoryId: "c1",
				// Before 0012 only a person could set a category, by hand in the
				// database; the row takes `user` and its lock rather than failing
				// the new check.
				categoryOrigin: "user",
			},
			{
				entryId: "e2",
				label: "Loyer",
				notes: null,
				reference: null,
				excluded: 0,
				possibleDuplicate: 0,
				locked: "[]",
				categoryId: null,
				categoryOrigin: null,
			},
		]);
		// The rebuilt table still refuses to lose its entry or its category.
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
		await expect(database.run(sql`delete from categories where id = 'c1'`)).rejects.toThrow();
		await expect(
			database.all(
				sql`select name from pragma_index_list('transactions') where name = 'transactions_category'`,
			),
		).resolves.toEqual([{ name: "transactions_category" }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertMerchant = (database: Database, id: string, name: string) =>
	database.run(
		sql`insert into merchants (id, name, created_at, updated_at) values (${id}, ${name}, 0, 0)`,
	);

describe("merchants", () => {
	it("holds a name once, ignoring case", async () => {
		const database = await migrated();
		await insertMerchant(database, "m1", "Carrefour");

		await expect(insertMerchant(database, "m2", "carrefour")).rejects.toThrow();
		await expect(insertMerchant(database, "m3", "Carrefour Market")).resolves.toBeDefined();
	});

	it("keeps every transaction when 0013 adds the merchant column, and protects a used merchant", async () => {
		const before = await migratedBefore("0013");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await insertCategory(before, "c1", "Courses");
		await before.run(
			sql`insert into transactions (entry_id, label, locked_fields, category_id, category_origin) values ('e1', 'CB CARREFOUR 1234', '["category"]', 'c1', 'user')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, label, locked_fields as locked, category_id as categoryId, merchant_id as merchantId from transactions`,
			),
		).resolves.toEqual([
			{
				entryId: "e1",
				label: "CB CARREFOUR 1234",
				locked: '["category"]',
				categoryId: "c1",
				merchantId: null,
			},
		]);
		await expect(
			database.run(sql`update transactions set merchant_id = 'nope' where entry_id = 'e1'`),
		).rejects.toThrow();
		await insertMerchant(database, "m1", "Carrefour");
		await database.run(sql`update transactions set merchant_id = 'm1' where entry_id = 'e1'`);
		await expect(database.run(sql`delete from merchants where id = 'm1'`)).rejects.toThrow();
		await expect(
			database.all(
				sql`select name from pragma_index_list('transactions') where name = 'transactions_merchant'`,
			),
		).resolves.toEqual([{ name: "transactions_merchant" }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertTag = (database: Database, id: string, name: string) =>
	database.run(
		sql`insert into tags (id, name, created_at, updated_at) values (${id}, ${name}, 0, 0)`,
	);

describe("tags", () => {
	it("holds a name once, ignoring case", async () => {
		const database = await migrated();
		await insertTag(database, "t1", "Vacances");

		await expect(insertTag(database, "t2", "vacances")).rejects.toThrow();
		await expect(insertTag(database, "t3", "Vacances 2026")).resolves.toBeDefined();
	});

	it("keeps every transaction when 0014 adds tags, and protects a tagging on both ends", async () => {
		const before = await migratedBefore("0014");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await insertMerchant(before, "m1", "Carrefour");
		await before.run(
			sql`insert into transactions (entry_id, label, locked_fields, merchant_id) values ('e1', 'CB CARREFOUR 1234', '["merchant"]', 'm1')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, label, locked_fields as locked, merchant_id as merchantId from transactions`,
			),
		).resolves.toEqual([
			{ entryId: "e1", label: "CB CARREFOUR 1234", locked: '["merchant"]', merchantId: "m1" },
		]);
		await insertTag(database, "t1", "Vacances");
		await expect(
			database.run(sql`insert into taggings (transaction_id, tag_id) values ('e1', 'nope')`),
		).rejects.toThrow();
		await expect(
			database.run(sql`insert into taggings (transaction_id, tag_id) values ('nope', 't1')`),
		).rejects.toThrow();
		await database.run(sql`insert into taggings (transaction_id, tag_id) values ('e1', 't1')`);
		await expect(
			database.run(sql`insert into taggings (transaction_id, tag_id) values ('e1', 't1')`),
		).rejects.toThrow();
		await expect(database.run(sql`delete from tags where id = 't1'`)).rejects.toThrow();
		await expect(
			database.run(sql`delete from transactions where entry_id = 'e1'`),
		).rejects.toThrow();
		await expect(
			database.all(sql`select name from pragma_index_list('taggings') where name = 'taggings_tag'`),
		).resolves.toEqual([{ name: "taggings_tag" }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertTransfer = (
	database: Database,
	id: string,
	outflow: string,
	inflow: string,
	kind = "internal_move",
) =>
	database.run(
		sql`insert into transfers (id, outflow_transaction_id, inflow_transaction_id, kind, created_at) values (${id}, ${outflow}, ${inflow}, ${kind}, 0)`,
	);

describe("transfers", () => {
	it("keeps every transaction when 0015 adds transfers, and holds each side once", async () => {
		const before = await migratedBefore("0015");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "depository", "savings");
		await insertEntry(before, "e1", "transaction", null, "2026-09-01", "a1");
		await insertEntry(before, "e2", "transaction", null, "2026-09-01", "a2");
		await insertEntry(before, "e3", "transaction", null, "2026-09-01", "a2");
		await before.run(
			sql`insert into transactions (entry_id, label) values ('e1', 'Virement'), ('e2', 'Virement'), ('e3', 'Virement')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select entry_id as entryId from transactions order by entry_id`),
		).resolves.toEqual([{ entryId: "e1" }, { entryId: "e2" }, { entryId: "e3" }]);
		await expect(insertTransfer(database, "x0", "e1", "e2", "refund")).rejects.toThrow();
		await expect(insertTransfer(database, "x0", "e1", "e1")).rejects.toThrow();
		await expect(insertTransfer(database, "x0", "e1", "nope")).rejects.toThrow();
		await insertTransfer(database, "x1", "e1", "e2", "credit_card_payment");
		await expect(insertTransfer(database, "x2", "e1", "e3")).rejects.toThrow();
		await expect(insertTransfer(database, "x2", "e3", "e2")).rejects.toThrow();
		await expect(
			database.run(sql`delete from transactions where entry_id = 'e2'`),
		).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertRejectedTransfer = (database: Database, id: string, outflow: string, inflow: string) =>
	database.run(
		sql`insert into rejected_transfers (id, outflow_transaction_id, inflow_transaction_id, created_at) values (${id}, ${outflow}, ${inflow}, 0)`,
	);

describe("rejected transfers", () => {
	it("keeps every transfer when 0016 adds rejected pairs, and holds each pair once", async () => {
		const before = await migratedBefore("0016");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "depository", "savings");
		await insertEntry(before, "e1", "transaction", null, "2026-09-01", "a1");
		await insertEntry(before, "e2", "transaction", null, "2026-09-01", "a2");
		await insertEntry(before, "e3", "transaction", null, "2026-09-01", "a2");
		await before.run(
			sql`insert into transactions (entry_id, label) values ('e1', 'Virement'), ('e2', 'Virement'), ('e3', 'Virement')`,
		);
		await insertTransfer(before, "x1", "e1", "e3");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, outflow_transaction_id as outflow from transfers`),
		).resolves.toEqual([{ id: "x1", outflow: "e1" }]);
		await expect(insertRejectedTransfer(database, "r0", "e1", "e1")).rejects.toThrow();
		await expect(insertRejectedTransfer(database, "r0", "e1", "nope")).rejects.toThrow();
		await insertRejectedTransfer(database, "r1", "e1", "e2");
		await expect(insertRejectedTransfer(database, "r2", "e1", "e2")).rejects.toThrow();
		// One transaction may be refused with several others.
		await insertRejectedTransfer(database, "r2", "e3", "e2");
		await expect(
			database.run(sql`delete from transactions where entry_id = 'e2'`),
		).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("loan accounts", () => {
	it("keeps every account, entry and CSV mapping when 0018 rebuilds accounts", async () => {
		const before = await migratedBefore("0018");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "credit_card", null);
		await insertEntry(before, "e1", "valuation", "opening_anchor");
		await insertEntry(before, "e2", "transaction", null);
		await before.run(sql`insert into transactions (entry_id, label) values ('e2', 'Boulangerie')`);
		await before.run(
			sql`insert into import_mappings (account_id, mapping, updated_at) values ('a1', '{"skipRows":2}', 0)`,
		);
		await insertImport(before, "i1", "confirmed");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, type, subtype, details from accounts order by id`),
		).resolves.toEqual([
			{ id: "a1", type: "depository", subtype: "checking", details: null },
			{ id: "a2", type: "credit_card", subtype: null, details: null },
		]);
		await expect(database.all(sql`select id from entries order by id`)).resolves.toEqual([
			{ id: "e1" },
			{ id: "e2" },
		]);
		// Dropping the old table must not cascade to the mappings that point at it.
		await expect(
			database.all(sql`select account_id as accountId, mapping from import_mappings`),
		).resolves.toEqual([{ accountId: "a1", mapping: '{"skipRows":2}' }]);
		await expect(database.all(sql`select id from imports`)).resolves.toEqual([{ id: "i1" }]);
		await expect(insertAccount(database, "a3", "loan", "consumer")).resolves.toBeDefined();
		await expect(database.run(sql`delete from accounts where id = 'a1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("investment accounts", () => {
	it("keeps every account, entry and CSV mapping when 0019 rebuilds accounts", async () => {
		const before = await migratedBefore("0019");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "credit_card", null);
		await before.run(
			sql`insert into accounts (id, name, type, subtype, currency, details, created_at, updated_at) values ('a3', 'A', 'loan', 'mortgage', 'EUR', '{"originalAmount":20000000,"interestRate":345,"endDate":"2045-01-01"}', 0, 0)`,
		);
		await insertEntry(before, "e1", "valuation", "opening_anchor");
		await insertEntry(before, "e2", "transaction", null);
		await before.run(sql`insert into transactions (entry_id, label) values ('e2', 'Boulangerie')`);
		await before.run(
			sql`insert into import_mappings (account_id, mapping, updated_at) values ('a1', '{"skipRows":2}', 0)`,
		);
		await insertImport(before, "i1", "confirmed");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, type, subtype, details from accounts order by id`),
		).resolves.toEqual([
			{ id: "a1", type: "depository", subtype: "checking", details: null },
			{ id: "a2", type: "credit_card", subtype: null, details: null },
			{
				id: "a3",
				type: "loan",
				subtype: "mortgage",
				details: '{"originalAmount":20000000,"interestRate":345,"endDate":"2045-01-01"}',
			},
		]);
		await expect(database.all(sql`select id from entries order by id`)).resolves.toEqual([
			{ id: "e1" },
			{ id: "e2" },
		]);
		await expect(
			database.all(sql`select account_id as accountId, mapping from import_mappings`),
		).resolves.toEqual([{ accountId: "a1", mapping: '{"skipRows":2}' }]);
		await expect(database.all(sql`select id from imports`)).resolves.toEqual([{ id: "i1" }]);
		await expect(
			insertAccount(database, "a4", "investment", "assurance_vie"),
		).resolves.toBeDefined();
		await expect(database.run(sql`delete from accounts where id = 'a1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("property and vehicle accounts", () => {
	it("keeps every account, entry, CSV mapping and import when 0020 rebuilds accounts", async () => {
		const before = await migratedBefore("0020");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "investment", "pea");
		await before.run(
			sql`insert into accounts (id, name, type, subtype, currency, details, created_at, updated_at) values ('a3', 'A', 'loan', 'mortgage', 'EUR', '{"originalAmount":20000000,"interestRate":345,"endDate":"2045-01-01"}', 0, 0)`,
		);
		await insertEntry(before, "e1", "valuation", "opening_anchor");
		await insertEntry(before, "e2", "transaction", null);
		await before.run(sql`insert into transactions (entry_id, label) values ('e2', 'Boulangerie')`);
		await before.run(
			sql`insert into import_mappings (account_id, mapping, updated_at) values ('a1', '{"skipRows":2}', 0)`,
		);
		await insertImport(before, "i1", "confirmed");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, type, subtype, details from accounts order by id`),
		).resolves.toEqual([
			{ id: "a1", type: "depository", subtype: "checking", details: null },
			{ id: "a2", type: "investment", subtype: "pea", details: null },
			{
				id: "a3",
				type: "loan",
				subtype: "mortgage",
				details: '{"originalAmount":20000000,"interestRate":345,"endDate":"2045-01-01"}',
			},
		]);
		await expect(database.all(sql`select id from entries order by id`)).resolves.toEqual([
			{ id: "e1" },
			{ id: "e2" },
		]);
		await expect(
			database.all(sql`select account_id as accountId, mapping from import_mappings`),
		).resolves.toEqual([{ accountId: "a1", mapping: '{"skipRows":2}' }]);
		await expect(database.all(sql`select id from imports`)).resolves.toEqual([{ id: "i1" }]);
		await expect(
			insertAccount(database, "a4", "property", "single_family_home"),
		).resolves.toBeDefined();
		await expect(insertAccount(database, "a5", "vehicle", null)).resolves.toBeDefined();
		await expect(database.run(sql`delete from accounts where id = 'a1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
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
