import type { CsvImportRequest } from "./csv-import.ts";

import { sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Database } from "@archant/data/client";

import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { MAX_CSV_BYTES } from "../schemas/csv-imports.ts";
import { openOwn, own, ownCategory, ownDatabase, sendOwn, useSignedInApp } from "../testing/app.ts";
import { importCsv, previewCsvImport } from "./csv-import.ts";
import { exportArchive } from "./export.ts";
import { seedDefaults } from "./seed.ts";

useSignedInApp();

// The clock is 2026-09-21 10:00 UTC, noon in Europe/Paris.

function db(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const logger = createLogger("silent");
const deps = () => ({ db: db(), timeZone: "Europe/Paris", logger });

function request(
	type: CsvImportRequest["type"],
	text: string,
	choices: Pick<CsvImportRequest, "configuration" | "mappings"> = {},
): CsvImportRequest {
	return { type, file: { name: `${type}.csv`, bytes: new TextEncoder().encode(text) }, ...choices };
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

/** One of the export's CSV files, as the test's own database writes it. */
async function exported(name: string): Promise<string> {
	const archive = exportArchive({ db: db(), timeZone: "Europe/Paris", logger });
	const files = unzipSync(new Uint8Array(await new Response(archive.body).arrayBuffer()));
	const bytes = files[name];

	if (bytes === undefined) {
		throw new Error(`The archive has no ${name}.`);
	}

	return new TextDecoder().decode(bytes);
}

const rows = <Row>(query: ReturnType<typeof sql>) => db().all<Row>(query);

describe("accounts", () => {
	const file = [
		"Account type*,Name*,Balance*,Currency,Balance Date",
		"Checking,Main,1000.00,EUR,2024-01-01",
		"Loan,Crédit,15000.50,,",
	].join("\n");

	it("preselects the columns by header, Sure's aliases included, and the date format", async () => {
		await ownDatabase();
		const read = await preview("accounts", file);

		expect(read.headers).toEqual([
			"Account type*",
			"Name*",
			"Balance*",
			"Currency",
			"Balance Date",
		]);
		expect(read.sample).toEqual([
			["Checking", "Main", "1000.00", "EUR", "2024-01-01"],
			["Loan", "Crédit", "15000.50", "", ""],
		]);
		expect(read.configuration).toMatchObject({
			separator: ",",
			numberFormat: "1,234.56",
			dateFormat: "%Y-%m-%d",
			columns: {
				entity_type: "Account type*",
				name: "Name*",
				amount: "Balance*",
				currency: "Currency",
				date: null,
			},
		});
		expect(read.counts).toEqual({ accounts: 2 });
	});

	it("maps each type value, a Sure class preselected, a loan waiting for its subtype", async () => {
		await ownDatabase();
		const read = await preview("accounts", file, {
			configuration: { columns: { date: "Balance Date" } },
		});

		expect(read.dates).toEqual({ detected: true, first: "2024-01-01" });
		expect(read.mappings.accountTypes).toEqual([
			{ key: "Checking", count: 1, type: null, subtype: null },
			{ key: "Loan", count: 1, type: "loan", subtype: null },
		]);
		expect(read.errors).toEqual([
			{ code: "unmapped_account_type", params: { key: "Checking" } },
			{ code: "unmapped_account_type", params: { key: "Loan" } },
		]);
		await expect(refusal(publish("accounts", file))).resolves.toMatchObject({
			code: "CSV_IMPORT_INVALID",
		});
		expect(await rows(sql`select id from accounts where name = 'Main'`)).toEqual([]);
	});

	it("creates each account with its balance as its opening anchor, two years back without a date", async () => {
		await ownDatabase();
		const result = await publish("accounts", file, {
			configuration: { columns: { date: "Balance Date" } },
			mappings: {
				accountTypes: [
					{ key: "Checking", type: "depository", subtype: "checking" },
					{ key: "Loan", type: "loan", subtype: "mortgage" },
				],
			},
		});

		expect(result.counts).toEqual({ accounts: 2 });
		expect(
			await rows(sql`select a.name, a.type, a.subtype, a.currency, e.date, e.amount
				from accounts a join entries e on e.account_id = a.id and e.valuation_kind = 'opening_anchor'
				order by a.name`),
		).toEqual([
			{
				name: "Crédit",
				type: "loan",
				subtype: "mortgage",
				currency: "EUR",
				date: "2024-09-21",
				amount: 1500050,
			},
			{
				name: "Main",
				type: "depository",
				subtype: "checking",
				currency: "EUR",
				date: "2024-01-01",
				amount: 100000,
			},
		]);
	});

	it("reads French numbers and refuses each bad cell on its line", async () => {
		await ownDatabase();
		const read = await preview(
			"accounts",
			[
				"type;name;balance;currency;date",
				"depository;Livret;1 234,56;EUR;2024-01-01",
				"depository;;abc;XYZ;2024-13-01",
				"depository;Futur;1;EUR;2026-09-22",
			].join("\n"),
			{
				configuration: {
					separator: ";",
					numberFormat: "1 234,56",
					dateFormat: "%Y-%m-%d",
				},
			},
		);

		expect(read.errors).toEqual([
			{ code: "invalid_currency", params: { line: "3", value: "XYZ" } },
			{ code: "invalid_number", params: { line: "3", field: "amount" } },
			{ code: "invalid_date", params: { line: "3", format: "YYYY-MM-DD" } },
			{ code: "required", params: { line: "3", field: "name" } },
			{
				code: "date_out_of_range",
				params: { line: "4", min: "1996-09-22", max: "2026-09-21" },
			},
		]);
	});
});

describe("categories", () => {
	it("refuses a file without a name column", async () => {
		await ownDatabase();

		expect((await preview("categories", "color\n#ff0000")).errors).toEqual([
			{ code: "missing_columns", params: { columns: "name" } },
		]);
	});

	it("creates categories and their parents, a child taking its parent's colour", async () => {
		await ownDatabase();
		await ownCategory("Salaire", { color: "#27a644" });

		const result = await publish(
			"categories",
			[
				"name*,color,parent_category,lucide_icon",
				"Food & Drink,#F97316,,utensils",
				"Groceries,#407706,Food & Drink,shopping-cart",
				"Prime,,Salaire,unknown-icon",
				"Restaurants,,Sorties,",
			].join("\n"),
		);

		expect(result.counts).toEqual({ categories: 4 });
		expect(
			await rows(sql`select c.name, c.color, c.icon, p.name as parent
				from categories c left join categories p on p.id = c.parent_id order by c.name`),
		).toEqual([
			{ name: "Food & Drink", color: "#f97316", icon: "utensils", parent: null },
			{
				name: "Groceries",
				color: "#f97316",
				icon: "shopping-cart",
				parent: "Food & Drink",
			},
			{ name: "Prime", color: "#27a644", icon: "tag", parent: "Salaire" },
			{ name: "Restaurants", color: "#fc7840", icon: "tag", parent: "Sorties" },
			{ name: "Salaire", color: "#27a644", icon: "tag", parent: null },
			{ name: "Sorties", color: "#fc7840", icon: "tag", parent: null },
		]);
	});

	it("refuses a category its own parent, and a third level", async () => {
		await ownDatabase();
		const food = await ownCategory("Food");
		await ownCategory("Bakery", { parentId: food });

		const read = await preview(
			"categories",
			[
				"name,color,parent_category,lucide_icon",
				"Food,,Food,",
				"Snacks,,Bakery,",
				"Food,,Groceries,",
			].join("\n"),
		);

		expect(read.errors).toEqual([
			{ code: "own_parent", params: { line: "2", name: "Food" } },
			{ code: "nested_category", params: { line: "3", name: "Snacks" } },
			{ code: "nested_category", params: { line: "4", name: "Food" } },
		]);
	});

	it("reimports the export's categories.csv without changing anything", async () => {
		await ownDatabase();
		await seedDefaults({ db: db() });
		const food = await ownCategory("Alimentation maison", { color: "#9d6fe8", icon: "coffee" });
		await ownCategory("Boulangerie maison", { parentId: food });
		const before = await rows(
			sql`select id, name, color, icon, parent_id, updated_at from categories order by name`,
		);

		await publish("categories", await exported("categories.csv"));

		expect(
			await rows(
				sql`select id, name, color, icon, parent_id, updated_at from categories order by name`,
			),
		).toEqual(before);
	});
});

describe("categories, existing ones", () => {
	it("recolours, re-icons, moves and detaches a stored category, its child following", async () => {
		await ownDatabase();
		await ownCategory("Maison");
		const food = await ownCategory("Alimentation", { color: "#9d6fe8" });
		await ownCategory("Boulangerie", { parentId: food });
		const leisure = await ownCategory("Loisirs");
		await ownCategory("Cinéma", { parentId: leisure });

		await publish(
			"categories",
			[
				"name,color,parent_category,lucide_icon",
				"Alimentation,#27A644,,coffee",
				"Loisirs,,Maison,",
				"Cinéma,,,",
			].join("\n"),
		);

		expect(
			await rows(sql`select c.name, c.color, c.icon, p.name as parent
				from categories c left join categories p on p.id = c.parent_id order by c.name`),
		).toEqual([
			{ name: "Alimentation", color: "#27a644", icon: "coffee", parent: null },
			{ name: "Boulangerie", color: "#27a644", icon: "tag", parent: "Alimentation" },
			{ name: "Cinéma", color: "#e99537", icon: "tag", parent: null },
			{ name: "Loisirs", color: "#e99537", icon: "tag", parent: "Maison" },
			{ name: "Maison", color: "#e99537", icon: "tag", parent: null },
		]);
	});

	it("reads back a name the export prefixed so a spreadsheet would not run it", async () => {
		await ownDatabase();

		await publish(
			"categories",
			["name,color,parent_category,lucide_icon", "'-Divers,,,"].join("\n"),
		);

		expect(await rows(sql`select name from categories`)).toEqual([{ name: "-Divers" }]);
	});
});

describe("merchants", () => {
	it("skips a blank name, keeps a known one and creates the others once", async () => {
		await ownDatabase();
		await sendOwn("POST", "/api/merchants", { name: "Boulangerie" });

		const result = await publish(
			"merchants",
			[
				"name*,color,website_url",
				"boulangerie,,",
				",#e99537,",
				"Café,#e99537,https://cafe.fr",
				"café,,",
			].join("\n"),
		);

		expect(result.counts).toEqual({ merchants: 4 });
		expect(await rows(sql`select name from merchants order by name`)).toEqual([
			{ name: "Boulangerie" },
			{ name: "Café" },
		]);
	});
});

const ruleRow = z.object({
	name: z.string().nullable(),
	enabled: z.boolean(),
	effectiveDate: z.string().nullable(),
	conditions: z.array(z.unknown()),
	actions: z.array(z.unknown()),
});

async function listedRules() {
	const body = z.object({ data: z.array(ruleRow) }).parse(await sendOwn("GET", "/api/rules"));

	return body.data;
}

/** A CSV cell quoted, as a spreadsheet writes JSON. */
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

describe("rules", () => {
	const header = "name,resource_type,active,effective_date,conditions,actions";

	it("reimports the export's rules.csv without duplicating or changing a rule", async () => {
		await ownDatabase();
		const account = (await openOwn({ name: "Courant" })).id;
		const food = await ownCategory("Courses");
		await sendOwn("POST", "/api/rules", {
			name: "Supermarché",
			effectiveDate: "2026-01-01",
			conditions: [
				{ conditionType: "transaction_name", operator: "like", value: "CARREFOUR" },
				{ conditionType: "transaction_amount", operator: ">", value: "10,50" },
			],
			actions: [
				{ actionType: "set_transaction_category", value: food },
				{ actionType: "replace_in_transaction_name", value: "^CB ", replacement: "" },
			],
		});
		await sendOwn("POST", "/api/rules", {
			conditions: [{ conditionType: "transaction_account", operator: "=", value: account }],
			actions: [{ actionType: "exclude_transaction", value: null }],
		});
		const before = await listedRules();

		const result = await publish("rules", await exported("rules.csv"));

		expect(result.counts).toEqual({ rules: 2 });
		expect(await listedRules()).toEqual(before);
	});

	it("creates a rule, the names it gives created, disabled unless active", async () => {
		await ownDatabase();

		await publish(
			"rules",
			[
				header,
				[
					"Courses",
					"transaction",
					"no",
					"2024-01-01",
					csvCell('[{"condition_type":"transaction_name","operator":"like","value":"grocery"}]'),
					csvCell('[{"action_type":"set_transaction_category","value":"Groceries"}]'),
				].join(","),
			].join("\n"),
		);

		expect(await listedRules()).toEqual([
			expect.objectContaining({ name: "Courses", enabled: false, effectiveDate: "2024-01-01" }),
		]);
		expect(await rows(sql`select name from categories`)).toEqual([{ name: "Groceries" }]);
	});

	it("reads the escaped and wrapped JSON of Sure's older rule files", async () => {
		await ownDatabase();
		const condition = '[{"condition_type":"transaction_name","operator":"like","value":"VALUE"}]';
		const action = '[{"action_type":"exclude_transaction"}]';

		const result = await publish(
			"rules",
			[
				header,
				[
					"Escaped",
					"transaction",
					"true",
					"",
					csvCell(condition.replace("VALUE", "a").replaceAll('"', '\\"')),
					csvCell(action.replaceAll('"', '\\"')),
				].join(","),
				[
					"Wrapped",
					"transaction",
					"true",
					"",
					csvCell(JSON.stringify(condition.replace("VALUE", "b"))),
					csvCell(JSON.stringify(action)),
				].join(","),
			].join("\n"),
		);

		expect(result.counts).toEqual({ rules: 2 });
		expect(await listedRules()).toHaveLength(2);
		expect(await listedRules()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "Escaped",
					conditions: [expect.objectContaining({ value: "a" })],
				}),
				expect.objectContaining({
					name: "Wrapped",
					conditions: [expect.objectContaining({ value: "b" })],
				}),
			]),
		);
	});

	it("updates the rule of the same name, keeping its replacement in the label", async () => {
		await ownDatabase();
		await sendOwn("POST", "/api/rules", {
			name: "Courses",
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "carrefour" }],
			actions: [
				{ actionType: "exclude_transaction", value: null },
				{ actionType: "replace_in_transaction_name", value: "CB ", replacement: "" },
			],
		});

		const result = await publish(
			"rules",
			[
				header,
				[
					"Courses",
					"transaction",
					"no",
					"2024-02-30",
					csvCell('[{"condition_type":"transaction_name","operator":"like","value":"lidl"}]'),
					csvCell('[{"action_type":"exclude_transaction"}]'),
				].join(","),
			].join("\n"),
		);

		expect(result.counts).toEqual({ rules: 1 });
		expect(await listedRules()).toEqual([
			expect.objectContaining({
				name: "Courses",
				enabled: false,
				effectiveDate: null,
				conditions: [expect.objectContaining({ value: "lidl" })],
				actions: [
					expect.objectContaining({ actionType: "exclude_transaction" }),
					expect.objectContaining({ actionType: "replace_in_transaction_name", value: "CB " }),
				],
			}),
		]);
	});

	it("refuses each rule Archant or Sure refuses, on its line", async () => {
		await ownDatabase();
		const action = csvCell('[{"action_type":"exclude_transaction"}]');
		const read = await preview(
			"rules",
			[
				header,
				["A", "account", "true", "", "[]", action].join(","),
				["B", "transaction", "true", "", csvCell("[{"), action].join(","),
				["C", "transaction", "true", "", "[]", "[]"].join(","),
				[
					"D",
					"transaction",
					"true",
					"",
					csvCell('[{"condition_type":"transaction_details","operator":"like","value":"x"}]'),
					action,
				].join(","),
				["E", "", "true", "", "[]", action].join(","),
			].join("\n"),
		);

		expect(read.errors).toEqual([
			{ code: "unsupported_resource_type", params: { line: "2", resource_type: "account" } },
			{ code: "invalid_json", params: { line: "3", field: "conditions" } },
			{ code: "min_actions", params: { line: "4" } },
			{ code: "unsupported_rule", params: { line: "5" } },
			{ code: "required", params: { line: "6", field: "resource_type" } },
		]);
		expect(read.counts).toEqual({ rules: 5 });
	});
});

