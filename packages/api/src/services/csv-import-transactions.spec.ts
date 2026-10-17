import type { CsvImportRequest } from "./csv-import.ts";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Database } from "@archant/data/client";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import {
	openOwn,
	own,
	ownCategory,
	ownDatabase,
	recurringRows,
	sendOwn,
	useSignedInApp,
} from "../testing/app.ts";
import { importCsv, previewCsvImport } from "./csv-import.ts";

useSignedInApp();

// Story 30.4: Sure's `TransactionImport`. The clock is 2026-09-21 10:00 UTC.

function db(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const deps = () => ({ db: db(), timeZone: "Europe/Paris", logger: createLogger("silent") });

function request(
	text: string,
	choices: Pick<CsvImportRequest, "configuration" | "mappings"> = {},
): CsvImportRequest {
	return {
		type: "transactions",
		file: { name: "releve.csv", bytes: new TextEncoder().encode(text) },
		...choices,
	};
}

const preview = async (...args: Parameters<typeof request>) =>
	previewCsvImport(deps(), request(...args));

const publish = async (...args: Parameters<typeof request>) => importCsv(deps(), request(...args));

async function refusal(promise: Promise<unknown>) {
	const error: unknown = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);

	if (!(error instanceof AppError)) {
		throw new Error("The call did not fail with an AppError.");
	}

	return error;
}

const rows = <Row>(query: ReturnType<typeof sql>) => db().all<Row>(query);

/** Every transaction line, its account, category and tags by name. */
type Line = {
	account: string;
	date: string;
	amount: number;
	label: string;
	notes: string | null;
	category: string | null;
	tags: string | null;
};

const lines = async () =>
	rows<Line>(sql`select a.name as account, e.date, e.amount, t.label, t.notes,
			c.name as category,
			(select group_concat(g.name, '|') from (select tg.name from taggings tt
				join tags tg on tg.id = tt.tag_id where tt.transaction_id = e.id order by tg.name) g) as tags
		from entries e join transactions t on t.entry_id = e.id join accounts a on a.id = e.account_id
		left join categories c on c.id = t.category_id
		where e.kind = 'transaction' order by e.date, e.amount`);

const account = async (name = "Courant") => (await openOwn({ name })).id;

const columns = { date: "Date", amount: "Montant", name: "Libellé" } as const;

describe("configuration", () => {
	it("leaves every column empty, as Sure's form, and guesses the chosen date column's format", async () => {
		await ownDatabase();
		const accountId = await account();
		const file = [
			"Date,Montant,Libellé",
			"15/03/2026,-12.50,Boulangerie",
			"16/03/2026,20,Virement",
		].join("\n");
		const empty = await preview(file, { configuration: { accountId } });

		expect(empty.configuration.columns).toEqual({
			date: null,
			amount: null,
			currency: null,
			entity_type: null,
			name: null,
			category: null,
			tags: null,
			notes: null,
		});
		expect(empty.dates).toBeNull();

		const read = await preview(file, { configuration: { accountId, columns } });

		expect(read.configuration.dateFormat).toBe("%d/%m/%Y");
		expect(read.dates).toEqual({ detected: true, first: "2026-03-15" });
		expect(read.counts).toEqual({ transactions: 2, categories: 0, tags: 0 });
		expect(read.errors).toEqual([]);
	});

	it("offers Sure's two-digit year and says when no format reads the dates", async () => {
		await ownDatabase();
		const accountId = await account();
		const short = await preview(["Date,Montant", "15/03/26,1"].join("\n"), {
			configuration: { accountId, columns: { date: "Date", amount: "Montant" } },
		});

		expect(short.configuration.dateFormat).toBe("%d/%m/%y");
		expect(short.dates?.first).toBe("2026-03-15");

		const unread = await preview(["Date,Montant", "March 5th,1"].join("\n"), {
			configuration: { accountId, columns: { date: "Date", amount: "Montant" } },
		});

		expect(unread.configuration.dateFormat).toBe("%Y-%m-%d");
		expect(unread.dates).toEqual({ detected: false, first: null });
		expect(unread.errors).toEqual([
			{ code: "invalid_date", params: { line: "2", format: "YYYY-MM-DD" } },
		]);
	});

	it("skips the first lines as Sure's `rows_to_skip`, naming the file's own lines", async () => {
		await ownDatabase();
		const accountId = await account();
		const file = [
			"Compte courant n° 123",
			"Export du 21/09/2026",
			"Date,Montant",
			"2026-09-01,abc",
		].join("\n");
		const read = await preview(file, {
			configuration: { accountId, rowsToSkip: 2, columns: { date: "Date", amount: "Montant" } },
		});

		expect(read.headers).toEqual(["Date", "Montant"]);
		expect(read.errors).toEqual([
			{ code: "invalid_number", params: { line: "4", field: "amount" } },
		]);

		const error = await refusal(preview(file, { configuration: { accountId, rowsToSkip: 4 } }));

		expect(error.code).toBe("CSV_INVALID");
	});

	it("refuses an unknown account, and a type column without its value and treatment", async () => {
		await ownDatabase();

		expect(
			(await refusal(preview("Date,Montant\n2026-09-01,1", { configuration: { accountId: "x" } })))
				.code,
		).toBe("NOT_FOUND");

		const accountId = await account();
		const read = await preview("Date,Montant,Type\n2026-09-01,1,Credit", {
			configuration: {
				accountId,
				columns: { date: "Date", amount: "Montant", entity_type: "Type" },
				amountTypeStrategy: "custom_column",
			},
		});

		expect(read.errors).toEqual([{ code: "custom_column_requires_inflow", params: {} }]);
	});
});

