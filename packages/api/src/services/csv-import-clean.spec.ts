import type { CsvImportRequest } from "./csv-import.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Database } from "@archant/data/client";

import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { openOwn, own, ownDatabase, pea as peaAccount, useSignedInApp } from "../testing/app.ts";
import { importCsv, previewCsvImport } from "./csv-import.ts";

useSignedInApp();

// Story 30.5: Sure's « Nettoyer », `Import::CleansController` and
// `Import::RowsController#update`. The clock is 2026-09-21 10:00 UTC.

function db(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const deps = () => ({ db: db(), timeZone: "Europe/Paris", logger: createLogger("silent") });

function request(
	type: CsvImportRequest["type"],
	text: string,
	choices: Pick<CsvImportRequest, "configuration" | "edits" | "mappings"> = {},
): CsvImportRequest {
	return { type, file: { name: `${type}.csv`, bytes: new TextEncoder().encode(text) }, ...choices };
}

const preview = async (...args: Parameters<typeof request>) =>
	previewCsvImport(deps(), request(...args));

const publish = async (...args: Parameters<typeof request>) => importCsv(deps(), request(...args));

const transactions = [
	"Date,Montant,Libellé,Catégorie",
	"02/09/2026,-4.20,Boulangerie,Courses",
	"31/02/2026,-12.00,Cinéma,Sorties",
].join("\n");

const configuration = (accountId: string) => ({
	accountId,
	dateFormat: "%d/%m/%Y",
	columns: { date: "Date", amount: "Montant", name: "Libellé", category: "Catégorie" },
});

describe("rows", () => {
	it("shows Sure's `column_keys` in its order, each row's values and each refusal on its cell", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const read = await preview("transactions", transactions, {
			configuration: configuration(account),
		});

		expect(read.clean.columns).toEqual([
			"date",
			"amount",
			"name",
			"currency",
			"category",
			"tags",
			"notes",
		]);
		expect(read.clean.rows).toEqual([
			{
				line: 2,
				values: ["02/09/2026", "-4.20", "Boulangerie", "", "Courses", "", ""],
				issues: [],
			},
			{
				line: 3,
				values: ["31/02/2026", "-12.00", "Cinéma", "", "Sorties", "", ""],
				issues: [
					{
						column: 0,
						issue: { code: "invalid_date", params: { line: "3", format: "DD/MM/YYYY" } },
					},
				],
			},
		]);
	});

	it("places each refusal on the cell of its key, the account first in a multi-account file", async () => {
		await ownDatabase();
		const read = await preview(
			"transactions",
			["Compte,Date,Montant,Devise", "Courant,31/02/2026,abc,EUR", "Courant,01/09/2026,1,XYZ"].join(
				"\n",
			),
			{
				configuration: {
					dateFormat: "%d/%m/%Y",
					columns: { account: "Compte", date: "Date", amount: "Montant", currency: "Devise" },
				},
			},
		);

		expect(read.clean.columns.slice(0, 5)).toEqual([
			"account",
			"date",
			"amount",
			"name",
			"currency",
		]);
		expect(
			read.clean.rows.map((row) => row.issues.map(({ column, issue }) => [column, issue.code])),
		).toEqual([
			[
				[1, "invalid_date"],
				[2, "invalid_number"],
			],
			[[4, "invalid_currency"]],
		]);
	});

	it("names the account first for a multi-account file, as Sure's `column_keys`", async () => {
		await ownDatabase();
		const read = await preview("trades", "date,ticker,qty,price\n2026-09-01,AAPL,1,10");

		expect(read.clean.columns).toEqual([
			"account",
			"date",
			"ticker",
			"exchange_operating_mic",
			"currency",
			"qty",
			"price",
			"name",
		]);
	});

	it("places a refusal whose key the import does not show on the row's first cell", async () => {
		await ownDatabase();
		const read = await preview(
			"ynab",
			["Account,Date,Payee,Category,Memo,Outflow,Inflow", "Carte,09/01/2026,Café,,,abc,"].join(
				"\n",
			),
		);

		expect(read.clean.columns).toEqual(["date", "name", "category", "account", "notes"]);
		expect(read.clean.rows[0]?.issues).toEqual([
			{ column: 0, issue: { code: "invalid_number", params: { line: "2", field: "amount" } } },
		]);
	});
});