async function pea() {
	return (await openOwn({ name: "PEA", type: "investment", subtype: "pea" })).id;
}

const tradeRows = async () =>
	rows(sql`select a.name, e.date, e.amount, t.quantity, t.price, t.fee, s.ticker, s.currency
		from trades t join entries e on e.id = t.entry_id join accounts a on a.id = e.account_id
		join securities s on s.id = t.security_id order by e.date, s.ticker`);

describe("trades", () => {
	it("writes buys and sales in minor units, a buy's quantity positive and its amount negative", async () => {
		await ownDatabase();
		const account = await pea();

		const result = await publish(
			"trades",
			[
				"date,ticker,exchange_operating_mic,qty,price",
				"2026-09-01,mc.pa,,10,612.40",
				"2026-09-02,MC.PA,,-4,620",
			].join("\n"),
			{ configuration: { accountId: account } },
		);

		expect(result.counts).toEqual({ trades: 2 });
		expect(await tradeRows()).toEqual([
			{
				name: "PEA",
				date: "2026-09-01",
				amount: -612400,
				quantity: "10",
				price: "612.4",
				fee: 0,
				ticker: "MC.PA",
				currency: "EUR",
			},
			{
				name: "PEA",
				date: "2026-09-02",
				amount: 248000,
				quantity: "-4",
				price: "620",
				fee: 0,
				ticker: "MC.PA",
				currency: "EUR",
			},
		]);
	});

	it("reads « Les achats sont en quantité négative » as a buy", async () => {
		await ownDatabase();
		const account = await pea();

		await publish("trades", ["date,ticker,qty,price", "2026-09-01,AI.PA,-5,150"].join("\n"), {
			configuration: { accountId: account, signage: "inflows_negative" },
		});

		expect(await tradeRows()).toEqual([
			expect.objectContaining({ amount: -75000, quantity: "5", price: "150" }),
		]);
	});

	it("refuses another currency, a negative price and a bad date on their lines, skipping a zero quantity", async () => {
		await ownDatabase();
		const account = await pea();
		const read = await preview(
			"trades",
			[
				"date,ticker,qty,price,currency",
				"2026-09-01,AAPL,1,150,USD",
				"2026-09-01,AAPL,0,150,",
				"2026-09-01,AAPL,1,-1,",
				"2024-13-01,AAPL,1,1,",
			].join("\n"),
			{ configuration: { accountId: account } },
		);

		expect(read.errors).toEqual([
			{ code: "CURRENCY_MISMATCH", params: { line: "2", currency: "USD", account: "EUR" } },
			{ code: "negative_price", params: { line: "4" } },
			{ code: "invalid_date", params: { line: "5", format: "YYYY-MM-DD" } },
		]);
		expect(read.counts).toEqual({ trades: 3 });
	});

	it("refuses a single account that takes no trades, writing nothing", async () => {
		await ownDatabase();
		const checking = (await openOwn({ name: "Courant" })).id;

		await expect(
			refusal(
				publish("trades", ["date,ticker,qty,price", "2026-09-01,MC.PA,1,600"].join("\n"), {
					configuration: { accountId: checking },
				}),
			),
		).resolves.toMatchObject({ code: "TRADES_NOT_SUPPORTED" });
		expect(await rows(sql`select entry_id from trades`)).toEqual([]);
	});

	it("refuses a ticker held in another currency, stored or earlier in the file", async () => {
		await ownDatabase();
		const account = await pea();
		const dollars = (
			await openOwn({ name: "Broker", type: "investment", subtype: "brokerage", currency: "USD" })
		).id;

		await publish("trades", ["date,ticker,qty,price", "2026-09-01,VTI,1,200"].join("\n"), {
			configuration: { accountId: dollars },
		});

		expect(
			(
				await preview("trades", ["date,ticker,qty,price", "2026-09-02,VTI,1,200"].join("\n"), {
					configuration: { accountId: account },
				})
			).errors,
		).toEqual([{ code: "security_currency", params: { line: "2", ticker: "VTI" } }]);
		expect(
			(
				await preview(
					"trades",
					[
						"date,ticker,qty,price,account",
						"2026-09-02,ABC,1,10,PEA",
						"2026-09-02,ABC,1,10,Broker",
					].join("\n"),
				)
			).errors,
		).toEqual([{ code: "security_currency", params: { line: "3", ticker: "ABC" } }]);
	});

	it("refuses a trade past the largest amount", async () => {
		await ownDatabase();
		const account = await pea();

		expect(
			(
				await preview(
					"trades",
					["date,ticker,qty,price", "2026-09-01,MC.PA,1000000000,999999999"].join("\n"),
					{ configuration: { accountId: account } },
				)
			).errors,
		).toEqual([{ code: "trade_too_large", params: { line: "2" } }]);
	});

	it("finds a stored listing by its ticker alone when the row gives no MIC", async () => {
		await ownDatabase();
		const account = await pea();

		await publish(
			"trades",
			["date,ticker,exchange_operating_mic,qty,price", "2026-09-01,MC,XPAR,1,600"].join("\n"),
			{ configuration: { accountId: account } },
		);
		await publish("trades", ["date,ticker,qty,price", "2026-09-02,MC,1,610"].join("\n"), {
			configuration: { accountId: account },
		});

		expect(await rows(sql`select ticker, mic from securities`)).toEqual([
			{ ticker: "MC", mic: "XPAR" },
		]);
	});

	it("maps account names, an unknown one to a new investment account opened the day before", async () => {
		await ownDatabase();
		const peaId = await pea();
		const file = [
			"date,ticker,qty,price,account",
			"2026-09-03,MC.PA,1,600,PEA",
			"2026-09-05,AI.PA,2,150,Courtier",
			"2026-09-04,AI.PA,1,140,Courtier",
		].join("\n");

		const read = await preview("trades", file);

		expect(read.mappings.accounts).toEqual([
			{ key: "Courtier", count: 2, value: "internal_new_resource" },
			{ key: "PEA", count: 1, value: peaId },
		]);
		expect(read.counts).toEqual({ trades: 3, accounts: 1 });

		await publish("trades", file);

		expect(
			await rows(sql`select a.name, a.type, a.currency, e.date, e.amount from accounts a
				join entries e on e.account_id = a.id and e.valuation_kind = 'opening_anchor'
				where a.name = 'Courtier'`),
		).toEqual([
			{ name: "Courtier", type: "investment", currency: "EUR", date: "2026-09-03", amount: 0 },
		]);
		expect(
			await rows(sql`select b.balance from balances b join accounts a on a.id = b.account_id
				where a.name = 'Courtier' and b.date = '2026-09-05'`),
		).toEqual([{ balance: 3 * 15000 - 14000 - 30000 }]);
		expect(await tradeRows()).toHaveLength(3);
	});

	it("writes to the account the mapping names, and recomputes its balance", async () => {
		await ownDatabase();
		const peaId = await pea();
		const file = [
			"date,ticker,qty,price,account",
			"2026-09-03,MC.PA,1,600,Courtier",
			"2026-09-04,MC.PA,0,0,Dividendes",
		].join("\n");
		const before = await rows(
			sql`select balance from balances where account_id = ${peaId} and date = '2026-09-03'`,
		);

		const read = await preview("trades", file, {
			mappings: {
				accounts: [
					{ key: "Courtier", value: peaId },
					{ key: "Dividendes", value: "internal_new_resource" },
				],
			},
		});

		expect(read.counts).toEqual({ trades: 1, accounts: 0 });

		await publish("trades", file, {
			mappings: {
				accounts: [
					{ key: "Courtier", value: peaId },
					{ key: "Dividendes", value: "internal_new_resource" },
				],
			},
		});

		expect(await rows(sql`select name from accounts order by name`)).toEqual([{ name: "PEA" }]);
		expect(
			await rows(
				sql`select balance from balances where account_id = ${peaId} and date = '2026-09-03'`,
			),
		).toEqual(before);
		expect(
			await rows(
				sql`select quantity from holdings where account_id = ${peaId} and date = '2026-09-03'`,
			),
		).toEqual([{ quantity: "1" }]);
	});

	it("leaves a blank account name to map to an existing account", async () => {
		await ownDatabase();
		await pea();

		const read = await preview(
			"trades",
			["date,ticker,qty,price,account", "2026-09-03,MC.PA,1,600,"].join("\n"),
		);

		expect(read.mappings.accounts).toEqual([{ key: "", count: 1, value: null }]);
		expect(read.errors).toEqual([{ code: "unmapped_account", params: { key: "" } }]);
	});
});

