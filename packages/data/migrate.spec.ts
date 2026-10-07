import type { Database } from "./client.ts";

import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "./client.ts";
import { migrateFromEnv, runMigrations } from "./migrate.ts";
import { migrateBefore } from "./testing/migrations.ts";

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

// A loan written before 0058, as every migration since leaves it.
const LEGACY_LOAN_AFTER_0058 =
	'{"originalAmount":20000000,"interestRate":34500,"endDate":"2045-01-01","downPayment":null,"startDate":null,"termMonths":null,"rateType":null,"insuranceRate":null,"insuranceRateType":null,"rateChanges":[]}';

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

/**
 * A database migrated up to, not including, the migration whose tag starts
 * with `tag`.
 */
async function migratedBefore(tag: string): Promise<Database> {
	await migrateBefore(url, tag);

	return createDb(url);
}

const insertUser = (database: Database, id: string, role: string | null) =>
	database.run(
		sql`insert into users (id, name, email, role) values (${id}, 'A', ${`${id}@example.test`}, ${role})`,
	);

describe("users and settings", () => {
	it("accepts the admin and viewer roles only, and requires one", async () => {
		const database = await migrated();

		await expect(insertUser(database, "u1", "admin")).resolves.toBeDefined();
		await expect(insertUser(database, "u2", "viewer")).resolves.toBeDefined();
		await expect(insertUser(database, "u3", "owner")).rejects.toThrow();
		await expect(insertUser(database, "u4", null)).rejects.toThrow();
	});

	it("keeps an administrator's session, credential, two-factor and consent when 0044 rebuilds users", async () => {
		const before = await migratedBefore("0044");
		await insertUser(before, "u1", "admin");
		await before.run(sql`update users set two_factor_enabled = 1 where id = 'u1'`);
		await before.run(
			sql`insert into sessions (id, expires_at, token, updated_at, user_id) values ('s1', 0, 't1', 0, 'u1')`,
		);
		await before.run(
			sql`insert into auth_accounts (id, account_id, provider_id, user_id, password, updated_at) values ('c1', 'u1', 'credential', 'u1', 'hash', 0)`,
		);
		await before.run(
			sql`insert into two_factors (id, secret, backup_codes, user_id) values ('f1', 'secret', 'codes', 'u1')`,
		);
		await before.run(
			sql`insert into oauth_clients (id, client_id, redirect_uris, user_id) values ('k1', 'client', '[]', 'u1')`,
		);
		await before.run(
			sql`insert into oauth_consents (id, client_id, user_id, scopes, created_at, updated_at) values ('o1', 'client', 'u1', '["archant:read"]', 0, 0)`,
		);
		await before.run(
			sql`insert into oauth_refresh_tokens (id, token, client_id, user_id, expires_at, created_at, scopes) values ('r1', 'refresh', 'client', 'u1', 0, 0, '[]')`,
		);
		await before.run(
			sql`insert into oauth_access_tokens (id, token, client_id, user_id, expires_at, created_at, scopes) values ('a1', 'access', 'client', 'u1', 0, 0, '[]')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, email, role, two_factor_enabled as twoFactorEnabled from users`),
		).resolves.toEqual([
			{ id: "u1", email: "u1@example.test", role: "admin", twoFactorEnabled: 1 },
		]);
		await expect(database.all(sql`select id from sessions`)).resolves.toEqual([{ id: "s1" }]);
		await expect(database.all(sql`select password from auth_accounts`)).resolves.toEqual([
			{ password: "hash" },
		]);
		await expect(database.all(sql`select id from two_factors`)).resolves.toEqual([{ id: "f1" }]);
		await expect(database.all(sql`select id from oauth_consents`)).resolves.toEqual([{ id: "o1" }]);
		await expect(database.all(sql`select user_id as userId from oauth_clients`)).resolves.toEqual([
			{ userId: "u1" },
		]);
		await expect(database.all(sql`select id from oauth_refresh_tokens`)).resolves.toEqual([
			{ id: "r1" },
		]);
		await expect(database.all(sql`select id from oauth_access_tokens`)).resolves.toEqual([
			{ id: "a1" },
		]);
		await expect(insertUser(database, "u2", "viewer")).resolves.toBeDefined();
		await expect(insertUser(database, "u3", "owner")).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof Error && String(error.cause).includes("users_role_check"),
		);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds one pending invitation per email, a known role only, gone with its inviter", async () => {
		const database = await migrated();
		await insertUser(database, "u1", "admin");
		const insertInvitation = (
			id: string,
			{
				email = "camille@example.test",
				role = "viewer",
				acceptedAt = null,
				hash = id,
			}: { email?: string; role?: string; acceptedAt?: number | null; hash?: string } = {},
		) =>
			database.run(
				sql`insert into invitations (id, email, role, token_hash, inviter_id, expires_at, accepted_at, created_at) values (${id}, ${email}, ${role}, ${hash}, 'u1', 1, ${acceptedAt}, 0)`,
			);

		await expect(insertInvitation("i1")).resolves.toBeDefined();
		await expect(insertInvitation("i2")).rejects.toThrow();
		await expect(insertInvitation("i3", { acceptedAt: 5 })).resolves.toBeDefined();
		await expect(insertInvitation("i4", { acceptedAt: 6 })).resolves.toBeDefined();
		await expect(
			insertInvitation("i5", { email: "dominique@example.test", role: "admin" }),
		).resolves.toBeDefined();
		await expect(
			insertInvitation("i6", { email: "eve@example.test", role: "owner" }),
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof Error && String(error.cause).includes("invitations_role_check"),
		);
		await expect(
			insertInvitation("i7", { email: "eve@example.test", hash: "i1" }),
		).rejects.toThrow();

		await database.run(sql`delete from users where id = 'u1'`);

		await expect(database.all(sql`select id from invitations`)).resolves.toEqual([]);
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
				details: LEGACY_LOAN_AFTER_0058,
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
				details: LEGACY_LOAN_AFTER_0058,
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

const insertRule = (database: Database, id: string) =>
	database.run(sql`insert into rules (id, created_at, updated_at) values (${id}, 0, 0)`);
const insertCondition = (
	database: Database,
	id: string,
	type: string,
	operator: string,
	parentId: string | null = null,
) =>
	database.run(
		sql`insert into rule_conditions (id, rule_id, parent_id, position, condition_type, operator, value) values (${id}, 'r1', ${parentId}, 0, ${type}, ${operator}, 'x')`,
	);
const insertAction = (database: Database, id: string, type: string) =>
	database.run(
		sql`insert into rule_actions (id, rule_id, position, action_type, value) values (${id}, 'r1', 0, ${type}, 'c1')`,
	);

describe("rules", () => {
	it("starts a rule enabled, without name or start date", async () => {
		const database = await migrated();
		await insertRule(database, "r1");

		await expect(
			database.get(sql`select name, enabled, effective_date as effectiveDate from rules`),
		).resolves.toEqual({ name: null, enabled: 1, effectiveDate: null });
	});

	it("accepts only the operators of each condition type, and known action types", async () => {
		const database = await migrated();
		await insertRule(database, "r1");

		await expect(
			insertCondition(database, "c1", "transaction_name", "like"),
		).resolves.toBeDefined();
		await expect(insertCondition(database, "c2", "transaction_name", ">")).rejects.toThrow();
		await expect(
			insertCondition(database, "c3", "transaction_amount", ">="),
		).resolves.toBeDefined();
		await expect(insertCondition(database, "c4", "transaction_amount", "like")).rejects.toThrow();
		await expect(insertCondition(database, "c5", "transaction_account", "!=")).rejects.toThrow();
		await expect(
			insertCondition(database, "c9", "transaction_amount", "!="),
		).resolves.toBeDefined();
		await expect(
			insertCondition(database, "c10", "transaction_account", "="),
		).resolves.toBeDefined();
		await expect(insertCondition(database, "c6", "compound", "or")).resolves.toBeDefined();
		await expect(insertCondition(database, "c7", "compound", "=")).rejects.toThrow();
		await expect(insertCondition(database, "c8", "transaction_other", "=")).rejects.toThrow();
		await expect(insertAction(database, "a1", "set_transaction_category")).resolves.toBeDefined();
		await expect(insertAction(database, "a2", "set_transaction_color")).rejects.toThrow();
	});

	it("accepts Story 8.2's conditions with their operators, and its actions", async () => {
		const database = await migrated();
		await insertRule(database, "r1");

		await expect(
			insertCondition(database, "m1", "transaction_merchant", "="),
		).resolves.toBeDefined();
		await expect(
			insertCondition(database, "m2", "transaction_merchant", "is_null"),
		).resolves.toBeDefined();
		await expect(
			insertCondition(database, "k1", "transaction_category", "is_null"),
		).resolves.toBeDefined();
		await expect(insertCondition(database, "t1", "transaction_tag", "=")).resolves.toBeDefined();
		await expect(
			insertCondition(database, "n1", "transaction_notes", "like"),
		).resolves.toBeDefined();
		await expect(
			insertCondition(database, "n2", "transaction_notes", "is_null"),
		).resolves.toBeDefined();
		await expect(insertCondition(database, "y1", "transaction_type", "=")).resolves.toBeDefined();

		await expect(insertCondition(database, "m3", "transaction_merchant", "like")).rejects.toThrow();
		await expect(insertCondition(database, "y2", "transaction_type", "is_null")).rejects.toThrow();
		await expect(insertCondition(database, "x1", "transaction_name", "is_null")).rejects.toThrow();

		await expect(insertAction(database, "a1", "set_transaction_merchant")).resolves.toBeDefined();
		await expect(insertAction(database, "a2", "set_transaction_tags")).resolves.toBeDefined();
		await expect(insertAction(database, "a3", "set_transaction_name")).resolves.toBeDefined();
		await expect(insertAction(database, "a4", "set_as_transfer_or_payment")).resolves.toBeDefined();

		// Exclusion needs no value, so the column takes null.
		await expect(
			database.run(
				sql`insert into rule_actions (id, rule_id, position, action_type, value) values ('a5', 'r1', 0, 'exclude_transaction', null)`,
			),
		).resolves.toBeDefined();
	});

	it("keeps every rule, condition and action when 0022 rebuilds their tables", async () => {
		const before = await migratedBefore("0022");
		await insertRule(before, "r1");
		await insertCondition(before, "c1", "compound", "or");
		await insertCondition(before, "c2", "transaction_name", "like", "c1");
		await insertCondition(before, "c3", "transaction_amount", ">");
		await insertAction(before, "a1", "set_transaction_category");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, parent_id as parentId from rule_conditions order by id`),
		).resolves.toEqual([
			{ id: "c1", parentId: null },
			{ id: "c2", parentId: "c1" },
			{ id: "c3", parentId: null },
		]);
		await expect(database.all(sql`select id, value from rule_actions`)).resolves.toEqual([
			{ id: "a1", value: "c1" },
		]);
		await database.run(sql`delete from rules where id = 'r1'`);
		await expect(database.all(sql`select id from rule_conditions`)).resolves.toEqual([]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("accepts a replacement in the label with its text, and keeps older actions through 0037", async () => {
		const before = await migratedBefore("0037");
		await insertRule(before, "r1");
		const kept = [
			"set_transaction_category",
			"set_transaction_merchant",
			"set_transaction_tags",
			"set_transaction_name",
			"set_as_transfer_or_payment",
		];
		await Promise.all(kept.map((type, index) => insertAction(before, `a${index + 1}`, type)));
		await before.run(
			sql`insert into rule_actions (id, rule_id, position, action_type, value) values ('a6', 'r1', 0, 'exclude_transaction', null)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, action_type as type, value, replacement from rule_actions order by id`,
			),
		).resolves.toEqual([
			...kept.map((type, index) => ({ id: `a${index + 1}`, type, value: "c1", replacement: null })),
			{ id: "a6", type: "exclude_transaction", value: null, replacement: null },
		]);
		await database.run(
			sql`insert into rule_actions (id, rule_id, position, action_type, value, replacement) values ('a7', 'r1', 1, 'replace_in_transaction_name', '^CARTE ', ' ')`,
		);
		await expect(
			database.get(sql`select value, replacement from rule_actions where id = 'a7'`),
		).resolves.toEqual({ value: "^CARTE ", replacement: " " });
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("starts a transaction expecting no counterpart, and forgets the account once it goes", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertAccount(database, "a2", "depository", "savings");
		await insertEntry(database, "e1", "transaction", null);
		await database.run(sql`insert into transactions (entry_id, label) values ('e1', 'Épargne')`);

		await expect(
			database.get(sql`select expected_transfer_account_id as expected from transactions`),
		).resolves.toEqual({ expected: null });
		await expect(
			database.run(sql`update transactions set expected_transfer_account_id = 'nope'`),
		).rejects.toThrow();

		await database.run(sql`update transactions set expected_transfer_account_id = 'a2'`);
		await database.run(sql`delete from accounts where id = 'a2'`);

		await expect(
			database.get(sql`select expected_transfer_account_id as expected from transactions`),
		).resolves.toEqual({ expected: null });
	});

	it("deletes a rule's conditions, sub-conditions and actions with it", async () => {
		const database = await migrated();
		await insertRule(database, "r1");
		await insertCondition(database, "c1", "compound", "and");
		await insertCondition(database, "c2", "transaction_name", "like", "c1");
		await insertCondition(database, "c3", "transaction_amount", ">");
		await insertAction(database, "a1", "set_transaction_category");

		await database.run(sql`delete from rules where id = 'r1'`);

		await expect(database.all(sql`select id from rule_conditions`)).resolves.toEqual([]);
		await expect(database.all(sql`select id from rule_actions`)).resolves.toEqual([]);
	});

	it("refuses a condition or an action for a rule that does not exist", async () => {
		const database = await migrated();

		await expect(insertCondition(database, "c1", "transaction_name", "like")).rejects.toThrow();
		await expect(insertAction(database, "a1", "set_transaction_category")).rejects.toThrow();
	});

	it("keeps a run and its snapshot once its rule goes, and refuses an unknown rule", async () => {
		const database = await migrated();
		await insertRule(database, "r1");
		const insertRun = (id: string, ruleId: string) =>
			database.run(
				sql`insert into rule_runs (id, rule_id, rule, matched_count, changed_count, executed_at, position) values (${id}, ${ruleId}, '{"name":"Courses"}', 5, 3, 0, 0)`,
			);

		await expect(insertRun("u1", "r1")).resolves.toBeDefined();
		await expect(insertRun("u2", "nope")).rejects.toThrow();

		await database.run(sql`delete from rules where id = 'r1'`);

		await expect(
			database.all(
				sql`select id, rule_id as ruleId, rule, matched_count as matched, changed_count as changed from rule_runs`,
			),
		).resolves.toEqual([
			{ id: "u1", ruleId: null, rule: '{"name":"Courses"}', matched: 5, changed: 3 },
		]);
	});
});

const insertRecurring = (
	database: Database,
	id: string,
	key: { merchantId?: string; labelKey?: string },
	amount = -1399,
	day = 5,
	dedupScope = "",
	currency = "EUR",
) =>
	database.run(
		sql`insert into recurring_transactions (id, account_id, merchant_id, label_key, label, amount, currency, expected_day_of_month, last_occurrence_date, next_expected_date, occurrence_count, dedup_scope, created_at, updated_at) values (${id}, 'a1', ${key.merchantId ?? null}, ${key.labelKey ?? null}, 'NETFLIX', ${amount}, ${currency}, ${day}, '2026-09-05', '2026-10-05', 3, ${dedupScope}, 0, 0)`,
	);

// Before 0055 the table has no dedup scope.
const insertOldRecurring = (
	database: Database,
	id: string,
	accountId: string,
	status: string,
	manual = 0,
) =>
	database.run(
		sql`insert into recurring_transactions (id, account_id, merchant_id, label_key, label, amount, currency, expected_day_of_month, last_occurrence_date, next_expected_date, occurrence_count, status, manual, created_at, updated_at) values (${id}, ${accountId}, null, ${`key-${id}`}, 'NETFLIX', -1399, 'EUR', 5, '2026-09-05', '2026-10-05', 3, ${status}, ${manual}, 0, 0)`,
	);

const insertRecurrenceRule = (
	database: Database,
	id: string,
	rule: {
		frequency?: string;
		interval?: number;
		day?: number | null;
		weekday?: number | null;
		month?: number | null;
		position?: number;
	},
) =>
	database.run(
		sql`insert into recurrence_rules (id, recurring_transaction_id, frequency, interval, day_of_month, weekday, month_of_year, position) values (${id}, 'r1', ${rule.frequency ?? "monthly"}, ${rule.interval ?? 1}, ${rule.day === undefined ? 5 : rule.day}, ${rule.weekday ?? null}, ${rule.month ?? null}, ${rule.position ?? 0})`,
	);

describe("recurring transactions", () => {
	it("holds a merchant or a label key, never both nor neither, and a day from 1 to 31", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertMerchant(database, "m1", "Netflix");

		await expect(insertRecurring(database, "r1", { merchantId: "m1" })).resolves.toBeDefined();
		await expect(insertRecurring(database, "r2", { labelKey: "netflix" })).resolves.toBeDefined();
		await expect(
			insertRecurring(database, "r3", { merchantId: "m1", labelKey: "netflix" }, -1),
		).rejects.toThrow();
		await expect(insertRecurring(database, "r4", {}, -2)).rejects.toThrow();
		await expect(insertRecurring(database, "r5", { labelKey: "x" }, -3, 0)).rejects.toThrow();
		await expect(insertRecurring(database, "r6", { labelKey: "y" }, -3, 32)).rejects.toThrow();
		await expect(insertRecurring(database, "r7", { labelKey: "z" }, -3, 31)).resolves.toBeDefined();
	});

	it("holds one pattern per account, merchant, amount, currency and dedup scope", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertMerchant(database, "m1", "Netflix");
		await insertRecurring(database, "r1", { merchantId: "m1" });

		await expect(insertRecurring(database, "r2", { merchantId: "m1" })).rejects.toThrow();
		await expect(
			insertRecurring(database, "r3", { merchantId: "m1" }, -1799),
		).resolves.toBeDefined();
		await expect(
			insertRecurring(database, "r4", { merchantId: "m1" }, -1399, 5, "-1400"),
		).resolves.toBeDefined();
		await expect(
			insertRecurring(database, "r5", { merchantId: "m1" }, -1399, 5, "", "USD"),
		).resolves.toBeDefined();
	});

	it("holds one pattern per account, label key, amount, currency and dedup scope", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertRecurring(database, "r1", { labelKey: "prlv edf" });

		await expect(insertRecurring(database, "r2", { labelKey: "prlv edf" })).rejects.toThrow();
		await expect(
			insertRecurring(database, "r3", { labelKey: "prlv edf" }, -5000),
		).resolves.toBeDefined();
		await expect(
			insertRecurring(database, "r4", { labelKey: "prlv edf" }, -1399, 5, "-1400"),
		).resolves.toBeDefined();
		await expect(
			insertRecurring(database, "r5", { labelKey: "prlv edf" }, -1399, 5, "", "USD"),
		).resolves.toBeDefined();
	});

	it("goes with its account or its merchant", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertMerchant(database, "m1", "Netflix");
		await insertRecurring(database, "r1", { merchantId: "m1" });
		await insertRecurring(database, "r2", { labelKey: "prlv edf" });

		await database.run(sql`delete from merchants where id = 'm1'`);

		await expect(database.all(sql`select id from recurring_transactions`)).resolves.toEqual([
			{ id: "r2" },
		]);

		await database.run(sql`delete from accounts where id = 'a1'`);

		await expect(database.all(sql`select id from recurring_transactions`)).resolves.toEqual([]);
	});

	it("starts a pattern suggested, not manual, without a band or a dedup scope, and accepts only a known status", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await database.run(
			sql`insert into recurring_transactions (id, account_id, label_key, label, amount, currency, expected_day_of_month, last_occurrence_date, next_expected_date, occurrence_count, created_at, updated_at) values ('r1', 'a1', 'netflix', 'NETFLIX', -1399, 'EUR', 5, '2026-09-05', '2026-10-05', 3, 0, 0)`,
		);
		const setStatus = (status: string) =>
			database.run(sql`update recurring_transactions set status = ${status} where id = 'r1'`);

		await expect(
			database.get(
				sql`select status, manual, dedup_scope as dedupScope, expected_amount_min as min, expected_amount_max as max, expected_amount_avg as avg from recurring_transactions where id = 'r1'`,
			),
		).resolves.toEqual({
			status: "suggested",
			manual: 0,
			dedupScope: "",
			min: null,
			max: null,
			avg: null,
		});
		await expect(setStatus("active")).resolves.toBeDefined();
		await expect(setStatus("inactive")).resolves.toBeDefined();
		await expect(setStatus("ended")).resolves.toBeDefined();
		await expect(setStatus("paused")).rejects.toThrow();
		await expect(setStatus("detected")).rejects.toThrow();
	});

	it("marks every existing pattern detected when 0025 adds the status, suggested since 0055", async () => {
		const before = await migratedBefore("0025");
		await insertAccount(before, "a1", "depository", "checking");
		await before.run(
			sql`insert into recurring_transactions (id, account_id, label_key, label, amount, currency, expected_day_of_month, last_occurrence_date, next_expected_date, occurrence_count, created_at, updated_at) values ('r1', 'a1', 'netflix', 'NETFLIX', -1399, 'EUR', 5, '2026-09-05', '2026-10-05', 3, 0, 0)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, status, manual from recurring_transactions`),
		).resolves.toEqual([{ id: "r1", status: "suggested", manual: 0 }]);
	});

	it("maps each status to Sure's when 0055 renames them, and ends a series on an investment account", async () => {
		const before = await migratedBefore("0055");
		await insertAccount(before, "a1", "depository", "checking");
		await insertAccount(before, "a2", "investment", "pea");
		await insertOldRecurring(before, "r1", "a1", "detected");
		await insertOldRecurring(before, "r2", "a1", "confirmed", 1);
		await insertOldRecurring(before, "r3", "a1", "inactive");
		await insertOldRecurring(before, "r4", "a1", "dismissed");
		await insertOldRecurring(before, "r5", "a2", "confirmed");
		await insertOldRecurring(before, "r6", "a2", "detected");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, status, manual, dedup_scope as dedupScope, expected_amount_avg as avg from recurring_transactions order by id`,
			),
		).resolves.toEqual([
			{ id: "r1", status: "suggested", manual: 0, dedupScope: "", avg: null },
			{ id: "r2", status: "active", manual: 1, dedupScope: "", avg: null },
			{ id: "r3", status: "inactive", manual: 0, dedupScope: "", avg: null },
			{ id: "r4", status: "ended", manual: 0, dedupScope: "", avg: null },
			{ id: "r5", status: "ended", manual: 0, dedupScope: "", avg: null },
			{ id: "r6", status: "ended", manual: 0, dedupScope: "", avg: null },
		]);
	});

	it("gives every series one monthly rule on its day, anchored on its last date, an income when money comes in, when 0056 adds bills", async () => {
		const before = await migratedBefore("0056");
		await insertAccount(before, "a1", "depository", "checking");
		await insertRecurring(before, "r1", { labelKey: "netflix" }, -1399, 5);
		await insertRecurring(before, "r2", { labelKey: "salaire" }, 250_000, 28);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, name, anchor_date as anchor, end_after_count as count, bill_type as type, category_id as category, autopay, notes, payment_url as url, schedule_pinned_at as pinned from recurring_transactions order by id`,
			),
		).resolves.toEqual([
			{
				id: "r1",
				name: null,
				anchor: "2026-09-05",
				count: null,
				type: "bill",
				category: null,
				autopay: 0,
				notes: null,
				url: null,
				pinned: null,
			},
			{
				id: "r2",
				name: null,
				anchor: "2026-09-05",
				count: null,
				type: "income",
				category: null,
				autopay: 0,
				notes: null,
				url: null,
				pinned: null,
			},
		]);
		const rules = await database.all<{ id: string }>(
			sql`select id, recurring_transaction_id as series, frequency, interval, day_of_month as day, weekday, month_of_year as month, position from recurrence_rules order by series`,
		);
		for (const { id } of rules) {
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
		}
		expect(rules.map(({ id: _id, ...rule }) => rule)).toEqual([
			{
				series: "r1",
				frequency: "monthly",
				interval: 1,
				day: 5,
				weekday: null,
				month: null,
				position: 0,
			},
			expect.objectContaining({ series: "r2", frequency: "monthly", day: 28 }),
		]);
		expect(rules[0]?.id).not.toBe(rules[1]?.id);
	});

	it("holds a rule's checks, as Sure's `day_spec_coherent` without the nth weekday", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		let position = 0;
		const rule = (fields: Parameters<typeof insertRecurrenceRule>[2]) => {
			position += 1;

			return insertRecurrenceRule(database, `x${position}`, { position, ...fields });
		};

		await expect(rule({ day: 15 })).resolves.toBeDefined();
		await expect(rule({ day: -1 })).resolves.toBeDefined();
		await expect(rule({ day: 31, interval: 3 })).resolves.toBeDefined();
		await expect(rule({ frequency: "weekly", day: null, weekday: 0 })).resolves.toBeDefined();
		await expect(rule({ frequency: "weekly", day: null, weekday: 6 })).resolves.toBeDefined();
		await expect(rule({ frequency: "yearly", day: 1, month: 12 })).resolves.toBeDefined();

		await expect(rule({ frequency: "daily" })).rejects.toThrow();
		await expect(rule({ interval: 0 })).rejects.toThrow();
		await expect(rule({ day: 0 })).rejects.toThrow();
		await expect(rule({ day: 32 })).rejects.toThrow();
		await expect(rule({ day: -2 })).rejects.toThrow();
		await expect(rule({ frequency: "weekly", day: null, weekday: 7 })).rejects.toThrow();
		await expect(rule({ frequency: "yearly", day: 1, month: 13 })).rejects.toThrow();
		await expect(rule({ frequency: "yearly", day: 1, month: 0 })).rejects.toThrow();
		await expect(insertRecurrenceRule(database, "neg", { position: -1 })).rejects.toThrow();
		// Never a day and a weekday.
		await expect(rule({ day: 5, weekday: 1 })).rejects.toThrow();
		await expect(rule({ frequency: "weekly", day: 5, weekday: 1 })).rejects.toThrow();
		// Weekly has a weekday, no day and no month.
		await expect(rule({ frequency: "weekly", day: null })).rejects.toThrow();
		await expect(rule({ frequency: "weekly", day: null, weekday: 1, month: 3 })).rejects.toThrow();
		// Monthly has a day and no month.
		await expect(rule({ day: null })).rejects.toThrow();
		await expect(rule({ day: 5, month: 3 })).rejects.toThrow();
		// Yearly has a day and a month.
		await expect(rule({ frequency: "yearly", day: 5 })).rejects.toThrow();
		await expect(rule({ frequency: "yearly", day: null, month: 3 })).rejects.toThrow();
	});

	it("holds one rule per series and position, and deletes the rules with their series", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		await insertRecurrenceRule(database, "x1", { day: 1 });

		await expect(insertRecurrenceRule(database, "x2", { day: 15 })).rejects.toThrow();
		await expect(
			insertRecurrenceRule(database, "x3", { day: 15, position: 1 }),
		).resolves.toBeDefined();

		await database.run(sql`delete from recurring_transactions where id = 'r1'`);

		await expect(database.all(sql`select id from recurrence_rules`)).resolves.toEqual([]);
	});

	it("holds a known bill type and 1 to 600 payments, and leaves a series uncategorised when its category goes", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertCategory(database, "c1", "Énergie");
		await insertRecurring(database, "r1", { labelKey: "edf" });
		const set = (assignment: ReturnType<typeof sql>) =>
			database.run(sql`update recurring_transactions set ${assignment} where id = 'r1'`);

		await expect(
			database.get(
				sql`select bill_type as type, autopay from recurring_transactions where id = 'r1'`,
			),
		).resolves.toEqual({ type: "bill", autopay: 0 });
		await expect(set(sql`bill_type = 'subscription'`)).resolves.toBeDefined();
		await expect(set(sql`bill_type = 'transfer'`)).rejects.toThrow();
		await expect(set(sql`end_after_count = 1`)).resolves.toBeDefined();
		await expect(set(sql`end_after_count = 600`)).resolves.toBeDefined();
		await expect(set(sql`end_after_count = 0`)).rejects.toThrow();
		await expect(set(sql`end_after_count = 601`)).rejects.toThrow();
		await expect(set(sql`category_id = 'c1'`)).resolves.toBeDefined();

		await database.run(sql`delete from categories where id = 'c1'`);

		await expect(
			database.get(sql`select id, category_id as category from recurring_transactions`),
		).resolves.toEqual({ id: "r1", category: null });
	});

	it("gives every existing series no alias and no learned tolerance when 0057 adds occurrences", async () => {
		const before = await migratedBefore("0057");
		await insertAccount(before, "a1", "depository", "checking");
		await insertRecurring(before, "r1", { labelKey: "netflix" });
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, name_aliases as aliases, learned_tolerance as tolerance from recurring_transactions`,
			),
		).resolves.toEqual([{ id: "r1", aliases: "[]", tolerance: null }]);
	});

	it("holds an occurrence's checks, one per series and original date, and deletes it with its series", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		let count = 0;
		const occurrence = (fields: {
			due?: string;
			status?: string;
			closedAt?: number | null;
			source?: string | null;
			amount?: number | null;
		}) => {
			count += 1;

			return insertOccurrence(database, `o${count}`, fields);
		};

		await expect(occurrence({})).resolves.toBeDefined();
		await expect(
			database.get(
				sql`select status, expected_amount as amount, closed_source as source from recurring_occurrences where id = 'o1'`,
			),
		).resolves.toEqual({ status: "scheduled", amount: null, source: null });
		await expect(occurrence({ due: "2026-11-05", amount: 0 })).resolves.toBeDefined();
		await expect(
			occurrence({ due: "2026-12-05", status: "paid", closedAt: 1, source: "auto" }),
		).resolves.toBeDefined();
		await expect(
			occurrence({ due: "2027-01-05", status: "skipped", closedAt: 1, source: "user" }),
		).resolves.toBeDefined();
		await expect(
			occurrence({ due: "2027-02-05", status: "missed", closedAt: 1 }),
		).resolves.toBeDefined();

		// One per series and original date.
		await expect(occurrence({})).rejects.toThrow();
		await expect(occurrence({ due: "2027-03-05", status: "late" })).rejects.toThrow();
		await expect(
			occurrence({ due: "2027-03-05", status: "paid", closedAt: 1, source: "bank" }),
		).rejects.toThrow();
		await expect(occurrence({ due: "2027-03-05", amount: -1 })).rejects.toThrow();
		// Closed exactly when not scheduled.
		await expect(occurrence({ due: "2027-03-05", status: "paid" })).rejects.toThrow();
		await expect(occurrence({ due: "2027-03-05", closedAt: 1 })).rejects.toThrow();

		await database.run(sql`delete from recurring_transactions where id = 'r1'`);

		await expect(database.all(sql`select id from recurring_occurrences`)).resolves.toEqual([]);
	});

	it("holds a payment's checks, once per occurrence and transaction, and keeps it when its transaction goes", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertEntry(database, "e2", "transaction", null);
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		await insertOccurrence(database, "o1", {});
		await insertOccurrence(database, "o2", { due: "2026-11-05" });
		let count = 0;
		const payment = (fields: Parameters<typeof insertAllocation>[2]) => {
			count += 1;

			return insertAllocation(database, `p${count}`, fields);
		};

		await expect(payment({ entryId: "e1" })).resolves.toBeDefined();
		await expect(
			database.get(sql`select match_signals as signals from recurring_allocations where id = 'p1'`),
		).resolves.toEqual({ signals: "{}" });
		await expect(payment({ entryId: "e1", occurrenceId: "o2" })).resolves.toBeDefined();
		await expect(payment({ entryId: null })).resolves.toBeDefined();
		await expect(payment({ entryId: null })).resolves.toBeDefined();
		await expect(
			payment({ entryId: "e2", state: "suggested", source: "auto_matched" }),
		).resolves.toBeDefined();

		await expect(payment({ entryId: "e1" })).rejects.toThrow();
		await expect(payment({ entryId: null, amount: 0 })).rejects.toThrow();
		await expect(payment({ entryId: null, state: "pending" })).rejects.toThrow();
		await expect(payment({ entryId: null, source: "bank" })).rejects.toThrow();
		await expect(payment({ entryId: null, occurrenceId: "nope" })).rejects.toThrow();

		await database.run(sql`delete from entries where id = 'e1'`);

		await expect(
			database.all(
				sql`select id, entry_id as entryId from recurring_allocations where id in ('p1', 'p2') order by id`,
			),
		).resolves.toEqual([
			{ id: "p1", entryId: null },
			{ id: "p2", entryId: null },
		]);

		await database.run(sql`delete from recurring_occurrences where id = 'o1'`);

		await expect(
			database.all(sql`select id from recurring_allocations order by id`),
		).resolves.toEqual([{ id: "p2" }]);
	});

	it("holds one rejection per series and transaction, gone with either", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertEntry(database, "e2", "transaction", null);
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		await insertRecurring(database, "r2", { labelKey: "edf" });
		const reject = (id: string, series: string, entry: string) =>
			database.run(
				sql`insert into recurring_match_rejections (id, recurring_transaction_id, entry_id, created_at, updated_at) values (${id}, ${series}, ${entry}, 0, 0)`,
			);

		await expect(reject("j1", "r1", "e1")).resolves.toBeDefined();
		await expect(reject("j2", "r2", "e1")).resolves.toBeDefined();
		await expect(reject("j3", "r1", "e2")).resolves.toBeDefined();
		await expect(reject("j4", "r1", "e1")).rejects.toThrow();

		await database.run(sql`delete from entries where id = 'e1'`);
		await expect(database.all(sql`select id from recurring_match_rejections`)).resolves.toEqual([
			{ id: "j3" },
		]);

		await database.run(sql`delete from recurring_transactions where id = 'r1'`);
		await expect(database.all(sql`select id from recurring_match_rejections`)).resolves.toEqual([]);
	});

	it("holds one price change per series and date, positive amounts, its transaction set null on delete", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertRecurring(database, "r1", { labelKey: "netflix" });
		const change = (id: string, on: string, previous: number, next: number) =>
			database.run(
				sql`insert into recurring_price_changes (id, recurring_transaction_id, effective_on, previous_amount, new_amount, currency, entry_id, created_at, updated_at) values (${id}, 'r1', ${on}, ${previous}, ${next}, 'EUR', 'e1', 0, 0)`,
			);

		await expect(change("c1", "2026-09-05", 1399, 1599)).resolves.toBeDefined();
		await expect(change("c2", "2026-09-05", 1599, 1799)).rejects.toThrow();
		await expect(change("c3", "2026-10-05", 1599, 0)).rejects.toThrow();
		await expect(change("c4", "2026-10-05", -1, 1599)).rejects.toThrow();

		await database.run(sql`delete from entries where id = 'e1'`);
		await expect(
			database.all(sql`select id, entry_id as entryId from recurring_price_changes`),
		).resolves.toEqual([{ id: "c1", entryId: null }]);

		await database.run(sql`delete from recurring_transactions where id = 'r1'`);
		await expect(database.all(sql`select id from recurring_price_changes`)).resolves.toEqual([]);
	});
});

