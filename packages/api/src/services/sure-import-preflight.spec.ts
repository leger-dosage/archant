import type { TempDatabase } from "../testing/temp-database.ts";
import type { SureImportLimits } from "./sure-import-preflight.ts";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTempDatabase } from "../testing/temp-database.ts";
import { seedDefaults } from "./seed.ts";
import { readSureArchive } from "./sure-import-plan.ts";

let temp: TempDatabase;

beforeAll(async () => {
	temp = await createTempDatabase();
	await seedDefaults({ db: temp.db });
});

afterAll(async () => {
	await temp.dispose();
});

const LIMITS: SureImportLimits = { maxBytes: 10 * 1024 * 1024, maxRows: 100_000 };

const encode = (text: string) => new TextEncoder().encode(text);

const ndjson = (lines: readonly unknown[]) =>
	encode(lines.map((line) => JSON.stringify(line)).join("\n"));

async function read(lines: readonly unknown[], limits = LIMITS, name = "all.ndjson") {
	return readSureArchive(
		{ db: temp.db, timeZone: "Europe/Paris" },
		{ name, bytes: ndjson(lines) },
		limits,
	);
}

const checking = {
	type: "Account",
	data: {
		id: "a1",
		name: "Compte joint",
		balance: "1200.50",
		currency: "EUR",
		accountable_type: "Depository",
		subtype: "checking",
	},
};

const pea = {
	type: "Account",
	data: {
		id: "a2",
		name: "PEA",
		balance: "0",
		currency: "EUR",
		accountable_type: "Investment",
		accountable: { subtype: "pea" },
	},
};

const line = (type: string, data: Record<string, unknown>) => ({ type, data });

const transaction = (id: string, amount: string, splits: unknown) =>
	line("Transaction", { id, account_id: "a1", date: "2026-09-10", amount, split_lines: splits });

const series = (id: string, data: Record<string, unknown>) =>
	line("RecurringTransaction", {
		id,
		account_id: "a1",
		name: "Loyer",
		amount: "900",
		expected_day_of_month: 1,
		last_occurrence_date: "2026-09-01",
		next_expected_date: "2026-10-01",
		...data,
	});

const trade = (data: Record<string, unknown>) =>
	line("Trade", {
		account_id: "a2",
		date: "2026-09-10",
		amount: "100",
		qty: "1",
		price: "100",
		ticker: "MC.PA",
		...data,
	});

describe("the file", () => {
	it.each([
		["all.csv", "{}"],
		["all.ndjson", ""],
		["all.ndjson", "\n\n"],
		["all.ndjson", "hello"],
		["all.ndjson", JSON.stringify({ type: "Account" })],
		["all.ndjson", JSON.stringify([1, 2])],
	])("refuses %s holding %j as NDJSON_INVALID", async (name, text) => {
		await expect(
			readSureArchive(
				{ db: temp.db, timeZone: "Europe/Paris" },
				{ name, bytes: encode(text) },
				LIMITS,
			),
		).rejects.toMatchObject({ code: "NDJSON_INVALID" });
	});

	it("accepts a .json name and a first line after blank ones", async () => {
		const archive = await readSureArchive(
			{ db: temp.db, timeZone: "Europe/Paris" },
			{ name: "EXPORT.JSON", bytes: encode(`\n\n${JSON.stringify(checking)}\n`) },
			LIMITS,
		);

		expect(archive.errors).toEqual([]);
		expect(archive.counts.accounts).toBe(1);
	});

	it("refuses more lines carrying a type than SURE_IMPORT_MAX_ROWS, as Sure's MaxRowCountExceededError", async () => {
		await expect(
			read([checking, pea, line("Tag", { id: "t", name: "Vacances" })], {
				...LIMITS,
				maxRows: 2,
			}),
		).rejects.toMatchObject({ code: "IMPORT_TOO_MANY_ROWS", params: { max: "2" } });
	});

	it("refuses a file over the size limit unread", async () => {
		await expect(read([checking], { maxBytes: 10, maxRows: 10 })).rejects.toMatchObject({
			code: "IMPORT_FILE_TOO_LARGE",
		});
	});
});