describe("files", () => {
	it("refuses headers equal once normalised", async () => {
		await ownDatabase();

		expect((await preview("merchants", "Name,name*\nA,B")).errors).toEqual([
			{ code: "duplicate_headers", params: { columns: "Name, name*" } },
		]);
	});

	it("refuses a file without a data row as CSV_INVALID", async () => {
		await ownDatabase();

		await expect(refusal(preview("merchants", "name"))).resolves.toMatchObject({
			code: "CSV_INVALID",
		});
	});

	it("refuses a file over Sure's MAX_CSV_SIZE unread", async () => {
		await ownDatabase();
		const bytes = new Uint8Array(MAX_CSV_BYTES + 1).fill(0x61);

		await expect(
			refusal(previewCsvImport(deps(), { type: "merchants", file: { name: "m.csv", bytes } })),
		).resolves.toMatchObject({ code: "IMPORT_FILE_TOO_LARGE", params: { maxSize: "10" } });
	});

	it("refuses more rows than Sure's max_row_count", async () => {
		await ownDatabase();
		const file = ["name,balance", ...Array.from({ length: 51 }, (_, index) => `A${index},1`)].join(
			"\n",
		);

		await expect(refusal(preview("accounts", file))).resolves.toMatchObject({
			code: "IMPORT_TOO_MANY_ROWS",
			params: { max: "50" },
		});
	});
});