const insertOccurrence = (
	database: Database,
	id: string,
	fields: {
		due?: string;
		status?: string;
		closedAt?: number | null;
		source?: string | null;
		amount?: number | null;
	},
) =>
	database.run(
		sql`insert into recurring_occurrences (id, recurring_transaction_id, original_due_on, due_on, currency, expected_amount, status, closed_at, closed_source, created_at, updated_at) values (${id}, 'r1', ${fields.due ?? "2026-10-05"}, ${fields.due ?? "2026-10-05"}, 'EUR', ${fields.amount ?? null}, ${fields.status ?? "scheduled"}, ${fields.closedAt ?? null}, ${fields.source ?? null}, 0, 0)`,
	);

const insertAllocation = (
	database: Database,
	id: string,
	fields: {
		entryId: string | null;
		occurrenceId?: string;
		amount?: number;
		state?: string;
		source?: string;
	},
) =>
	database.run(
		sql`insert into recurring_allocations (id, recurring_occurrence_id, entry_id, allocated_amount, state, source, created_at, updated_at) values (${id}, ${fields.occurrenceId ?? "o1"}, ${fields.entryId}, ${fields.amount ?? 1399}, ${fields.state ?? "confirmed"}, ${fields.source ?? "user_confirmed"}, 0, 0)`,
	);