describe("type column values", () => {
	it("lists the chosen type column's values in file order, a blank one included", async () => {
		await ownDatabase();
		const accountId = await account();
		const file = [
			"Date,Montant,Sens",
			"2026-09-01,1,Debit",
			"2026-09-02,1,Credit",
			"2026-09-03,1,",
			"2026-09-04,1,Debit",
		].join("\n");

		expect((await preview(file, { configuration: { accountId } })).typeValues).toEqual([]);
		expect(
			(await preview(file, { configuration: { accountId, columns: { entity_type: "Sens" } } }))
				.typeValues,
		).toEqual(["Debit", "Credit", ""]);
	});
});

describe("signs", () => {
	it("reads a signed amount, incomes positive or negative, into Archant's sign", async () => {
		await ownDatabase();
		const accountId = await account();
		const file = ["Date,Montant,Libellé", "2026-09-01,-30.00,Carte", "2026-09-02,100,Salaire"].join(
			"\n",
		);

		await publish(file, { configuration: { accountId, columns } });
		await publish(file.replaceAll("2026-09-0", "2026-08-0"), {
			configuration: { accountId, columns, signage: "inflows_negative" },
		});

		expect((await lines()).map(({ date, amount }) => [date, amount])).toEqual([
			["2026-08-01", 3000],
			["2026-08-02", -10000],
			["2026-09-01", -3000],
			["2026-09-02", 10000],
		]);
	});

	it("signs each row from a type column, as Sure's `apply_transaction_signage_convention`", async () => {
		await ownDatabase();
		const accountId = await account();
		const file = [
			"Date,Montant,Sens,Libellé",
			"2026-09-01,12.50,Credit,Remboursement",
			"2026-09-02,12.50,Debit,Pharmacie",
		].join("\n");
		const configuration = {
			accountId,
			columns: { ...columns, entity_type: "Sens" },
			amountTypeStrategy: "custom_column" as const,
			amountTypeIdentifier: "Credit",
		};

		await publish(file, {
			configuration: { ...configuration, amountTypeInflow: "inflows_positive" },
		});
		await publish(file.replaceAll("2026-09-0", "2026-08-0"), {
			configuration: {
				...configuration,
				amountTypeIdentifier: "Debit",
				amountTypeInflow: "inflows_negative",
			},
		});

		expect((await lines()).map(({ date, amount }) => [date, amount])).toEqual([
			["2026-08-01", 1250],
			["2026-08-02", -1250],
			["2026-09-01", 1250],
			["2026-09-02", -1250],
		]);
	});
});