describe("edits", () => {
	it("reads an edited date instead of the file's, then publishes the corrected line", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const edits = [{ line: 3, key: "date" as const, value: "28/02/2026" }];
		const read = await preview("transactions", transactions, {
			configuration: configuration(account),
			edits,
		});

		expect(read.errors).toEqual([]);
		expect(read.clean.rows[1]).toEqual({
			line: 3,
			values: ["28/02/2026", "-12.00", "Cinéma", "", "Sorties", "", ""],
			issues: [],
		});

		await publish("transactions", transactions, {
			configuration: configuration(account),
			edits,
			mappings: { categories: [] },
		});

		expect(
			await db().all(sql`select e.date, e.amount, t.label from entries e
				join transactions t on t.entry_id = e.id order by e.date`),
		).toEqual([
			{ date: "2026-02-28", amount: -1200, label: "Cinéma" },
			{ date: "2026-09-02", amount: -420, label: "Boulangerie" },
		]);
	});

	it("refuses to publish while a row stays invalid", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const error: unknown = await publish("transactions", transactions, {
			configuration: configuration(account),
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(AppError);
		expect(error).toMatchObject({ code: "CSV_IMPORT_INVALID" });
	});

	it("maps and counts an edited category, as Sure's `update_and_sync`", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const read = await preview("transactions", transactions, {
			configuration: configuration(account),
			edits: [
				{ line: 3, key: "date", value: "28/02/2026" },
				{ line: 3, key: "category", value: "Courses" },
			],
		});

		expect(read.mappings.categories).toEqual([
			{ key: "Courses", count: 2, value: "internal_new_resource" },
		]);
		expect(read.counts).toEqual({ transactions: 2, categories: 1, tags: 0 });
	});

	it("keeps the last edit of a cell and ignores a key the import does not show", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const choices = {
			configuration: {
				...configuration(account),
				amountTypeStrategy: "custom_column" as const,
				amountTypeIdentifier: "x",
				amountTypeInflow: "inflows_positive" as const,
				columns: { ...configuration(account).columns, entity_type: "Libellé" },
			},
			edits: [
				{ line: 3, key: "date" as const, value: "01/01/2026" },
				{ line: 3, key: "date" as const, value: " 28/02/2026 " },
				{ line: 2, key: "entity_type" as const, value: "x" },
				{ line: 2, key: "account" as const, value: "Livret" },
			],
		};
		const read = await preview("transactions", transactions, choices);

		expect(read.clean.rows[1]?.values[0]).toBe("28/02/2026");
		expect(read.errors).toEqual([]);
		expect(read.mappings.accounts).toEqual([]);

		await publish("transactions", transactions, choices);

		// The type column is no cell of « Nettoyer »: line 2 is not marked by
		// « x », so its amount is negated as any unmarked row's.
		expect(
			await db().all(sql`select e.amount from entries e
				join transactions t on t.entry_id = e.id where t.label = 'Boulangerie'`),
		).toEqual([{ amount: 420 }]);
	});

	it("publishes a trade's edited quantity and a line whose edited currency lifts the mismatch", async () => {
		await ownDatabase();
		const pea = (await openOwn(peaAccount)).id;
		const trades = "date,ticker,qty,price\n2026-09-01,AIR,abc,100";
		const tradeEdits = [{ line: 2, key: "qty" as const, value: "3" }];

		expect(
			(await preview("trades", trades, { configuration: { accountId: pea } })).clean.rows[0]
				?.issues,
		).toMatchObject([{ column: 4, issue: { code: "invalid_number" } }]);
		await publish("trades", trades, { configuration: { accountId: pea }, edits: tradeEdits });
		expect(
			await db().all(
				sql`select t.quantity, e.amount from trades t join entries e on e.id = t.entry_id`,
			),
		).toEqual([{ quantity: "3", amount: -30_000 }]);

		const account = (await openOwn({ name: "Courant" })).id;
		const file = "Date,Montant,Libellé,Devise\n02/09/2026,-4.20,Pain,USD";
		const choices = {
			configuration: {
				accountId: account,
				dateFormat: "%d/%m/%Y",
				columns: { date: "Date", amount: "Montant", name: "Libellé", currency: "Devise" },
			},
		};

		expect((await preview("transactions", file, choices)).clean.rows[0]?.issues).toMatchObject([
			{ column: 3, issue: { code: "CURRENCY_MISMATCH" } },
		]);
		await publish("transactions", file, {
			...choices,
			edits: [{ line: 2, key: "currency", value: "EUR" }],
		});
		expect(
			await db().all(sql`select e.amount from entries e
				join transactions t on t.entry_id = e.id where t.label = 'Pain'`),
		).toEqual([{ amount: -420 }]);
	});

	it("maps an edited account type, as Sure's `AccountTypeMapping`", async () => {
		await ownDatabase();
		const read = await preview("accounts", "type,name,balance\nCompte,Courant,10", {
			edits: [{ line: 2, key: "entity_type", value: "Depository" }],
		});

		expect(read.mappings.accountTypes).toEqual([
			{ key: "Depository", count: 1, type: "depository", subtype: null },
		]);
		expect(read.errors).toEqual([]);
	});

	it("fixes a category its own parent through its parent cell", async () => {
		await ownDatabase();
		const file = "name,color,parent_category,lucide_icon\nBoucle,#27a644,Boucle,house";
		const before = await preview("categories", file);

		expect(before.clean.columns).toEqual([
			"name",
			"category_color",
			"category_parent",
			"category_icon",
		]);
		expect(before.clean.rows[0]?.issues).toEqual([
			{ column: 2, issue: { code: "own_parent", params: { line: "2", name: "Boucle" } } },
		]);

		const edits = [{ line: 2, key: "category_parent" as const, value: "" }];

		expect((await preview("categories", file, { edits })).errors).toEqual([]);
		await publish("categories", file, { edits });
		expect(
			await db().all(sql`select name, color, parent_id from categories where name = 'Boucle'`),
		).toEqual([{ name: "Boucle", color: "#27a644", parent_id: null }]);
	});

	it("reads a merchant's edited name", async () => {
		await ownDatabase();
		const read = await preview("merchants", "name,color,website_url\nCafé,,https://cafe.test", {
			edits: [{ line: 2, key: "name", value: "Café du coin" }],
		});

		expect(read.clean.rows).toEqual([
			{ line: 2, values: ["Café du coin", "", "https://cafe.test"], issues: [] },
		]);

		await publish("merchants", "name,color,website_url\nCafé,,https://cafe.test", {
			edits: [{ line: 2, key: "name", value: "Café du coin" }],
		});
		expect(await db().all(sql`select name from merchants`)).toEqual([{ name: "Café du coin" }]);
	});

	it("takes an edited Actual category as the key, unjoined, and an edited YNAB name as the label", async () => {
		await ownDatabase();
		const actual = await preview(
			"actual",
			[
				"Account,Date,Payee,Notes,Category_Group,Category,Amount",
				"Courant,2026-09-01,Café,,Sorties,Cafés,-4.20",
			].join("\n"),
			{ edits: [{ line: 2, key: "category", value: "Loisirs" }] },
		);

		expect(actual.clean.rows[0]?.values).toEqual([
			"2026-09-01",
			"-4.20",
			"Café",
			"Loisirs",
			"Courant",
			"",
		]);
		expect(actual.mappings.categories.map(({ key }) => key)).toEqual(["Loisirs"]);

		const ynab = await preview(
			"ynab",
			[
				"Account,Date,Payee,Category,Memo,Outflow,Inflow",
				"Carte,09/01/2026,,Cafés,Petit déjeuner,4.20,",
			].join("\n"),
		);

		expect(ynab.clean.rows[0]?.values[1]).toBe("Petit déjeuner");

		const renamed = await preview(
			"ynab",
			[
				"Account,Date,Payee,Category,Memo,Outflow,Inflow",
				"Carte,09/01/2026,,Cafés,Petit déjeuner,4.20,",
			].join("\n"),
			{ edits: [{ line: 2, key: "name", value: "Boulangerie" }] },
		);

		expect(renamed.clean.rows[0]?.values).toEqual([
			"09/01/2026",
			"Boulangerie",
			"Cafés",
			"Carte",
			"Petit déjeuner",
		]);
	});

	it("reads a rule's edited resource type, its refusal on that cell before", async () => {
		await ownDatabase();
		const action = '"[{""action_type"":""exclude_transaction""}]"';
		const conditions =
			'"[{""condition_type"":""transaction_name"",""operator"":""like"",""value"":""x""}]"';
		const file = [
			"name,resource_type,active,effective_date,conditions,actions",
			`Règle,account,true,,${conditions},${action}`,
		].join("\n");
		const before = await preview("rules", file);

		expect(before.clean.rows[0]).toMatchObject({
			values: [
				"Règle",
				"account",
				"true",
				"",
				'[{"condition_type":"transaction_name","operator":"like","value":"x"}]',
				'[{"action_type":"exclude_transaction"}]',
			],
			issues: [
				{
					column: 1,
					issue: { code: "unsupported_resource_type", params: { resource_type: "account" } },
				},
			],
		});

		const broken = await preview(
			"rules",
			[
				"name,resource_type,active,effective_date,conditions,actions",
				`Règle,transaction,true,,${conditions},"[{"`,
			].join("\n"),
		);

		expect(broken.clean.rows[0]?.issues).toMatchObject([
			{ column: 5, issue: { code: "invalid_json", params: { field: "actions" } } },
		]);

		const after = await preview("rules", file, {
			edits: [{ line: 2, key: "resource_type", value: "transaction" }],
		});

		expect(after.errors).toEqual([]);
	});
});