const insertConnection = (
	database: Database,
	id: string,
	fields: { status?: string; state?: string | null; connector?: string } = {},
) =>
	database.run(
		sql`insert into bank_connections (id, connector, institution_name, country, status, authorization_state, created_at, updated_at) values (${id}, ${fields.connector ?? "enable-banking"}, 'Banque Test', 'FR', ${fields.status ?? "pending"}, ${fields.state === undefined ? `state-${id}` : fields.state}, 0, 0)`,
	);

describe("bank connections", () => {
	it("accepts only a known status and connector", async () => {
		const database = await migrated();

		await expect(insertConnection(database, "c1")).resolves.toBeDefined();
		await expect(insertConnection(database, "c2", { status: "active" })).resolves.toBeDefined();
		await expect(insertConnection(database, "c3", { status: "revoked" })).rejects.toThrow();
		await expect(insertConnection(database, "c4", { connector: "plaid" })).rejects.toThrow();
	});

	it("keeps an authorization state unique, and any number of cleared ones", async () => {
		const database = await migrated();
		await insertConnection(database, "c1", { state: "s1" });

		await expect(insertConnection(database, "c2", { state: "s1" })).rejects.toThrow();
		await expect(insertConnection(database, "c3", { state: null })).resolves.toBeDefined();
		await expect(insertConnection(database, "c4", { state: null })).resolves.toBeDefined();
	});

	it("starts without a session or a consent expiry", async () => {
		const database = await migrated();
		await insertConnection(database, "c1");

		await expect(
			database.get(
				sql`select session_id as sessionId, consent_expires_at as expiresAt from bank_connections`,
			),
		).resolves.toEqual({ sessionId: null, expiresAt: null });
	});
});

