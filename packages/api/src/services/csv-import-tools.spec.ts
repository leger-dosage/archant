import type { ToolImportType } from "../schemas/csv-imports.ts";
import type { CsvImportRequest } from "./csv-import.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Database } from "@archant/data/client";

import { createLogger } from "../lib/logger.ts";
import { openOwn, own, ownDatabase, useSignedInApp } from "../testing/app.ts";
import { importCsv, previewCsvImport } from "./csv-import.ts";

useSignedInApp();

// Story 30.2: Sure's `MintImport`, `YnabImport` and `ActualImport`, their
// columns preset, each publishing through Story 30.4's mappings. The clock is
// 2026-09-21 10:00 UTC.

function db(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const deps = () => ({ db: db(), timeZone: "Europe/Paris", logger: createLogger("silent") });

function request(
	type: ToolImportType,
	lines: readonly string[],
	choices: Pick<CsvImportRequest, "configuration" | "mappings"> = {},
): CsvImportRequest {
	return {
		type,
		file: { name: `${type}.csv`, bytes: new TextEncoder().encode(lines.join("\n")) },
		...choices,
	};
}

const preview = async (...args: Parameters<typeof request>) =>
	previewCsvImport(deps(), request(...args));

const publish = async (...args: Parameters<typeof request>) => importCsv(deps(), request(...args));

/** Every transaction line, its account, its category and the category's parent by name. */
type Line = {
	account: string;
	currency: string;
	date: string;
	amount: number;
	label: string;
	notes: string | null;
	category: string | null;
	parent: string | null;
	tags: string | null;
};

const lines = async () =>
	db().all<Line>(sql`select a.name as account, a.currency, e.date, e.amount, t.label, t.notes,
			c.name as category, p.name as parent,
			(select group_concat(g.name, '|') from (select tg.name from taggings tt
				join tags tg on tg.id = tt.tag_id where tt.transaction_id = e.id order by tg.name) g) as tags
		from entries e join transactions t on t.entry_id = e.id join accounts a on a.id = e.account_id
		left join categories c on c.id = t.category_id
		left join categories p on p.id = c.parent_id
		where e.kind = 'transaction' order by e.date, e.amount`);

const checking = async () => (await openOwn({ name: "Checking", openingDate: "2025-12-01" })).id;

describe("Mint", () => {
	const file = [
		"Date,Description,Original Description,Amount,Transaction Type,Category,Account Name,Labels,Notes",
		"01/15/2026,Starbucks,STARBUCKS #123,8.55,debit,Food & Drink,Checking,Coffee|Breakfast,Morning coffee",
		'04/15/2026,Paycheck,ACME PAYROLL,"2,000.00",credit,Income,Savings,,Bi-weekly salary',
	];

	it("presets Sure's `DEFAULT_COLUMN_MAPPINGS`, a column the file lacks left empty", async () => {
		await ownDatabase();
		await checking();
		const read = await preview("mint", file);

		expect(read.configuration).toMatchObject({
			dateFormat: "%m/%d/%Y",
			signage: "inflows_positive",
			amountTypeStrategy: "signed_amount",
			accountId: null,
			columns: {
				date: "Date",
				amount: "Amount",
				currency: null,
				account: "Account Name",
				name: "Description",
				category: "Category",
				tags: "Labels",
				notes: "Notes",
			},
		});
		expect(read.dates).toEqual({ detected: true, first: "2026-01-15" });
		expect(read.counts).toEqual({ transactions: 2, categories: 2, tags: 2, accounts: 1 });
		expect(read.errors).toEqual([]);
	});

	it("signs a line from `Transaction Type`, a credit as income, and files it with its tags", async () => {
		await ownDatabase();
		await checking();
		await publish("mint", file);

		expect(await lines()).toEqual([
			{
				account: "Checking",
				currency: "EUR",
				date: "2026-01-15",
				amount: -855,
				label: "Starbucks",
				notes: "Morning coffee",
				category: "Food & Drink",
				parent: null,
				tags: "Breakfast|Coffee",
			},
			{
				account: "Savings",
				currency: "EUR",
				date: "2026-04-15",
				amount: 200_000,
				label: "Paycheck",
				notes: "Bi-weekly salary",
				category: "Income",
				parent: null,
				tags: null,
			},
		]);
	});

	it("reads incomes as negative when the convention says so", async () => {
		await ownDatabase();
		await checking();
		await publish("mint", file, { configuration: { signage: "inflows_negative" } });

		expect((await lines()).map((line) => line.amount)).toEqual([855, -200_000]);
	});

	it("keeps signing from `Transaction Type` when a type column is sent, and reads its currency column", async () => {
		await ownDatabase();
		await openOwn({ name: "Checking", openingDate: "2025-12-01", currency: "USD" });
		const read = await preview(
			"mint",
			[
				"Date,Description,Amount,Transaction Type,Account Name,Currency",
				"01/15/2026,Starbucks,8.55,debit,Checking,EUR",
			],
			{
				configuration: {
					amountTypeStrategy: "custom_column",
					amountTypeIdentifier: "debit",
					amountTypeInflow: "inflows_positive",
				},
			},
		);

		expect(read.configuration.amountTypeStrategy).toBe("signed_amount");
		expect(read.configuration.columns.currency).toBe("Currency");
		expect(read.errors).toEqual([
			{ code: "CURRENCY_MISMATCH", params: { line: "2", currency: "EUR", account: "USD" } },
		]);
	});
});

describe("YNAB", () => {
	const file = [
		"Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared",
		'Checking,,01/01/2026,Employer,Income: Paycheck,Income,Paycheck,Monthly salary,$0.00,"$2,500.00",Cleared',
		"Credit Card,,01/03/2026,Coffee Shop,Dining Out: Coffee,Dining Out,Coffee,Morning coffee,$4.25,$0.00,Uncleared",
		"Checking,,01/04/2026,,,,,Starting Balance,,$100.00,Cleared",
	];

	it("presets its columns and maps categories and accounts only", async () => {
		await ownDatabase();
		await checking();
		const read = await preview("ynab", file);

		expect(read.configuration).toMatchObject({
			dateFormat: "%m/%d/%Y",
			accountId: null,
			columns: {
				date: "Date",
				account: "Account",
				name: "Payee",
				category: "Category",
				notes: "Memo",
			},
		});
		expect(read.mappings.categories.map(({ key }) => key)).toEqual([
			"",
			"Dining Out: Coffee",
			"Income: Paycheck",
		]);
		expect(read.counts).toEqual({ transactions: 3, categories: 2, tags: 0, accounts: 1 });
		expect(read.errors).toEqual([]);
	});

	it("reads Inflow minus Outflow, files each category under its group and names a blank payee by its memo", async () => {
		await ownDatabase();
		await checking();
		await publish("ynab", file);

		expect(await lines()).toEqual([
			{
				account: "Checking",
				currency: "EUR",
				date: "2026-01-01",
				amount: 250_000,
				label: "Employer",
				notes: "Monthly salary",
				category: "Paycheck",
				parent: "Income",
				tags: null,
			},
			{
				account: "Credit Card",
				currency: "EUR",
				date: "2026-01-03",
				amount: -425,
				label: "Coffee Shop",
				notes: "Morning coffee",
				category: "Coffee",
				parent: "Dining Out",
				tags: null,
			},
			{
				account: "Checking",
				currency: "EUR",
				date: "2026-01-04",
				amount: 10_000,
				label: "Starting Balance",
				notes: "Starting Balance",
				category: null,
				parent: null,
				tags: null,
			},
		]);
	});

	it("prefers a signed `Amount`, joins YNAB 4's master and sub categories, and reads the number format", async () => {
		await ownDatabase();
		await checking();
		await publish(
			"ynab",
			[
				"Account,Date,Payee,Master Category,Sub Category,Memo,Amount,Outflow,Inflow",
				'Checking,02/01/2026,Boulangerie,Courses,Pain,,"-1 234,50","9,99",',
			],
			{ configuration: { numberFormat: "1 234,56" } },
		);

		expect(await lines()).toMatchObject([
			{ amount: -123_450, label: "Boulangerie", category: "Pain", parent: "Courses" },
		]);
	});

	it("refuses a line without any amount column, and an unreadable side", async () => {
		await ownDatabase();
		await checking();
		const none = await preview("ynab", ["Account,Date,Payee", "Checking,01/01/2026,Café"]);

		expect(none.errors).toEqual([{ code: "required", params: { line: "2", field: "amount" } }]);

		const unreadable = await preview("ynab", [
			"Account,Date,Payee,Outflow,Inflow",
			"Checking,01/01/2026,Café,abc,",
		]);

		expect(unreadable.errors).toEqual([
			{ code: "invalid_number", params: { line: "2", field: "amount" } },
		]);

		const both = await preview("ynab", [
			"Account,Date,Payee,Outflow,Inflow",
			"Checking,01/01/2026,Café,abc,def",
		]);

		expect(both.errors).toEqual([
			{ code: "invalid_number", params: { line: "2", field: "amount" } },
		]);
	});

	it("counts a negative Outflow as money out, joins `Category Group` to `Category`, and ignores a convention sent", async () => {
		await ownDatabase();
		await checking();
		await publish(
			"ynab",
			[
				"Account,Date,Payee,Category Group,Category,Memo,Outflow,Inflow",
				"Checking,01/03/2026,Coffee Shop,Dining Out,Coffee,,-4.25,",
				"Checking,01/04/2026,Employer,Income,,,,100.00",
			],
			{ configuration: { signage: "inflows_negative" } },
		);

		expect(await lines()).toMatchObject([
			{ amount: -425, category: "Coffee", parent: "Dining Out" },
			{ amount: 10_000, category: "Income", parent: null },
		]);
	});
});

describe("choices over the presets", () => {
	it("reads a date format and a column the user chose instead of the preset, headers found whatever their case", async () => {
		await ownDatabase();
		await checking();
		const file = [
			"account,date,payee,original description,outflow,inflow",
			"Checking,15/01/2026,Café,CAFE DU COIN,3.10,",
		];
		const read = await preview("ynab", file, {
			configuration: { dateFormat: "%d/%m/%Y", columns: { name: "original description" } },
		});

		expect(read.configuration).toMatchObject({
			dateFormat: "%d/%m/%Y",
			amountTypeIdentifier: null,
			columns: { date: "date", account: "account", name: "original description" },
		});

		await publish("ynab", file, {
			configuration: { dateFormat: "%d/%m/%Y", columns: { name: "original description" } },
		});

		expect(await lines()).toMatchObject([
			{ date: "2026-01-15", amount: -310, label: "CAFE DU COIN" },
		]);
	});

	it("writes a tool's file published twice once, as any import", async () => {
		await ownDatabase();
		await checking();
		const file = [
			"Account,Date,Payee,Notes,Category,Amount",
			"Checking,2026-01-03,Coffee Shop,,Coffee,-4.25",
		];

		await publish("actual", file);
		await publish("actual", file);

		expect(await lines()).toMatchObject([{ amount: -425, label: "Coffee Shop" }]);
	});

	it("reads Actual's incomes as negative when the convention says so", async () => {
		await ownDatabase();
		await checking();
		await publish(
			"actual",
			["Account,Date,Payee,Amount", "Checking,2026-01-03,Remboursement,-4.25"],
			{
				configuration: { signage: "inflows_negative" },
			},
		);

		expect(await lines()).toMatchObject([{ amount: 425 }]);
	});
});

describe("Actual", () => {
	const file = [
		"Account,Date,Payee,Notes,Category_Group,Category,Amount,Split_Amount,Cleared",
		"Checking,2026-01-01,Employer,Monthly salary,Income,Paycheck,2500.00,0,Reconciled",
		"Credit Card,2026-01-03,Coffee Shop,Morning coffee,Food,Coffee,-4.25,0,Cleared",
		"Checking,2026-01-05,,Reconciliation balance adjustment,,,12.00,0,Reconciled",
	];

	it("presets its columns, dates as `%Y-%m-%d`", async () => {
		await ownDatabase();
		await checking();
		const read = await preview("actual", file);

		expect(read.configuration).toMatchObject({
			dateFormat: "%Y-%m-%d",
			signage: "inflows_positive",
			columns: {
				date: "Date",
				amount: "Amount",
				account: "Account",
				name: "Payee",
				category: "Category",
				notes: "Notes",
			},
		});
		expect(read.errors).toEqual([]);
	});

	it("reads the amount as written, incomes positive, and joins the category group", async () => {
		await ownDatabase();
		await checking();
		await publish("actual", file);

		expect(await lines()).toEqual([
			{
				account: "Checking",
				currency: "EUR",
				date: "2026-01-01",
				amount: 250_000,
				label: "Employer",
				notes: "Monthly salary",
				category: "Paycheck",
				parent: "Income",
				tags: null,
			},
			{
				account: "Credit Card",
				currency: "EUR",
				date: "2026-01-03",
				amount: -425,
				label: "Coffee Shop",
				notes: "Morning coffee",
				category: "Coffee",
				parent: "Food",
				tags: null,
			},
			{
				account: "Checking",
				currency: "EUR",
				date: "2026-01-05",
				amount: 1200,
				label: "Reconciliation balance adjustment",
				notes: "Reconciliation balance adjustment",
				category: null,
				parent: null,
				tags: null,
			},
		]);
	});
});