describe("refusals", () => {
	it("refuses another currency than the account's, an unknown code and too many tags on their lines", async () => {
		await ownDatabase();
		const accountId = await account();
		const tags = Array.from({ length: 21 }, (_, index) => `t${index}`).join("|");
		const read = await preview(
			[
				"Date,Montant,Devise,Étiquettes",
				"2026-09-01,1,USD,",
				"2026-09-02,1,XYZ,",
				"2026-09-03,1,eur,",
				`2026-09-04,1,,${tags}`,
			].join("\n"),
			{
				configuration: {
					accountId,
					columns: { date: "Date", amount: "Montant", currency: "Devise", tags: "Étiquettes" },
				},
			},
		);

		expect(read.errors).toEqual([
			{ code: "CURRENCY_MISMATCH", params: { line: "2", currency: "USD", account: "EUR" } },
			{ code: "invalid_currency", params: { line: "3", value: "XYZ" } },
			{ code: "too_many_tags", params: { line: "5", max: "20" } },
		]);
		expect(
			(await refusal(publish("Date\n2026-09-01", { configuration: { accountId } }))).code,
		).toBe("CSV_IMPORT_INVALID");
	});
});

describe("mappings", () => {
	const file = [
		"date,amount,name,category,tags,account",
		"2026-09-01,-20,Jardinerie,Maison:Jardin,maison|été,Courant",
		"2026-09-02,-8,Café,Restaurants,,Livret",
		"2026-09-03,-5,Divers,,a\\|b,",
		"2026-09-04,-6,Kiosque,restaurants,,Courant",
	].join("\n");
	const all = {
		date: "date",
		amount: "amount",
		name: "name",
		category: "category",
		tags: "tags",
		account: "account",
	};

	it("preselects each value by name, else a new one, and refuses an account left unmapped", async () => {
		await ownDatabase();
		const courant = await account("Courant");
		const restaurants = await ownCategory("Restaurants");
		const read = await preview(file, { configuration: { columns: all } });

		expect(read.mappings.categories).toEqual([
			{ key: "", count: 1, value: null },
			{ key: "Maison:Jardin", count: 1, value: "internal_new_resource" },
			{ key: "Restaurants", count: 1, value: restaurants },
			{ key: "restaurants", count: 1, value: restaurants },
		]);
		expect(read.mappings.tags).toEqual([
			{ key: "", count: 2, value: null },
			{ key: "a|b", count: 1, value: "internal_new_resource" },
			{ key: "maison", count: 1, value: "internal_new_resource" },
			{ key: "été", count: 1, value: "internal_new_resource" },
		]);
		expect(read.mappings.accounts).toEqual([
			{ key: "", count: 1, value: null },
			{ key: "Courant", count: 2, value: courant },
			{ key: "Livret", count: 1, value: "internal_new_resource" },
		]);
		expect(read.counts).toEqual({ transactions: 4, categories: 1, tags: 3, accounts: 1 });
		expect(read.errors).toEqual([{ code: "unmapped_account", params: { key: "" } }]);
	});

	it("creates the mapped categories, tags and accounts, then each account's lines under an import of its own", async () => {
		await ownDatabase();
		const courant = await account("Courant");
		const restaurants = await ownCategory("Restaurants");
		const result = await publish(file, {
			configuration: { columns: all },
			mappings: { accounts: [{ key: "", value: courant }], tags: [{ key: "", value: null }] },
		});

		expect(result.counts).toEqual({ transactions: 4, categories: 1, tags: 3, accounts: 1 });
		expect(await lines()).toEqual([
			{
				account: "Courant",
				date: "2026-09-01",
				amount: -2000,
				label: "Jardinerie",
				notes: null,
				category: "Jardin",
				tags: "maison|été",
			},
			{
				account: "Livret",
				date: "2026-09-02",
				amount: -800,
				label: "Café",
				notes: null,
				category: "Restaurants",
				tags: null,
			},
			{
				account: "Courant",
				date: "2026-09-03",
				amount: -500,
				label: "Divers",
				notes: null,
				category: null,
				tags: "a|b",
			},
			{
				account: "Courant",
				date: "2026-09-04",
				amount: -600,
				label: "Kiosque",
				notes: null,
				category: "Restaurants",
				tags: null,
			},
		]);
		expect(
			await rows(sql`select c.name, p.name as parent from categories c
				join categories p on p.id = c.parent_id where c.name = 'Jardin'`),
		).toEqual([{ name: "Jardin", parent: "Maison" }]);
		expect(
			await rows(sql`select a.type, a.currency, e.date, e.amount from accounts a
				join entries e on e.account_id = a.id and e.valuation_kind = 'opening_anchor'
				where a.name = 'Livret'`),
		).toEqual([{ type: "depository", currency: "EUR", date: "2026-09-01", amount: 0 }]);
		expect(
			await rows(sql`select a.name, i.file_name, i.status, i.counts from imports i
				join accounts a on a.id = i.account_id order by a.name`),
		).toEqual([
			{
				name: "Courant",
				file_name: "releve.csv",
				status: "confirmed",
				counts: JSON.stringify({ created: 3, present: 0, matched: 0, duplicates: 0, rejected: 0 }),
			},
			{
				name: "Livret",
				file_name: "releve.csv",
				status: "confirmed",
				counts: JSON.stringify({ created: 1, present: 0, matched: 0, duplicates: 0, rejected: 0 }),
			},
		]);
		expect(restaurants).toBeTypeOf("string");

		const [imported] = await rows<{ id: string }>(sql`select i.id from imports i
			join accounts a on a.id = i.account_id where a.name = 'Courant'`);

		await sendOwn("POST", `/api/imports/${imported?.id ?? ""}/revert`);
		expect((await lines()).map(({ label }) => label)).toEqual(["Café"]);
	});

	it("creates one category and one tag for keys that differ by case alone, and reads `Maison:` as `Maison`", async () => {
		await ownDatabase();
		const accountId = await account();

		await publish(
			[
				"date,amount,category,tags",
				"2026-09-01,-1,Courses,Maison",
				"2026-09-02,-2,courses,maison",
				"2026-09-03,-3,Loisirs:,",
			].join("\n"),
			{
				configuration: {
					accountId,
					columns: { date: "date", amount: "amount", category: "category", tags: "tags" },
				},
			},
		);

		expect((await lines()).map(({ category, tags }) => [category, tags])).toEqual([
			["Courses", "Maison"],
			["Courses", "Maison"],
			["Loisirs", null],
		]);
	});

	it("detects recurring transactions once the lines are written", async () => {
		await ownDatabase();
		const accountId = await account();

		await publish(
			[
				"date,amount,name",
				"2026-07-05,-13.99,NETFLIX.COM",
				"2026-08-05,-13.99,NETFLIX.COM",
				"2026-09-05,-13.99,NETFLIX.COM",
			].join("\n"),
			{ configuration: { accountId, columns: { date: "date", amount: "amount", name: "name" } } },
		);

		expect(await recurringRows(db())).toEqual([
			expect.objectContaining({ accountId, amount: -1399, count: 3 }),
		]);
	});

	it("reads a multi-account line in its mapped account's currency, and folds account names", async () => {
		await ownDatabase();
		const dollars = (await openOwn({ name: "Dollars", currency: "USD" })).id;
		const foreign = [
			"date,amount,account,currency",
			"2026-09-01,-5,dollars,",
			"2026-09-02,-6,Dollars,EUR",
			"2026-09-03,-7,Épargne,",
			"2026-09-04,-8,épargne,",
		].join("\n");
		const configuration = {
			columns: { date: "date", amount: "amount", account: "account", currency: "currency" },
		};
		const read = await preview(foreign, { configuration });

		expect(read.mappings.accounts).toEqual([
			{ key: "Dollars", count: 1, value: dollars },
			{ key: "dollars", count: 1, value: dollars },
			{ key: "Épargne", count: 1, value: "internal_new_resource" },
			{ key: "épargne", count: 1, value: "internal_new_resource" },
		]);
		expect(read.errors).toEqual([
			{ code: "CURRENCY_MISMATCH", params: { line: "3", currency: "EUR", account: "USD" } },
		]);

		await publish(foreign.replace("2026-09-02,-6,Dollars,EUR\n", ""), { configuration });

		expect(
			await rows(sql`select a.name, e.currency, e.amount from entries e join accounts a on a.id = e.account_id
				where e.kind = 'transaction' order by e.date`),
		).toEqual([
			{ name: "Dollars", currency: "USD", amount: -500 },
			{ name: "Épargne", currency: "EUR", amount: -700 },
			{ name: "Épargne", currency: "EUR", amount: -800 },
		]);
		expect(await rows(sql`select count(*) as n from accounts where name = 'Épargne'`)).toEqual([
			{ n: 1 },
		]);
	});

	it("offers no account a bank feeds, and no new category for a key naming none", async () => {
		await ownDatabase();
		const linked = await account("Banque");
		const connectionId = crypto.randomUUID();
		const bankAccountId = crypto.randomUUID();

		await db().insert(bankConnections).values({
			id: connectionId,
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
		await db().insert(bankAccounts).values({
			id: bankAccountId,
			bankConnectionId: connectionId,
			identificationHash: "hash",
			providerUid: "uid",
			name: "Compte courant",
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		});
		await db().update(accounts).set({ bankAccountId }).where(eq(accounts.id, linked));

		const read = await preview(
			["date,amount,account,category", "2026-09-01,-5,Banque,:"].join("\n"),
			{
				configuration: {
					columns: { date: "date", amount: "amount", account: "account", category: "category" },
				},
				mappings: { accounts: [{ key: "Banque", value: linked }] },
			},
		);

		expect(read.mappings.accounts).toEqual([{ key: "Banque", count: 1, value: null }]);
		expect(read.mappings.categories).toEqual([{ key: ":", count: 1, value: null }]);
		expect(read.errors).toEqual([{ code: "unmapped_account", params: { key: "Banque" } }]);
	});

	it("names a blank label as Sure's default row name and keeps the row's notes", async () => {
		await ownDatabase();
		const accountId = await account();

		await publish(["Date,Montant,Notes", "2026-09-01,-3,Ticket 42"].join("\n"), {
			configuration: { accountId, columns: { date: "Date", amount: "Montant", notes: "Notes" } },
		});

		expect(await lines()).toEqual([
			expect.objectContaining({ label: "Opération importée", notes: "Ticket 42" }),
		]);
	});
});

describe("a line already present", () => {
	it("takes the row's category, tags and notes, a field the user locked staying", async () => {
		await ownDatabase();
		const accountId = await account();
		const food = await ownCategory("Alimentation");
		const shopping = await ownCategory("Shopping");
		const first = await sendOwn("POST", `/api/accounts/${accountId}/transactions`, {
			date: "2026-09-10",
			label: "Boulangerie",
			amount: "-4,20",
		});
		const second = z.object({ data: z.object({ id: z.string() }) }).parse(
			await sendOwn("POST", `/api/accounts/${accountId}/transactions`, {
				date: "2026-09-11",
				label: "Librairie",
				amount: "-15,00",
			}),
		).data.id;

		// Filed by hand: the user's category is locked (AD-10).
		await sendOwn("PATCH", `/api/transactions/${second}`, { categoryId: shopping });
		const file = [
			"Date,Montant,Libellé,Catégorie,Étiquettes,Notes",
			"2026-09-10,-4.20,BOULANGERIE PAUL,Alimentation,pain,Petit déjeuner",
			"2026-09-11,-15,LIBRAIRIE,Alimentation,,",
		].join("\n");
		const configuration = {
			accountId,
			columns: {
				...columns,
				name: "Libellé",
				category: "Catégorie",
				tags: "Étiquettes",
				notes: "Notes",
			},
		};

		expect(first).toBeDefined();
		expect(second).toBeDefined();
		await publish(file, { configuration });

		expect(await lines()).toEqual([
			{
				account: "Courant",
				date: "2026-09-10",
				amount: -420,
				label: "Boulangerie",
				notes: "Petit déjeuner",
				category: "Alimentation",
				tags: "pain",
			},
			{
				account: "Courant",
				date: "2026-09-11",
				amount: -1500,
				label: "Librairie",
				notes: null,
				category: "Shopping",
				tags: null,
			},
		]);
		expect(food).toBeTypeOf("string");

		// The same file again: every line is present, and nothing moves.
		await publish(file, { configuration });
		expect((await lines()).map(({ label }) => label)).toEqual(["Boulangerie", "Librairie"]);
	});
});