const insertBankAccount = (database: Database, id: string, connectionId: string, hash: string) =>
	database.run(
		sql`insert into bank_accounts (id, bank_connection_id, identification_hash, provider_uid, name, currency, created_at, updated_at) values (${id}, ${connectionId}, ${hash}, ${`uid-${id}`}, 'Compte courant', 'EUR', 0, 0)`,
	);

describe("bank accounts", () => {
	it("holds an identification hash once per connection", async () => {
		const database = await migrated();
		await insertConnection(database, "c1");
		await insertConnection(database, "c2");
		await insertBankAccount(database, "b1", "c1", "hash-1");

		await expect(insertBankAccount(database, "b2", "c1", "hash-1")).rejects.toThrow();
		await expect(insertBankAccount(database, "b3", "c2", "hash-1")).resolves.toBeDefined();
		await expect(insertBankAccount(database, "b4", "c1", "hash-2")).resolves.toBeDefined();
	});

	it("feeds one account at most, and an account from one bank account at most", async () => {
		const database = await migrated();
		await insertConnection(database, "c1");
		await insertBankAccount(database, "b1", "c1", "hash-1");
		await insertBankAccount(database, "b2", "c1", "hash-2");
		await insertAccount(database, "a1", "depository", "checking");
		await insertAccount(database, "a2", "depository", "checking");
		await insertAccount(database, "a3", "depository", "checking");

		await expect(
			database.run(sql`update accounts set bank_account_id = 'b1' where id = 'a1'`),
		).resolves.toBeDefined();
		await expect(
			database.run(sql`update accounts set bank_account_id = 'b1' where id = 'a2'`),
		).rejects.toThrow();
		await expect(
			database.run(sql`update accounts set bank_account_id = 'nope' where id = 'a2'`),
		).rejects.toThrow();
		// Any number of accounts fed by no bank.
		await expect(
			database.all(sql`select id from accounts where bank_account_id is null order by id`),
		).resolves.toEqual([{ id: "a2" }, { id: "a3" }]);
	});

	it("goes with its connection, and leaves the account it fed with its history", async () => {
		const database = await migrated();
		await insertConnection(database, "c1");
		await insertBankAccount(database, "b1", "c1", "hash-1");
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "valuation", "opening_anchor");
		await database.run(sql`update accounts set bank_account_id = 'b1' where id = 'a1'`);

		await database.run(sql`delete from bank_connections where id = 'c1'`);

		await expect(database.all(sql`select id from bank_accounts`)).resolves.toEqual([]);
		await expect(
			database.all(sql`select id, bank_account_id as bankAccountId from accounts`),
		).resolves.toEqual([{ id: "a1", bankAccountId: null }]);
		await expect(database.all(sql`select id from entries`)).resolves.toEqual([{ id: "e1" }]);
	});

	it("keeps every account unlinked when 0027 adds the column", async () => {
		const before = await migratedBefore("0027");
		await insertAccount(before, "a1", "depository", "checking");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, bank_account_id as bankAccountId from accounts`),
		).resolves.toEqual([{ id: "a1", bankAccountId: null }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("bank sync", () => {
	it("accepts a key from a bank connector, and forgets its connection once it goes", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await insertConnection(database, "c1");

		await expect(
			database.run(
				sql`insert into entry_keys (entry_id, account_id, source, key, connection_id) values ('e1', 'a1', 'enable-banking', 'ext:1', 'c1')`,
			),
		).resolves.toBeDefined();
		await expect(
			database.run(
				sql`insert into entry_keys (entry_id, account_id, source, key, connection_id) values ('e1', 'a1', 'enable-banking', 'ext:2', 'nope')`,
			),
		).rejects.toThrow();
		await expect(insertKey(database, "fp:1", "e1", "plaid")).rejects.toThrow();

		await database.run(sql`delete from bank_connections where id = 'c1'`);

		await expect(
			database.all(sql`select source, key, connection_id as connectionId from entry_keys`),
		).resolves.toEqual([{ source: "enable-banking", key: "ext:1", connectionId: null }]);
	});

	it("starts a connection and a bank account never synced and unleased", async () => {
		const database = await migrated();
		await insertConnection(database, "c1");
		await insertBankAccount(database, "b1", "c1", "hash-1");

		await expect(
			database.get(
				sql`select last_synced_at as lastSyncedAt, last_error as lastError, sync_started_at as syncStartedAt from bank_connections`,
			),
		).resolves.toEqual({ lastSyncedAt: null, lastError: null, syncStartedAt: null });
		await expect(
			database.get(sql`select last_synced_at as lastSyncedAt from bank_accounts`),
		).resolves.toEqual({ lastSyncedAt: null });
	});

	it("leaves an existing connection without a start date when 0059 adds it", async () => {
		const before = await migratedBefore("0059");
		await insertConnection(before, "c1", { status: "active" });
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, sync_start_date as syncStartDate from bank_connections`),
		).resolves.toEqual([{ id: "c1", syncStartDate: null }]);
	});

	it("keeps every key when 0028 rebuilds entry_keys", async () => {
		const before = await migratedBefore("0028");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await insertKey(before, "fp:1", "e1", "csv");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, source, key, import_id as importId, connection_id as connectionId from entry_keys`,
			),
		).resolves.toEqual([
			{ entryId: "e1", source: "csv", key: "fp:1", importId: null, connectionId: null },
		]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
		await expect(
			database.all(
				sql`select name from pragma_index_list('entry_keys') where name = 'entry_keys_connection'`,
			),
		).resolves.toEqual([{ name: "entry_keys_connection" }]);
	});
});

describe("pending transactions", () => {
	it("keeps every transaction and key booked with no missed sync when 0029 adds pending", async () => {
		const before = await migratedBefore("0029");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(
			sql`insert into transactions (entry_id, label, excluded, locked_fields) values ('e1', 'Boulangerie', 1, '["label"]')`,
		);
		await insertKey(before, "fp:1", "e1", "csv");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, label, excluded, locked_fields as locked, pending, pending_missed_syncs as missed from transactions`,
			),
		).resolves.toEqual([
			{
				entryId: "e1",
				label: "Boulangerie",
				excluded: 1,
				locked: '["label"]',
				pending: 0,
				missed: 0,
			},
		]);
		await expect(
			database.all(sql`select entry_id as entryId, key from entry_keys`),
		).resolves.toEqual([{ entryId: "e1", key: "fp:1" }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("starts a transaction booked with no missed sync", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "depository", "checking");
		await insertEntry(database, "e1", "transaction", null);
		await database.run(sql`insert into transactions (entry_id, label) values ('e1', 'A')`);

		await expect(
			database.get(sql`select pending, pending_missed_syncs as missed from transactions`),
		).resolves.toEqual({ pending: 0, missed: 0 });
	});
});