describe("Sure's preflight", () => {
	it("counts each importable type as Sure's dry run", async () => {
		const archive = await read([
			checking,
			line("Balance", { account_id: "a1", date: "2026-09-01", balance: "1200.50" }),
			line("RecurrenceRule", { recurring_transaction_id: "r", frequency: "monthly" }),
		]);

		expect(archive.errors).toEqual([]);
		expect(archive.counts).toEqual({
			accounts: 1,
			balances: 1,
			categories: 0,
			tags: 0,
			merchants: 0,
			recurring_transactions: 0,
			transactions: 0,
			transfers: 0,
			rejected_transfers: 0,
			trades: 0,
			holdings: 0,
			valuations: 0,
			budgets: 0,
			budget_categories: 0,
			rules: 0,
		});
	});

	it("names each line it cannot read", async () => {
		const archive = await readSureArchive(
			{ db: temp.db, timeZone: "Europe/Paris" },
			{
				name: "all.ndjson",
				bytes: encode(
					[
						JSON.stringify(checking),
						"{not json",
						JSON.stringify([1]),
						JSON.stringify({ type: "Goal", data: {} }),
						JSON.stringify({ type: "Tag", data: "x" }),
					].join("\n"),
				),
			},
			LIMITS,
		);

		expect(archive.errors).toEqual([
			{ code: "invalid_json", params: { line: "2" } },
			{ code: "invalid_ndjson_record", params: { line: "3" } },
			{ code: "unsupported_record_type", params: { line: "4", type: "Goal" } },
			{ code: "invalid_ndjson_record", params: { line: "5" } },
		]);
	});

	it("reuses a name the household holds, case aside, and refuses one the file gives twice", async () => {
		const archive = await read([
			line("Category", { id: "c1", name: "courses" }),
			line("Category", { id: "c2", name: "Bricolage" }),
			line("Category", { id: "c3", name: "BRICOLAGE" }),
		]);

		expect(archive.warnings).toEqual([
			{
				code: "existing_taxonomy_collision",
				params: { line: "1", type: "Category", name: "courses" },
			},
		]);
		expect(archive.errors).toEqual([
			{
				code: "duplicate_taxonomy_name",
				params: { type: "Category", name: "Bricolage", lines: "2, 3" },
			},
		]);
	});

	it("refuses an id given twice, split lines in the transactions' namespace", async () => {
		const archive = await read([
			checking,
			line("Transaction", {
				id: "t1",
				account_id: "a1",
				date: "2026-09-10",
				amount: "10",
				split_lines: [
					{ id: "t2", amount: "4" },
					{ id: "s2", amount: "6" },
				],
			}),
			line("Transaction", { id: "t2", account_id: "a1", date: "2026-09-10", amount: "5" }),
		]);

		expect(archive.errors).toEqual([
			{ code: "duplicate_source_id", params: { kind: "transactions", id: "t2", lines: "2, 3" } },
		]);
	});

	it("refuses a line missing Sure's required fields", async () => {
		const archive = await read([
			checking,
			line("Transaction", { id: "t1", account_id: "a1", date: "", amount: "5" }),
		]);

		expect(archive.errors).toContainEqual({
			code: "missing_required_fields",
			params: { line: "2", type: "Transaction", fields: "date" },
		});
	});

	it("refuses split lines that are no array, no object, or do not add up, comparing decimals exactly", async () => {
		const archive = await read([
			checking,
			transaction("t1", "10", "nope"),
			transaction("t2", "10", [1]),
			transaction("t3", "10", [{ amount: "4" }, { amount: "5.99" }]),
			transaction("t4", "0.3", [{ amount: "0.1" }, { amount: "0.2" }]),
			transaction("t5", "10", [{ name: "Sans montant" }]),
		]);

		expect(archive.errors).toEqual(
			expect.arrayContaining([
				{ code: "invalid_split_lines", params: { line: "2" } },
				{ code: "invalid_split_line", params: { line: "3", index: "1" } },
				{ code: "split_amount_mismatch", params: { line: "4" } },
				{
					code: "missing_required_fields",
					params: { line: "6", type: "Transaction split line 1", fields: "amount" },
				},
			]),
		);
		expect(archive.errors.some((error) => error.params.line === "5")).toBe(false);
	});

	it("refuses a missing reference and warns of an advisory one", async () => {
		const archive = await read([
			checking,
			line("Category", { id: "c1", name: "Bricolage" }),
			line("Merchant", { id: "m1", name: "Leroy" }),
			line("Transaction", { id: "t1", account_id: "x", date: "2026-09-10", amount: "5" }),
			line("Transaction", {
				id: "t2",
				account_id: "a1",
				date: "2026-09-10",
				amount: "5",
				merchant_id: "gone",
				tag_ids: ["nope"],
			}),
			line("RejectedTransfer", { inflow_transaction_id: "t2", outflow_transaction_id: "lost" }),
			line("RecurringTransaction", {
				id: "r1",
				account_id: "a1",
				merchant_id: "gone",
				amount: "9.99",
				expected_day_of_month: 5,
				last_occurrence_date: "2026-09-05",
				next_expected_date: "2026-10-05",
			}),
		]);

		expect(archive.errors).toEqual([
			{
				code: "missing_reference",
				params: { line: "4", type: "Transaction", field: "account_id", value: '"x"' },
			},
			{
				code: "missing_reference",
				params: { line: "5", type: "Transaction", field: "tag_ids", value: '"nope"' },
			},
		]);
		expect(archive.warnings).toEqual([
			{
				code: "skipped_missing_merchant_reference",
				params: { line: "5", type: "Transaction", field: "merchant_id", value: '"gone"' },
			},
			{
				code: "skipped_missing_reference",
				params: {
					line: "6",
					type: "RejectedTransfer",
					field: "outflow_transaction_id",
					value: '"lost"',
				},
			},
			{
				code: "skipped_unnamed_recurring",
				params: { line: "7", type: "RecurringTransaction", field: "merchant_id", value: '"gone"' },
			},
		]);
		expect(archive.plan.recurring).toEqual([]);
		expect(archive.plan.transactions.map((row) => row.merchantSourceId)).toEqual([null]);
	});

	it("refuses two valuations of one account on one day", async () => {
		const archive = await read([
			checking,
			line("Valuation", { id: "v1", account_id: "a1", date: "2026-09-01", amount: "10" }),
			line("Valuation", { id: "v2", account_id: "a1", date: "2026-09-01", amount: "20" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "duplicate_valuation",
				params: { line: "3", account: '"a1"', date: "2026-09-01", first: "2" },
			},
		]);
	});
});

describe("Archant's refusals", () => {
	it.each([
		["accountable_type", { accountable_type: "Crypto2" }, '"Crypto2"'],
		["subtype", { subtype: "hsa" }, '"hsa"'],
		["subtype", { accountable_type: "Loan", subtype: null }, "null"],
		["currency", { currency: "XYZ" }, '"XYZ"'],
	])("refuses an account whose %s Archant lacks, naming its line", async (field, data, value) => {
		const archive = await read([
			line("Tag", { id: "t", name: "Vacances" }),
			{ type: "Account", data: { ...checking.data, ...data } },
		]);

		expect(archive.errors).toEqual([
			{ code: "invalid_import_record", params: { line: "2", type: "Account", field, value } },
		]);
	});

	it("reads Sure's credit card subtype as none, and Archant's own subtype back", async () => {
		const archive = await read([
			line("Account", {
				id: "c",
				name: "Carte",
				balance: "0",
				accountable_type: "CreditCard",
				accountable: { subtype: "credit_card" },
			}),
			line("Account", {
				id: "p",
				name: "Livret",
				balance: "0",
				accountable_type: "Depository",
				subtype: "savings",
				archant: { type: "depository", subtype: "savings" },
			}),
		]);

		expect(archive.errors).toEqual([]);
		expect(archive.plan.accounts.map(({ type, subtype }) => ({ type, subtype }))).toEqual([
			{ type: "credit_card", subtype: null },
			{ type: "depository", subtype: "savings" },
		]);
	});

	it("refuses an amount it cannot read without naming it", async () => {
		const archive = await read([
			checking,
			line("Transaction", { id: "t1", account_id: "a1", date: "2026-09-10", amount: "1e3" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "Transaction", field: "amount" },
			},
		]);
	});

	it("refuses an entry in another currency than its account's (AD-6)", async () => {
		const archive = await read([
			checking,
			line("Transaction", {
				id: "t1",
				account_id: "a1",
				date: "2026-09-10",
				amount: "5",
				currency: "USD",
			}),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "Transaction", field: "currency", value: '"USD"' },
			},
		]);
	});

	it("refuses a trade on an account that holds no security, and a quantity or a date it cannot read", async () => {
		const archive = await read([
			checking,
			pea,
			trade({ account_id: "a1" }),
			trade({ qty: "abc" }),
			trade({ date: "10/09/2026" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "3", type: "Trade", field: "account_id", value: '"a1"' },
			},
			{
				code: "invalid_import_record",
				params: { line: "4", type: "Trade", field: "qty", value: '"abc"' },
			},
			{
				code: "invalid_import_record",
				params: { line: "5", type: "Trade", field: "date", value: '"10/09/2026"' },
			},
		]);
	});

	it("reads Sure's sign reversed, rounding half away from zero, and Sure's opening balance fallback", async () => {
		const archive = await read([
			checking,
			line("Transaction", { id: "t1", account_id: "a1", date: "2026-09-10", amount: "42.905" }),
			line("Transaction", { id: "t2", account_id: "a1", date: "2026-09-12", amount: "-100" }),
			line("Trade", {
				account_id: "a2",
				date: "2026-09-11",
				amount: "612.40",
				qty: "1",
				price: "610",
				ticker: "MC.PA",
			}),
			line("Trade", {
				account_id: "a2",
				date: "2026-09-12",
				amount: "-3.20",
				qty: "0",
				price: "0",
				ticker: "MC.PA",
				investment_activity_label: "Dividend",
			}),
			pea,
		]);

		expect(archive.errors).toEqual([]);
		expect(archive.plan.transactions.map((row) => row.amount)).toEqual([-4291, 10000]);
		expect(archive.plan.accounts[0]?.opening).toEqual({ date: "2026-09-09", amount: 120050 });
		expect(
			archive.plan.trades.map(({ fee, amount, incomeKind }) => ({ fee, amount, incomeKind })),
		).toEqual([
			{ fee: 240, amount: -61240, incomeKind: null },
			{ fee: 0, amount: 320, incomeKind: "dividend" },
		]);
	});

	it("names an opening anchor it cannot read, and an id or a name that is no text", async () => {
		const archive = await read([
			checking,
			line("Valuation", {
				id: "v",
				account_id: "a1",
				date: "2026-02-30",
				amount: "1",
				kind: "opening_anchor",
			}),
			{ type: "Account", data: { ...pea.data, id: { nested: true } } },
			{ type: "Account", data: { ...pea.data, id: "a3", name: 42 } },
			{ type: "Account", data: { ...pea.data, id: "a4" } },
			line("Valuation", {
				id: "w",
				account_id: "a4",
				date: "2026-09-01",
				amount: "abc",
				kind: "opening_anchor",
			}),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "Valuation", field: "date", value: '"2026-02-30"' },
			},
			{
				code: "invalid_import_record",
				params: { line: "3", type: "Account", field: "id", value: '{"nested":true}' },
			},
			{
				code: "invalid_import_record",
				params: { line: "4", type: "Account", field: "name", value: "42" },
			},
			{
				code: "invalid_import_record",
				params: { line: "6", type: "Valuation", field: "amount" },
			},
		]);
	});

	it("refuses a recurring series in another currency than its account's, and reads a blank tolerance as none", async () => {
		const archive = await read([
			checking,
			series("r1", { currency: "USD" }),
			series("r2", { matcher_hints: { learned_tolerance_pct: null } }),
			series("r3", { matcher_hints: { learned_tolerance_pct: "" }, dedup_scope: "x" }),
			series("r4", { matcher_hints: { learned_tolerance_pct: "12.5" }, dedup_scope: "y" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "RecurringTransaction", field: "currency", value: '"USD"' },
			},
		]);
		expect(archive.plan.recurring.map((row) => row.learnedTolerance)).toEqual([null, null, 125]);
	});

	it("compares names trimmed, as the import writes them", async () => {
		const archive = await read([
			line("Category", { id: "c1", name: "Courses  " }),
			line("Tag", { id: "t1", name: "Vacances" }),
			line("Tag", { id: "t2", name: " vacances " }),
		]);

		expect(archive.warnings).toEqual([
			{
				code: "existing_taxonomy_collision",
				params: { line: "1", type: "Category", name: "Courses" },
			},
		]);
		expect(archive.errors).toEqual([
			{
				code: "duplicate_taxonomy_name",
				params: { type: "Tag", name: "Vacances", lines: "2, 3" },
			},
		]);
	});

	it("refuses a dividend on cash, which only a security pays", async () => {
		const archive = await read([
			checking,
			pea,
			trade({
				ticker: "CASH-A2",
				amount: "-3",
				qty: "0",
				price: "0",
				investment_activity_label: "Dividend",
			}),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "3", type: "Trade", field: "ticker", value: '"CASH-A2"' },
			},
		]);
	});

	it("refuses an accountable type a plain object would inherit", async () => {
		const archive = await read([
			{ type: "Account", data: { ...checking.data, accountable_type: "constructor" } },
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "1", type: "Account", field: "accountable_type", value: '"constructor"' },
			},
		]);
	});

	it("refuses an entry dated more than 366 days ahead, as a statement line", async () => {
		const archive = await read([
			checking,
			line("Transaction", { id: "t1", account_id: "a1", date: "9999-12-31", amount: "5" }),
			line("Valuation", { id: "v1", account_id: "a1", date: "2099-01-01", amount: "5" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "Transaction", field: "date", value: '"9999-12-31"' },
			},
			{
				code: "invalid_import_record",
				params: { line: "3", type: "Valuation", field: "date", value: '"2099-01-01"' },
			},
		]);
	});

	it("refuses a security held in two currencies, on the later line", async () => {
		const usd = {
			type: "Account",
			data: { ...pea.data, id: "a3", name: "PEA dollars", currency: "USD" },
		};
		const archive = await read([
			checking,
			pea,
			usd,
			trade({ exchange_operating_mic: "XPAR" }),
			trade({ account_id: "a3", currency: "USD", exchange_operating_mic: "XPAR" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "5", type: "Trade", field: "ticker", value: '"MC.PA"' },
			},
		]);
	});

	it("names a series' day or date it cannot read", async () => {
		const archive = await read([
			checking,
			series("r1", { expected_day_of_month: 32 }),
			series("r2", { next_expected_date: "demain" }),
		]);

		expect(archive.errors).toEqual([
			{
				code: "invalid_import_record",
				params: {
					line: "2",
					type: "RecurringTransaction",
					field: "expected_day_of_month",
					value: "32",
				},
			},
			{
				code: "invalid_import_record",
				params: {
					line: "3",
					type: "RecurringTransaction",
					field: "next_expected_date",
					value: '"demain"',
				},
			},
		]);
	});

	it("cuts a long label by code points, never splitting an emoji", async () => {
		const archive = await read([
			checking,
			line("Transaction", {
				id: "t1",
				account_id: "a1",
				date: "2026-09-10",
				amount: "5",
				name: `${"a".repeat(199)}😀😀`,
			}),
		]);

		expect(archive.plan.transactions[0]?.label).toBe(`${"a".repeat(199)}😀`);
	});

	it("refuses a file that is not UTF-8 as NDJSON_INVALID", async () => {
		const latin1 = Uint8Array.from([
			...encode('{"type":"Tag","data":{"id":"t","name":"'),
			0xe9,
			...encode("t"),
			...encode('"}}'),
		]);

		await expect(
			readSureArchive(
				{ db: temp.db, timeZone: "Europe/Paris" },
				{ name: "all.ndjson", bytes: latin1 },
				LIMITS,
			),
		).rejects.toMatchObject({ code: "NDJSON_INVALID" });
	});
});