describe("consent renewal", () => {
	it("keeps every connection with no authorisation times, and every bank account listed, when 0030 runs", async () => {
		const before = await migratedBefore("0030");
		await insertConnection(before, "c1", { status: "active", state: null });
		await insertBankAccount(before, "b1", "c1", "hash-1");
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, status, authorization_started_at as startedAt, authorized_at as authorizedAt from bank_connections`,
			),
		).resolves.toEqual([{ id: "c1", status: "active", startedAt: null, authorizedAt: null }]);
		await expect(database.all(sql`select id, listed from bank_accounts`)).resolves.toEqual([
			{ id: "b1", listed: 1 },
		]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("still refuses a status other than pending or active", async () => {
		const database = await migrated();

		await expect(insertConnection(database, "c1", { status: "expired" })).rejects.toThrow();
	});
});

describe("pending misses by day", () => {
	it("keeps every pending transaction with its missed syncs and no missed day when 0031 runs", async () => {
		const before = await migratedBefore("0031");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(
			sql`insert into transactions (entry_id, label, pending, pending_missed_syncs) values ('e1', 'Carte', 1, 1)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, pending, pending_missed_syncs as missed, pending_missed_on as missedOn from transactions`,
			),
		).resolves.toEqual([{ entryId: "e1", pending: 1, missed: 1, missedOn: null }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("deleted entry keys", () => {
	it("starts empty when 0032 runs, and refuses a file source or an unknown account", async () => {
		const before = await migratedBefore("0032");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await insertKey(before, "fp:1", "e1", "enable-banking");
		before.$client.close();

		const database = await migrated();

		await expect(database.all(sql`select * from deleted_entry_keys`)).resolves.toEqual([]);
		await expect(
			database.all(sql`select entry_id as entryId, key from entry_keys`),
		).resolves.toEqual([{ entryId: "e1", key: "fp:1" }]);
		await expect(
			database.run(
				sql`insert into deleted_entry_keys (account_id, source, key, deleted_at) values ('a1', 'csv', 'fp:1', 0)`,
			),
		).rejects.toThrow();
		await expect(
			database.run(
				sql`insert into deleted_entry_keys (account_id, source, key, deleted_at) values ('nope', 'enable-banking', 'fp:1', 0)`,
			),
		).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertBudget = (
	database: Database,
	id: string,
	month: string,
	spending: number | null,
	income: number | null,
) =>
	database.run(
		sql`insert into budgets (id, month, currency, budgeted_spending, expected_income, created_at, updated_at) values (${id}, ${month}, 'EUR', ${spending}, ${income}, 0, 0)`,
	);

describe("budgets", () => {
	it("holds one budget per month, amounts unset or never negative", async () => {
		const database = await migrated();

		await expect(insertBudget(database, "b1", "2026-10", null, null)).resolves.toBeDefined();
		await expect(insertBudget(database, "b2", "2026-10", 100, 100)).rejects.toThrow();
		await expect(insertBudget(database, "b3", "2026-11", 0, 250_000)).resolves.toBeDefined();
		await expect(insertBudget(database, "b4", "2026-12", -1, 0)).rejects.toThrow();
		await expect(insertBudget(database, "b5", "2027-01", 0, -1)).rejects.toThrow();
	});

	it("holds one amount per category and budget, never negative, gone with either", async () => {
		const database = await migrated();
		const insertAmount = (id: string, budgetId: string, categoryId: string, amount: number) =>
			database.run(
				sql`insert into budget_categories (id, budget_id, category_id, budgeted_spending, created_at, updated_at) values (${id}, ${budgetId}, ${categoryId}, ${amount}, 0, 0)`,
			);
		const remaining = async () =>
			(await database.all<{ id: string }>(sql`select id from budget_categories order by id`)).map(
				(row) => row.id,
			);
		await insertBudget(database, "b1", "2026-10", 100_000, 0);
		await insertBudget(database, "b2", "2026-11", 100_000, 0);
		await insertCategory(database, "c1", "Courses");
		await insertCategory(database, "c2", "Loisirs");

		await expect(insertAmount("bc1", "b1", "c1", 50_000)).resolves.toBeDefined();
		await expect(insertAmount("bc2", "b1", "c1", 10_000)).rejects.toThrow();
		await expect(insertAmount("bc3", "b1", "c2", -1)).rejects.toThrow();
		await expect(insertAmount("bc4", "b1", "unknown", 0)).rejects.toThrow();
		await insertAmount("bc5", "b1", "c2", 0);
		await insertAmount("bc6", "b2", "c1", 20_000);

		await database.run(sql`delete from categories where id = 'c2'`);
		await expect(remaining()).resolves.toEqual(["bc1", "bc6"]);

		await database.run(sql`delete from budgets where id = 'b1'`);
		await expect(remaining()).resolves.toEqual(["bc6"]);
	});
});

const insertGoal = (
	database: Database,
	id: string,
	{ target = 100_000, state = "active", kind = "one_off" } = {},
) =>
	database.run(
		sql`insert into goals (id, name, target_amount, currency, color, icon, state, kind, created_at, updated_at) values (${id}, 'Vacances', ${target}, 'EUR', '#fc7840', 'piggy-bank', ${state}, ${kind}, 0, 0)`,
	);

describe("goals", () => {
	it("holds a positive target, Sure's states and kinds", async () => {
		const database = await migrated();

		await expect(insertGoal(database, "g1")).resolves.toBeDefined();
		await expect(
			database.all(sql`select state, kind, target_date as targetDate from goals`),
		).resolves.toEqual([{ state: "active", kind: "one_off", targetDate: null }]);
		await expect(insertGoal(database, "g2", { target: 0 })).rejects.toThrow();
		await expect(insertGoal(database, "g3", { state: "done" })).rejects.toThrow();
		await expect(insertGoal(database, "g4", { kind: "reserve" })).rejects.toThrow();
		await expect(
			insertGoal(database, "g5", { state: "archived", kind: "maintained" }),
		).resolves.toBeDefined();
	});

	it("links an account once per goal, whole or a fixed amount never negative, gone with either", async () => {
		const database = await migrated();
		const link = (goalId: string, accountId: string, amount: number | null) =>
			database.run(
				sql`insert into goal_accounts (goal_id, account_id, allocated_amount) values (${goalId}, ${accountId}, ${amount})`,
			);
		const remaining = async () =>
			(
				await database.all<{ link: string }>(
					sql`select goal_id || ' ' || account_id as link from goal_accounts order by link`,
				)
			).map((row) => row.link);
		await insertAccount(database, "a1", "depository", "savings");
		await insertAccount(database, "a2", "depository", "checking");
		await insertGoal(database, "g1");
		await insertGoal(database, "g2");

		await expect(link("g1", "a1", null)).resolves.toBeDefined();
		await expect(link("g1", "a1", 0)).rejects.toThrow();
		await expect(link("g1", "a2", -1)).rejects.toThrow();
		await expect(link("g1", "unknown", 0)).rejects.toThrow();
		await expect(link("unknown", "a1", 0)).rejects.toThrow();
		await link("g1", "a2", 30_000);
		await link("g2", "a1", 0);
		await link("g2", "a2", null);
		await expect(
			database.all(
				sql`select name from pragma_index_list('goal_accounts') where name = 'goal_accounts_account'`,
			),
		).resolves.toHaveLength(1);

		await database.run(sql`delete from accounts where id = 'a1'`);
		await expect(remaining()).resolves.toEqual(["g1 a2", "g2 a2"]);

		await database.run(sql`delete from goals where id = 'g1'`);
		await expect(remaining()).resolves.toEqual(["g2 a2"]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds a completed amount and its time together, or neither", async () => {
		const database = await migrated();
		await insertGoal(database, "g1");
		const complete = (amount: number | null, at: number | null) =>
			database.run(sql`update goals set completed_amount = ${amount}, completed_at = ${at}`);

		await expect(complete(45_000, 1_790_000_000_000)).resolves.toBeDefined();
		await expect(complete(null, null)).resolves.toBeDefined();
		await expect(complete(45_000, null)).rejects.toThrow();
		await expect(complete(null, 1_790_000_000_000)).rejects.toThrow();
	});

	it("keeps every goal and its links when 0047 rebuilds goals, none completed", async () => {
		const before = await migratedBefore("0047");
		await insertAccount(before, "a1", "depository", "savings");
		await insertGoal(before, "g1", { state: "paused" });
		await before.run(
			sql`insert into goal_accounts (goal_id, account_id, allocated_amount) values ('g1', 'a1', 30000)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, state, completed_amount as completedAmount, completed_at as completedAt from goals`,
			),
		).resolves.toEqual([{ id: "g1", state: "paused", completedAmount: null, completedAt: null }]);
		await expect(
			database.all(sql`select goal_id as goalId, allocated_amount as amount from goal_accounts`),
		).resolves.toEqual([{ goalId: "g1", amount: 30_000 }]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("keeps every goal, its icon and its links when 0061 lets a goal go without an icon", async () => {
		const before = await migratedBefore("0061");
		await insertAccount(before, "a1", "depository", "savings");
		await insertGoal(before, "g1");
		await before.run(
			sql`insert into goal_accounts (goal_id, account_id, allocated_amount) values ('g1', 'a1', null)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(database.all(sql`select id, icon from goals`)).resolves.toEqual([
			{ id: "g1", icon: "piggy-bank" },
		]);
		await expect(
			database.all(sql`select goal_id as goalId, account_id as accountId from goal_accounts`),
		).resolves.toEqual([{ goalId: "g1", accountId: "a1" }]);
		// Sure's `goals.icon` is nullable: a goal without one shows its initial.
		await expect(
			database.run(
				sql`insert into goals (id, name, target_amount, currency, color, icon, created_at, updated_at) values ('g2', 'Vacances', 100000, 'EUR', '#fc7840', null, 0, 0)`,
			),
		).resolves.toBeDefined();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds a fixed target, or a reserve's months of expenses between 1 and 120", async () => {
		const database = await migrated();
		await insertGoal(database, "g1");
		await insertGoal(database, "g2", { kind: "maintained" });
		const target = (id: string, mode: string, months: number | null) =>
			database.run(
				sql`update goals set target_mode = ${mode}, target_months = ${months} where id = ${id}`,
			);

		await expect(
			database.all(sql`select target_mode as mode, target_months as months from goals`),
		).resolves.toEqual([
			{ mode: "fixed", months: null },
			{ mode: "fixed", months: null },
		]);
		await expect(target("g2", "months_of_expenses", 6)).resolves.toBeDefined();
		await expect(target("g2", "months_of_expenses", 1)).resolves.toBeDefined();
		await expect(target("g2", "months_of_expenses", 120)).resolves.toBeDefined();
		await expect(target("g2", "months_of_expenses", 0)).rejects.toThrow();
		await expect(target("g2", "months_of_expenses", 121)).rejects.toThrow();
		await expect(target("g2", "months_of_expenses", null)).rejects.toThrow();
		await expect(target("g2", "fixed", 6)).rejects.toThrow();
		await expect(target("g2", "weekly", null)).rejects.toThrow();
		// Months of expenses size a reserve, never a one-off goal.
		await expect(target("g1", "months_of_expenses", 6)).rejects.toThrow();
	});

	it("keeps a reserve without a date, and a one-off goal with one", async () => {
		const database = await migrated();
		await insertGoal(database, "g1");
		await insertGoal(database, "g2", { kind: "maintained" });
		const date = (id: string, targetDate: string | null) =>
			database.run(sql`update goals set target_date = ${targetDate} where id = ${id}`);

		await expect(date("g1", "2027-06-30")).resolves.toBeDefined();
		await expect(date("g2", null)).resolves.toBeDefined();
		await expect(date("g2", "2027-06-30")).rejects.toThrow();
	});

	it("gives every goal a fixed target when 0048 rebuilds goals, dropping a reserve's date", async () => {
		const before = await migratedBefore("0048");
		await insertAccount(before, "a1", "depository", "savings");
		await insertGoal(before, "g1", { state: "completed" });
		await before.run(
			sql`update goals set target_date = '2027-06-30', completed_amount = 45000, completed_at = 1790000000000`,
		);
		await insertGoal(before, "g2", { kind: "maintained" });
		await before.run(sql`update goals set target_date = '2027-01-01' where id = 'g2'`);
		await before.run(
			sql`insert into goal_accounts (goal_id, account_id, allocated_amount) values ('g1', 'a1', null)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, kind, target_amount as target, target_date as targetDate, target_mode as mode, target_months as months, completed_amount as completedAmount from goals order by id`,
			),
		).resolves.toEqual([
			{
				id: "g1",
				kind: "one_off",
				target: 100_000,
				targetDate: "2027-06-30",
				mode: "fixed",
				months: null,
				completedAmount: 45_000,
			},
			{
				id: "g2",
				kind: "maintained",
				target: 100_000,
				targetDate: null,
				mode: "fixed",
				months: null,
				completedAmount: null,
			},
		]);
		await expect(
			database.all(sql`select goal_id as goalId, allocated_amount as amount from goal_accounts`),
		).resolves.toEqual([{ goalId: "g1", amount: null }]);
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

describe("budgets", () => {
	it("keeps each amount and turns rollover off when 0041 adds it", async () => {
		const before = await migratedBefore("0041");
		await insertCategory(before, "c1", "Cadeaux");
		await before.run(
			sql`insert into budgets (id, month, currency, budgeted_spending, expected_income, created_at, updated_at) values ('b1', '2026-06', 'EUR', 100000, 0, 0, 0)`,
		);
		await before.run(
			sql`insert into budget_categories (id, budget_id, category_id, budgeted_spending, created_at, updated_at) values ('bc1', 'b1', 'c1', 10000, 0, 0)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select budgeted_spending as amount, rollover_enabled as enabled, rolled_over_amount as carried from budget_categories`,
			),
		).resolves.toEqual([{ amount: 10_000, enabled: 0, carried: 0 }]);
		await expect(
			database.run(sql`update budget_categories set rolled_over_amount = -1`),
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof Error &&
				String(error.cause).includes("budget_categories_rolled_over_check"),
		);
	});
});

describe("splits", () => {
	it("keeps every entry unsplit when 0042 adds the parent, and restricts deleting a parent", async () => {
		const before = await migratedBefore("0042");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select id, parent_entry_id as parentEntryId from entries`),
		).resolves.toEqual([{ id: "e1", parentEntryId: null }]);
		await insertEntry(database, "e2", "transaction", null);
		await database.run(sql`update entries set parent_entry_id = 'e1' where id = 'e2'`);
		await expect(
			database.run(sql`update entries set parent_entry_id = 'nope' where id = 'e2'`),
		).rejects.toThrow();
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
		await expect(
			database.all(
				sql`select name, partial from pragma_index_list('entries') where name = 'entries_parent_entry'`,
			),
		).resolves.toEqual([{ name: "entries_parent_entry", partial: 1 }]);
		await database.run(sql`delete from entries where id = 'e2'`);
		await database.run(sql`delete from entries where id = 'e1'`);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

describe("transaction attachments", () => {
	it("holds an allowed type's bytes per transaction, and restricts deleting the transaction", async () => {
		const before = await migratedBefore("0043");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e1", "transaction", null);
		await before.run(sql`insert into transactions (entry_id, label) values ('e1', 'Boulangerie')`);
		before.$client.close();

		const database = await migrated();
		const insertAttachment = (id: string, transactionId: string, contentType: string) =>
			database.run(
				sql`insert into transaction_attachments (id, transaction_id, filename, content_type, byte_size, content, created_at) values (${id}, ${transactionId}, 'ticket.png', ${contentType}, 4, ${Buffer.from("%PDF")}, 0)`,
			);

		await expect(insertAttachment("t1", "e1", "application/pdf")).resolves.toBeDefined();
		await expect(insertAttachment("t2", "e1", "text/html")).rejects.toThrow();
		await expect(insertAttachment("t3", "nope", "image/png")).rejects.toThrow();
		await expect(
			database.all(sql`select hex(content) as content from transaction_attachments`),
		).resolves.toEqual([{ content: "25504446" }]);
		await expect(
			database.all(
				sql`select name from pragma_index_list('transaction_attachments') where name = 'transaction_attachments_transaction'`,
			),
		).resolves.toHaveLength(1);
		await expect(
			database.run(sql`delete from transactions where entry_id = 'e1'`),
		).rejects.toThrow();
		await database.run(sql`delete from transaction_attachments where id = 't1'`);
		await database.run(sql`delete from transactions where entry_id = 'e1'`);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertSecurity = (
	database: Database,
	id: string,
	{
		ticker = "MC.PA",
		mic = "XPAR",
		provider = "yahoo",
	}: { ticker?: string | null; mic?: string | null; provider?: string | null } = {},
) =>
	database.run(
		sql`insert into securities (id, ticker, mic, name, currency, provider, created_at, updated_at) values (${id}, ${ticker}, ${mic}, 'LVMH', 'EUR', ${provider}, 0, 0)`,
	);

describe("securities", () => {
	it("holds one listing per ticker, whatever its case, and venue", async () => {
		const database = await migrated();

		await expect(insertSecurity(database, "s1")).resolves.toBeDefined();
		await expect(insertSecurity(database, "s2", { ticker: "mc.pa" })).rejects.toThrow();
		await expect(insertSecurity(database, "s3", { mic: "XAMS" })).resolves.toBeDefined();
		await expect(insertSecurity(database, "s4", { mic: null })).resolves.toBeDefined();
		await expect(insertSecurity(database, "s5", { mic: null })).rejects.toThrow();
		// Created offline, by ISIN and name: no ticker, and never a collision.
		await expect(
			insertSecurity(database, "s6", { ticker: null, mic: null, provider: null }),
		).resolves.toBeDefined();
		await expect(
			insertSecurity(database, "s7", { ticker: null, mic: null, provider: null }),
		).resolves.toBeDefined();
		await expect(
			insertSecurity(database, "s8", { ticker: "AI.PA", provider: "boursorama" }),
		).rejects.toThrow();
		await expect(
			database.all(
				sql`select offline, failed_fetch_count as count, first_price_on as first from securities where id = 's1'`,
			),
		).resolves.toEqual([{ offline: 0, count: 0, first: null }]);
		await expect(
			database.run(sql`update securities set failed_fetch_count = -1 where id = 's1'`),
		).rejects.toThrow();
	});

	it("holds one positive price per security and day, gone with its security", async () => {
		const database = await migrated();
		await insertSecurity(database, "s1");
		const price = (date: string, value: number, source = "provider") =>
			database.run(
				sql`insert into security_prices (security_id, date, price, currency, source) values ('s1', ${date}, ${value}, 'EUR', ${source})`,
			);

		await expect(price("2026-09-21", 612_400_000)).resolves.toBeDefined();
		await expect(price("2026-09-21", 612_500_000)).rejects.toThrow();
		await expect(price("2026-09-22", 0)).rejects.toThrow();
		await expect(price("2026-09-22", 1, "typed")).rejects.toThrow();
		await expect(price("2026-09-22", 1, "manual")).resolves.toBeDefined();
		await expect(
			database.all(sql`select provisional from security_prices where date = '2026-09-22'`),
		).resolves.toEqual([{ provisional: 0 }]);

		await database.run(sql`delete from securities where id = 's1'`);
		await expect(database.all(sql`select * from security_prices`)).resolves.toEqual([]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertTrade = (
	database: Database,
	entryId: string,
	{
		securityId = "s1",
		incomeKind = null,
		quantity = 10_000_000,
		price = 612_400_000,
		fee = 250,
	}: {
		securityId?: string | null;
		incomeKind?: string | null;
		quantity?: number;
		price?: number;
		fee?: number;
	} = {},
) =>
	database.run(
		sql`insert into trades (entry_id, security_id, income_kind, quantity, price, fee) values (${entryId}, ${securityId}, ${incomeKind}, ${quantity}, ${price}, ${fee})`,
	);

describe("trades", () => {
	it("keeps every entry, its links and its indexes when 0050 rebuilds entries for trades", async () => {
		const before = await migratedBefore("0050");
		await insertAccount(before, "a1", "depository", "checking");
		await insertEntry(before, "e0", "valuation", "opening_anchor", "2026-08-01");
		await insertEntry(before, "e1", "transaction", null);
		await insertEntry(before, "e2", "transaction", null);
		await before.run(sql`update entries set parent_entry_id = 'e1' where id = 'e2'`);
		await before.run(sql`insert into transactions (entry_id, label) values ('e1', 'Courses')`);
		await before.run(sql`insert into transactions (entry_id, label) values ('e2', 'Repas')`);
		await before.run(
			sql`insert into entry_keys (entry_id, account_id, source, key, import_id) values ('e1', 'a1', 'ofx', 'fp:1', null)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select id, kind, valuation_kind as valuationKind, parent_entry_id as parentEntryId from entries order by id`,
			),
		).resolves.toEqual([
			{ id: "e0", kind: "valuation", valuationKind: "opening_anchor", parentEntryId: null },
			{ id: "e1", kind: "transaction", valuationKind: null, parentEntryId: null },
			{ id: "e2", kind: "transaction", valuationKind: null, parentEntryId: "e1" },
		]);
		await expect(
			database.all(sql`select name from pragma_index_list('entries') order by name`),
		).resolves.toEqual(
			[
				"entries_account_date",
				"entries_import",
				"entries_kind_amount_date",
				"entries_kind_currency_amount",
				"entries_kind_date",
				"entries_one_opening_anchor",
				"entries_one_reconciliation_per_day",
				"entries_parent_entry",
				"sqlite_autoindex_entries_1",
			].map((name) => ({ name })),
		);
		// The references to the rebuilt table, its own parent included, still hold.
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
		await expect(
			database.run(sql`update entries set parent_entry_id = 'nope' where id = 'e2'`),
		).rejects.toThrow();
		await expect(insertEntry(database, "e3", "valuation", "opening_anchor")).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds a trade's row beside its entry, signed and never zero, and protects both ends", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "investment", "pea");
		await insertSecurity(database, "s1");

		await expect(insertEntry(database, "e1", "trade", null)).resolves.toBeDefined();
		await expect(insertEntry(database, "e2", "trade", "reconciliation")).rejects.toThrow();
		await expect(insertTrade(database, "e1")).resolves.toBeDefined();
		await expect(insertTrade(database, "e1")).rejects.toThrow();
		await insertEntry(database, "e3", "trade", null);
		await insertEntry(database, "e4", "trade", null);
		await insertEntry(database, "e5", "trade", null);
		await insertEntry(database, "e6", "trade", null);
		await expect(insertTrade(database, "e3", { quantity: 0 })).rejects.toThrow();
		await expect(insertTrade(database, "e3", { price: -1 })).rejects.toThrow();
		await expect(insertTrade(database, "e3", { fee: -1 })).rejects.toThrow();
		await expect(insertTrade(database, "e3", { securityId: "nope" })).rejects.toThrow();
		await expect(insertTrade(database, "nope")).rejects.toThrow();
		// A sale, a free share and no fee are all real trades.
		await expect(insertTrade(database, "e4", { quantity: -4_000_000 })).resolves.toBeDefined();
		await expect(insertTrade(database, "e5", { price: 0 })).resolves.toBeDefined();
		await expect(insertTrade(database, "e6", { fee: 0 })).resolves.toBeDefined();

		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
		await expect(database.run(sql`delete from securities where id = 's1'`)).rejects.toThrow();
		await expect(
			database.all(
				sql`select name from pragma_index_list('trades') where name = 'trades_security'`,
			),
		).resolves.toHaveLength(1);
		await database.run(sql`delete from trades where entry_id = 'e1'`);
		await database.run(sql`delete from entries where id = 'e1'`);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("keeps every trade a buy or a sale when 0053 rebuilds trades for income", async () => {
		const before = await migratedBefore("0053");
		await insertAccount(before, "a1", "investment", "pea");
		await insertSecurity(before, "s1");
		await insertEntry(before, "e1", "trade", null);
		await insertEntry(before, "e2", "trade", null);
		await before.run(
			sql`insert into trades (entry_id, security_id, quantity, price, fee) values ('e1', 's1', 10000000, 612400000, 250), ('e2', 's1', -4000000, 650000000, 0)`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(
				sql`select entry_id as entryId, security_id as securityId, income_kind as incomeKind, quantity, price, fee from trades order by entry_id`,
			),
		).resolves.toEqual([
			{
				entryId: "e1",
				securityId: "s1",
				incomeKind: null,
				quantity: 10_000_000,
				price: 612_400_000,
				fee: 250,
			},
			{
				entryId: "e2",
				securityId: "s1",
				incomeKind: null,
				quantity: -4_000_000,
				price: 650_000_000,
				fee: 0,
			},
		]);
		await expect(
			database.all(
				sql`select name from pragma_index_list('trades') where name = 'trades_security'`,
			),
		).resolves.toHaveLength(1);
		// Both ends still restrict.
		await expect(database.run(sql`delete from entries where id = 'e1'`)).rejects.toThrow();
		await expect(database.run(sql`delete from securities where id = 's1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds an income of quantity zero, price and fee zero, on a security or interest on cash", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "investment", "pea");
		await insertSecurity(database, "s1");

		await Promise.all(
			["e1", "e2", "e3", "e4"].map(async (id) => insertEntry(database, id, "trade", null)),
		);

		const income = { quantity: 0, price: 0, fee: 0 };

		await expect(
			insertTrade(database, "e1", { ...income, incomeKind: "dividend" }),
		).resolves.toBeDefined();
		await expect(
			insertTrade(database, "e2", { ...income, incomeKind: "interest", securityId: null }),
		).resolves.toBeDefined();
		await expect(
			insertTrade(database, "e3", { ...income, incomeKind: "interest" }),
		).resolves.toBeDefined();
		// A dividend is paid by a security; a buy or a sale is of one.
		await expect(
			insertTrade(database, "e4", { ...income, incomeKind: "dividend", securityId: null }),
		).rejects.toThrow();
		await expect(insertTrade(database, "e4", { securityId: null })).rejects.toThrow();
		// A buy of nothing, an income that moves a quantity, a price or a fee.
		await expect(insertTrade(database, "e4", { quantity: 0 })).rejects.toThrow();
		await expect(
			insertTrade(database, "e4", { ...income, incomeKind: "dividend", quantity: 1 }),
		).rejects.toThrow();
		await expect(
			insertTrade(database, "e4", { ...income, incomeKind: "dividend", price: 1 }),
		).rejects.toThrow();
		await expect(
			insertTrade(database, "e4", { ...income, incomeKind: "dividend", fee: 1 }),
		).rejects.toThrow();
		await expect(insertTrade(database, "e4", { ...income, incomeKind: "fee" })).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const insertHolding = (
	database: Database,
	{
		date = "2026-09-10",
		securityId = "s1",
		quantity = 10_000_000,
		price = 612_400_000,
		amount = 612_400,
		costBasis = 612_400_000,
	}: {
		date?: string;
		securityId?: string;
		quantity?: number;
		price?: number;
		amount?: number;
		costBasis?: number | null;
	} = {},
) =>
	database.run(
		sql`insert into holdings (account_id, security_id, date, quantity, price, amount, cost_basis) values ('a1', ${securityId}, ${date}, ${quantity}, ${price}, ${amount}, ${costBasis})`,
	);

describe("holdings", () => {
	it("fills every balance's cash from its balance when 0051 adds it", async () => {
		const before = await migratedBefore("0051");
		await insertAccount(before, "a1", "investment", "pea");
		await before.run(
			sql`insert into balances (account_id, date, balance, currency) values ('a1', '2026-09-01', 2500000, 'EUR'), ('a1', '2026-09-02', -1200, 'EUR')`,
		);
		before.$client.close();

		const database = await migrated();

		await expect(
			database.all(sql`select date, balance, cash from balances order by date`),
		).resolves.toEqual([
			{ date: "2026-09-01", balance: 2_500_000, cash: 2_500_000 },
			{ date: "2026-09-02", balance: -1200, cash: -1200 },
		]);
		await expect(
			database.run(
				sql`insert into balances (account_id, date, balance, currency) values ('a1', '2026-09-03', 1, 'EUR')`,
			),
		).rejects.toThrow();
		await expect(
			database.run(
				sql`insert into balances (account_id, date, balance, cash, currency) values ('a1', '2026-09-02', 1, 1, 'EUR')`,
			),
		).rejects.toThrow();
		await expect(database.run(sql`delete from accounts where id = 'a1'`)).rejects.toThrow();
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds one holding per account, day and security, never negative, and protects both ends", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "investment", "pea");
		await insertSecurity(database, "s1");
		await insertSecurity(database, "s2", { ticker: "AI.PA" });

		await expect(insertHolding(database)).resolves.toBeDefined();
		await expect(insertHolding(database)).rejects.toThrow();
		await expect(insertHolding(database, { securityId: "s2" })).resolves.toBeDefined();
		// A day after a full sale: nothing held, no cost basis, still a row.
		await expect(
			insertHolding(database, { date: "2026-09-11", quantity: 0, amount: 0, costBasis: null }),
		).resolves.toBeDefined();
		await expect(insertHolding(database, { date: "2026-09-12", quantity: -1 })).rejects.toThrow();
		await expect(insertHolding(database, { date: "2026-09-12", price: -1 })).rejects.toThrow();
		await expect(insertHolding(database, { date: "2026-09-12", amount: -1 })).rejects.toThrow();
		await expect(insertHolding(database, { securityId: "nope" })).rejects.toThrow();

		await expect(database.run(sql`delete from securities where id = 's1'`)).rejects.toThrow();
		await expect(database.run(sql`delete from accounts where id = 'a1'`)).rejects.toThrow();
		await database.run(sql`delete from holdings`);
		await database.run(sql`delete from accounts where id = 'a1'`);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});

	it("holds one cost basis lock per account and security, never negative, gone with its account", async () => {
		const database = await migrated();
		await insertAccount(database, "a1", "investment", "pea");
		await insertSecurity(database, "s1");
		await insertSecurity(database, "s2", { ticker: "AI.PA" });
		const lock = (securityId: string, costBasis: number) =>
			database.run(
				sql`insert into cost_basis_locks (account_id, security_id, cost_basis, locked_on) values ('a1', ${securityId}, ${costBasis}, '2026-09-21')`,
			);

		await expect(lock("s1", 40_000_000)).resolves.toBeDefined();
		await expect(lock("s1", 41_000_000)).rejects.toThrow();
		await expect(lock("nope", 1)).rejects.toThrow();
		await expect(lock("s2", -1)).rejects.toThrow();
		// A free share's cost basis is zero, still a lock.
		await expect(lock("s2", 0)).resolves.toBeDefined();
		await expect(database.run(sql`delete from securities where id = 's1'`)).rejects.toThrow();

		await database.run(sql`delete from accounts where id = 'a1'`);

		await expect(database.all(sql`select * from cost_basis_locks`)).resolves.toEqual([]);
		await expect(database.all(sql`select * from pragma_foreign_key_check`)).resolves.toEqual([]);
	});
});

const parseJson = (text: string): unknown => JSON.parse(text);

describe("loan terms", () => {
	it("moves a loan's rate to millionths and adds Sure's terms when 0058 runs, its end date kept", async () => {
		const before = await migratedBefore("0058");
		await before.run(
			sql`insert into accounts (id, name, type, subtype, currency, details, created_at, updated_at) values ('a1', 'A', 'loan', 'mortgage', 'EUR', '{"originalAmount":20000000,"interestRate":345,"endDate":"2045-12-05"}', 0, 0)`,
		);
		await before.run(
			sql`insert into accounts (id, name, type, subtype, currency, details, created_at, updated_at) values ('a2', 'A', 'loan', 'consumer', 'EUR', '{"originalAmount":null,"interestRate":null,"endDate":null}', 0, 0)`,
		);
		await insertAccount(before, "a3", "depository", "checking");
		// A loan linked to a bank has no details at all.
		await insertAccount(before, "a4", "loan", "mortgage");
		before.$client.close();

		const database = await migrated();
		const rows = await database.all<{ id: string; details: string | null }>(
			sql`select id, details from accounts order by id`,
		);
		const terms = {
			downPayment: null,
			startDate: null,
			termMonths: null,
			rateType: null,
			insuranceRate: null,
			insuranceRateType: null,
			rateChanges: [],
		};

		expect(
			rows.map((row) => ({
				id: row.id,
				details: row.details === null ? null : parseJson(row.details),
			})),
		).toEqual([
			{
				id: "a1",
				details: {
					originalAmount: 20000000,
					interestRate: 34500,
					endDate: "2045-12-05",
					...terms,
				},
			},
			{
				id: "a2",
				details: { originalAmount: null, interestRate: null, endDate: null, ...terms },
			},
			{ id: "a3", details: null },
			{ id: "a4", details: null },
		]);
	});
});
