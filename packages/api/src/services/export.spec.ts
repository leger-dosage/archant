import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import Papa from "papaparse";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Database } from "@archant/data/client";
import { toMinorUnits } from "@archant/data/money";

import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
	creditAgricole,
	openOwn,
	own,
	ownCategory,
	ownDatabase,
	ownRequest,
	postOwn,
	sendOwn,
	useSignedInApp,
} from "../testing/app.ts";
import { surePreflight } from "../testing/sure-preflight.ts";
import { DEFAULT_CATEGORIES } from "./default-categories.ts";
import { EXPORT_IDLE_MS, archiveName, exportArchive } from "./export.ts";
import { linkBankAccount } from "./ledger/bank-link.ts";
import { seedDefaults } from "./seed.ts";

useSignedInApp();

// The clock is 2026-09-21 10:00 UTC, noon in Europe/Paris.

const ENTRIES = [
	"version.txt",
	"accounts.csv",
	"transactions.csv",
	"categories.csv",
	"merchants.csv",
	"rules.csv",
	"all.ndjson",
];

/** Sure's `Family::DataImporter#import!` order, which `all.ndjson` follows. */
const TYPE_ORDER = [
	"Account",
	"Balance",
	"Category",
	"Tag",
	"Merchant",
	"RecurringTransaction",
	"Transaction",
	"Transfer",
	"RejectedTransfer",
	"Valuation",
	"Budget",
	"BudgetCategory",
	"Rule",
];

const line = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });

type Line = z.infer<typeof line>;

function database(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

/** The archive of the test's own database, unzipped, with the log it wrote. */
async function exported(db = database()) {
	const log: string[] = [];
	const logger = createLogger("info", { write: (text: string) => log.push(text) });
	const archive = exportArchive({ db, timeZone: "Europe/Paris", logger });
	const files = unzipSync(new Uint8Array(await new Response(archive.body).arrayBuffer()));
	const text = Object.fromEntries(
		Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]),
	);
	const ndjson = text["all.ndjson"] ?? "";
	const lines = ndjson
		.split("\n")
		.filter((row) => row !== "")
		.map((row): Line => line.parse(JSON.parse(row)));

	return {
		fileName: archive.fileName,
		names: Object.keys(files),
		text,
		ndjson,
		lines,
		of: (type: string) => lines.filter((row) => row.type === type).map((row) => row.data),
		csv: (name: string) =>
			Papa.parse<string[]>((text[name] ?? "").trimEnd(), { skipEmptyLines: false }).data,
		log: log.map((entry) => z.record(z.string(), z.unknown()).parse(JSON.parse(entry))),
	};
}

async function account(json: Record<string, unknown>) {
	const body = await sendOwn("POST", "/api/accounts", {
		currency: "EUR",
		openingDate: "2026-04-01",
		openingBalance: "0",
		subtype: null,
		...json,
	});

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

async function created(path: string, json: Record<string, unknown>) {
	const body = await sendOwn("POST", path, json);

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

async function transferOf(outflow: string) {
	const rows = await database().all<{ id: string }>(
		sql`select id from transfers where outflow_transaction_id = ${outflow}`,
	);

	return rows[0]?.id;
}

/** Two sides of one movement, linked as the matcher or the user links them. */
async function moved(from: string, to: string, date: string, amount: string) {
	const outflow = await postOwn(from, { date, label: "Virement", amount: `-${amount}` });
	const inflow = await postOwn(to, { date, label: "Virement reçu", amount });

	if ((await transferOf(outflow)) === undefined) {
		await sendOwn("POST", "/api/transfers", { transactionId: outflow, counterpartId: inflow });
	}

	return { outflow, inflow, transfer: (await transferOf(outflow)) ?? "" };
}

/**
 * A household with one account of each kind, a loan's details, categories,
 * tags, a merchant, transfers of each kind, one refused, a snapshot,
 * recurring patterns, budgets and rules.
 */
async function household() {
	await ownDatabase();
	await seedDefaults({ db: database() });
	const checking = await openOwn({
		name: "Compte joint",
		openingBalance: "2 000,00",
		openingDate: "2026-04-01",
	});
	const ids = {
		checking: checking.id,
		savings: await account({
			name: "Livret A",
			type: "depository",
			subtype: "savings",
			openingBalance: "500",
		}),
		card: await account({ name: "Carte", type: "credit_card", openingBalance: "100" }),
		consumer: await account({
			name: "Crédit auto",
			type: "loan",
			subtype: "consumer",
			openingBalance: "12 000",
			details: { originalAmount: "15 000", interestRate: "3,45", endDate: "2030-01-01" },
		}),
		mortgage: await account({
			name: "Prêt immobilier",
			type: "loan",
			subtype: "mortgage",
			openingBalance: "180 000",
		}),
		pea: await account({
			name: "PEA",
			type: "investment",
			subtype: "pea",
			openingBalance: "1 000",
		}),
		other: await account({
			name: "Crypto",
			type: "investment",
			subtype: "other",
			openingBalance: "50",
		}),
		home: await account({
			name: "Maison",
			type: "property",
			subtype: "apartment",
			openingBalance: "250 000",
		}),
		car: await account({ name: "Voiture", type: "vehicle", openingBalance: "9 000" }),
	};
	await sendOwn("PATCH", `/api/accounts/${ids.car}`, { active: false });
	await sendOwn("PATCH", `/api/accounts/${ids.home}`, { excludedFromReports: true });

	const food = await ownCategory("Alimentation");
	const bakery = await ownCategory("Boulangerie", { parentId: food });
	const trip = await created("/api/tags", { name: "Voyage, été" });
	const odd = await created("/api/tags", { name: "A\\B|C" });
	const baker = await created("/api/merchants", { name: "Boulanger du coin" });

	const bread = await postOwn(ids.checking, {
		date: "2026-09-10",
		label: "CB BOULANGERIE",
		amount: "-42,90",
	});
	await sendOwn("PATCH", `/api/transactions/${bread}`, {
		categoryId: bakery,
		merchantId: baker,
		tagIds: [trip, odd],
		notes: "Pain, croissants",
	});
	const salary = await postOwn(ids.checking, {
		date: "2026-08-28",
		label: "SALAIRE",
		amount: "2 500,00",
	});

	const toSavings = await moved(ids.checking, ids.savings, "2026-09-02", "100,00");
	const toCard = await moved(ids.checking, ids.card, "2026-09-03", "80,00");
	const toLoan = await moved(ids.checking, ids.consumer, "2026-09-04", "300,00");
	const toPea = await moved(ids.checking, ids.pea, "2026-09-05", "200,00");
	const refused = await moved(ids.checking, ids.savings, "2026-09-06", "33,00");
	await sendOwn("POST", `/api/transfers/${refused.transfer}/reject`);

	await sendOwn("POST", `/api/accounts/${ids.checking}/snapshots`, {
		date: "2026-09-15",
		balance: "1 700,00",
	});

	const subscription = await postOwn(ids.checking, {
		date: "2026-09-08",
		label: "NETFLIX",
		amount: "-13,49",
	});
	const rent = await postOwn(ids.checking, {
		date: "2026-09-01",
		label: "LOYER",
		amount: "-900,00",
	});
	await created("/api/recurring", { entryId: subscription });
	const dismissed = await created("/api/recurring", { entryId: rent });
	await sendOwn("PATCH", `/api/recurring/${dismissed}`, { status: "dismissed" });

	await sendOwn("PUT", "/api/budgets/2026-08", {
		budgetedSpending: "1 000",
		expectedIncome: "2 500",
	});
	await sendOwn("PUT", `/api/budgets/2026-08/categories/${food}`, { budgetedSpending: "300" });
	await sendOwn("PUT", `/api/budgets/2026-08/categories/${food}/rollover`, {
		rolloverEnabled: true,
	});
	await sendOwn("PUT", "/api/budgets/2026-09", {
		budgetedSpending: "1 000",
		expectedIncome: "2 500",
	});

	const categorise = await created("/api/rules", {
		name: "Boulangerie",
		conditions: [
			{ conditionType: "transaction_name", operator: "like", value: "BOULANGERIE" },
			{
				conditionType: "compound",
				operator: "or",
				conditions: [
					{ conditionType: "transaction_amount", operator: ">", value: "10,50" },
					{ conditionType: "transaction_category", operator: "is_null", value: null },
				],
			},
		],
		actions: [
			{ actionType: "set_transaction_category", value: bakery },
			{ actionType: "set_transaction_merchant", value: baker },
			{ actionType: "set_transaction_tags", value: trip },
			{ actionType: "replace_in_transaction_name", value: "^CB ", replacement: "" },
		],
	});
	const transfer = await created("/api/rules", {
		name: null,
		conditions: [
			{ conditionType: "transaction_tag", operator: "=", value: odd },
			{ conditionType: "transaction_merchant", operator: "=", value: baker },
		],
		actions: [{ actionType: "set_as_transfer_or_payment", value: ids.savings }],
	});
	const replaceOnly = await created("/api/rules", {
		name: "Nettoyage",
		conditions: [{ conditionType: "transaction_name", operator: "like", value: "PRLV" }],
		actions: [{ actionType: "replace_in_transaction_name", value: "^PRLV ", replacement: "" }],
	});

	return {
		ids,
		food,
		bakery,
		trip,
		odd,
		baker,
		bread,
		salary,
		toSavings,
		toCard,
		toLoan,
		toPea,
		refused,
		rules: { categorise, transfer, replaceOnly },
	};
}

describe("exportArchive", () => {
	it("names the file after the time in APP_TIMEZONE", () => {
		expect(archiveName(new Date("2026-09-21T10:00:00Z"), "Europe/Paris")).toBe(
			"archant_export_20260921_120000.zip",
		);
		expect(archiveName(new Date("2026-12-31T23:30:05Z"), "Europe/Paris")).toBe(
			"archant_export_20270101_003005.zip",
		);
	});

	it("writes every file with Sure's header for an empty household, and the seeded categories", async () => {
		await ownDatabase();
		await seedDefaults({ db: database() });

		const archive = await exported();

		expect(archive.fileName).toBe("archant_export_20260921_120000.zip");
		expect(archive.names).toEqual(ENTRIES);
		expect(archive.text["version.txt"]).toBe("export_version: 2\n");
		expect(archive.text["accounts.csv"]).toBe("id,name,type,subtype,balance,currency,created_at\n");
		expect(archive.text["transactions.csv"]).toBe(
			"date,account_name,amount,name,category,tags,notes,currency\n",
		);
		expect(archive.text["merchants.csv"]).toBe("name,color,website_url\n");
		expect(archive.text["rules.csv"]).toBe(
			"name,resource_type,active,effective_date,conditions,actions\n",
		);
		expect(archive.csv("categories.csv")).toHaveLength(DEFAULT_CATEGORIES.length + 1);
		expect(archive.csv("categories.csv")[0]).toEqual([
			"name",
			"color",
			"parent_category",
			"lucide_icon",
		]);
		expect(archive.lines.map((row) => row.type)).toEqual(DEFAULT_CATEGORIES.map(() => "Category"));
		expect(archive.ndjson.endsWith("\n")).toBe(true);
		expect(surePreflight(archive.ndjson)).toEqual([]);
		expect(archive.log).toHaveLength(1);
		expect(archive.log[0]).toMatchObject({
			msg: "export finished",
			Category: DEFAULT_CATEGORIES.length,
		});
		expect(typeof archive.log[0]?.["durationMs"]).toBe("number");
	});

	it("passes Sure's preflight on a rich household, its types in the importer's order", async () => {
		await household();

		const archive = await exported();
		const types = archive.lines.map((row) => TYPE_ORDER.indexOf(row.type));

		expect(surePreflight(archive.ndjson)).toEqual([]);
		expect(types).toEqual(types.toSorted((a, b) => a - b));
		expect(new Set(archive.lines.map((row) => row.type))).toEqual(new Set(TYPE_ORDER));
	});

	it("maps accounts to Sure's accountables, the rest under archant", async () => {
		const { ids } = await household();

		const archive = await exported();
		const accounts = new Map(archive.of("Account").map((row) => [row["id"], row]));

		expect(accounts.get(ids.card)).toMatchObject({
			accountable_type: "CreditCard",
			subtype: "credit_card",
			accountable: { subtype: "credit_card" },
			archant: { type: "credit_card", subtype: null },
		});
		expect(accounts.get(ids.consumer)).toMatchObject({
			accountable_type: "Loan",
			subtype: "other",
			balance: "11700.00",
			accountable: { subtype: "other", initial_balance: "15000.00", interest_rate: "3.45" },
			archant: { type: "loan", subtype: "consumer", loan_end_date: "2030-01-01" },
		});
		expect(accounts.get(ids.mortgage)).toMatchObject({
			accountable: { subtype: "mortgage", initial_balance: null, interest_rate: null },
			archant: { loan_end_date: null },
		});
		expect(accounts.get(ids.pea)).toMatchObject({ accountable_type: "Investment", subtype: "pea" });
		expect(accounts.get(ids.home)).toMatchObject({
			accountable_type: "Property",
			exclude_from_reports: true,
			status: "active",
		});
		expect(accounts.get(ids.car)).toMatchObject({
			accountable_type: "Vehicle",
			subtype: null,
			status: "disabled",
			archant: { type: "vehicle", subtype: null },
		});
		expect(accounts.get(ids.checking)).not.toHaveProperty("archant.loan_end_date");
		expect(archive.csv("accounts.csv")).toContainEqual([
			ids.consumer,
			"Crédit auto",
			"Loan",
			"other",
			"11700.00",
			"EUR",
			expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u),
		]);
	});

	it("writes amounts in Sure's sign, balances and valuations as stored", async () => {
		const { ids, bread, salary, bakery, baker, trip, odd } = await household();

		const archive = await exported();
		const transactions = new Map(archive.of("Transaction").map((row) => [row["id"], row]));
		const valuations = archive.of("Valuation").filter((row) => row["account_id"] === ids.checking);

		expect(transactions.get(bread)).toMatchObject({
			amount: "42.90",
			name: "CB BOULANGERIE",
			notes: "Pain, croissants",
			category_id: bakery,
			merchant_id: baker,
			tag_ids: [trip, odd].toSorted(),
			kind: "standard",
			excluded: false,
			archant: {
				pending: false,
				locked_fields: ["date", "amount", "label", "notes", "category", "merchant", "tags"],
				category_origin: "user",
				reference: null,
				possible_duplicate: false,
			},
		});
		expect(transactions.get(salary)).toMatchObject({ amount: "-2500.00" });
		expect(valuations).toEqual([
			expect.objectContaining({
				kind: "opening_anchor",
				name: "Opening balance",
				amount: "2000.00",
			}),
			expect.objectContaining({
				kind: "reconciliation",
				name: "Manual balance update",
				date: "2026-09-15",
				amount: "1700.00",
			}),
		]);
		expect(archive.of("Valuation")).toContainEqual(
			expect.objectContaining({
				account_id: ids.consumer,
				name: "Original principal",
				amount: "12000.00",
			}),
		);
		expect(archive.of("Balance")).toContainEqual({
			account_id: ids.consumer,
			date: "2026-04-01",
			balance: "12000.00",
			currency: "EUR",
		});
		expect(archive.csv("transactions.csv")).toContainEqual([
			"2026-09-10",
			"Compte joint",
			"42.90",
			"CB BOULANGERIE",
			"Boulangerie",
			expect.any(String),
			"Pain, croissants",
			"EUR",
		]);
		const tags = archive.csv("transactions.csv").find((row) => row[3] === "CB BOULANGERIE")?.[5];

		expect(tags?.split(/(?<!\\),/u).toSorted()).toEqual(["A\\\\B\\|C", "Voyage\\, été"]);
	});

	it("lists a split's lines in transactions.csv, and nests them under their parent in all.ndjson", async () => {
		await ownDatabase();
		const checking = await openOwn({ name: "Compte joint", openingDate: "2026-04-01" });
		const food = await ownCategory("Alimentation");
		const receipt = await created("/api/tags", { name: "Reçu" });
		const parent = await postOwn(checking.id, {
			date: "2026-09-09",
			label: "HYPERMARCHE",
			amount: "-100,00",
		});
		const body = await sendOwn("POST", `/api/transactions/${parent}/split`, {
			lines: [
				{
					label: "Courses",
					amount: "-60,00",
					categoryId: food,
					tagIds: [receipt],
					notes: "Fruits",
				},
				{ label: "Maison", amount: "-40,00", categoryId: null },
			],
		});
		const [first, second] = z
			.object({ data: z.object({ children: z.array(z.object({ id: z.string() })) }) })
			.parse(body).data.children;

		const archive = await exported();

		expect(archive.csv("transactions.csv").slice(1)).toEqual([
			["2026-09-09", "Compte joint", "60.00", "Courses", "Alimentation", "Reçu", "Fruits", "EUR"],
			["2026-09-09", "Compte joint", "40.00", "Maison", "", "", "", "EUR"],
		]);
		expect(archive.of("Transaction")).toEqual([
			expect.objectContaining({
				id: parent,
				amount: "100.00",
				excluded: true,
				split_lines: [
					{
						id: first?.id,
						entry_id: first?.id,
						amount: "60.00",
						currency: "EUR",
						name: "Courses",
						notes: "Fruits",
						excluded: false,
						category_id: food,
						merchant_id: null,
						tag_ids: [receipt],
						kind: "standard",
						created_at: "2026-09-21T10:00:00.000Z",
						updated_at: "2026-09-21T10:00:00.000Z",
						archant: {
							pending: false,
							locked_fields: ["date", "amount", "label", "excluded", "notes", "category", "tags"],
							category_origin: "user",
							reference: null,
							possible_duplicate: false,
						},
					},
					expect.objectContaining({ id: second?.id, amount: "40.00", category_id: null }),
				],
			}),
		]);
		expect(surePreflight(archive.ndjson)).toEqual([]);

		const parentLine = archive.lines.find((row) => row.type === "Transaction");
		const unbalanced = {
			type: "Transaction",
			data: {
				...parentLine?.data,
				id: "t2",
				split_lines: [
					{
						...z.array(z.record(z.string(), z.unknown())).parse(parentLine?.data["split_lines"])[0],
						amount: "60.01",
						category_id: "nowhere",
					},
				],
			},
		};

		expect(surePreflight(`${archive.ndjson}${JSON.stringify(unbalanced)}\n`)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("split line amounts that do not sum"),
				expect.stringContaining("repeats the transactions id"),
				expect.stringContaining("Transaction split line.category_id points at no exported row"),
			]),
		);
	});

	it("keeps one valuation per account and day: the opening anchor, then the bank's, then a snapshot", async () => {
		const { ids } = await household();
		const db = database();
		// A bank-linked account's figures, written as a sync writes them.
		await db.run(
			sql`insert into entries (id, account_id, kind, valuation_kind, date, amount, currency, created_at, updated_at) values (${crypto.randomUUID()}, ${ids.checking}, 'valuation', 'current_anchor', '2026-04-01', 170000, 'EUR', 0, 0), (${crypto.randomUUID()}, ${ids.checking}, 'valuation', 'current_anchor', '2026-09-15', 170000, 'EUR', 0, 0)`,
		);

		const archive = await exported();
		const valuations = archive.of("Valuation").filter((row) => row["account_id"] === ids.checking);

		expect(valuations.map((row) => [row["date"], row["kind"], row["name"]])).toEqual([
			["2026-04-01", "opening_anchor", "Opening balance"],
			["2026-09-15", "current_anchor", "Current balance"],
		]);
		expect(surePreflight(archive.ndjson)).toEqual([]);
	});

	it("keeps a transfer Sure would refuse on its two transactions, out of Sure's lines", async () => {
		await ownDatabase();
		const checking = await openOwn({ openingDate: "2026-04-01" });
		const savings = await account({ name: "Livret A", type: "depository", subtype: "savings" });
		const pair = await moved(checking.id, savings, "2026-09-10", "75,00");
		await sendOwn("PATCH", `/api/transactions/${pair.outflow}`, { date: "2026-08-01" });

		const archive = await exported();
		const transactions = new Map(archive.of("Transaction").map((row) => [row["id"], row]));

		expect(pair.transfer).not.toBe("");
		expect(archive.of("Transfer")).toEqual([]);
		expect(transactions.get(pair.outflow)).toMatchObject({
			kind: "standard",
			archant: { transfer: { id: pair.transfer, kind: "internal_move", side: "outflow" } },
		});
		expect(transactions.get(pair.inflow)).toMatchObject({
			kind: "standard",
			archant: { transfer: { id: pair.transfer, kind: "internal_move", side: "inflow" } },
		});
		expect(surePreflight(archive.ndjson)).toEqual([]);
	});

	it("starts Sure's lines 29 years back, the opening anchor moved there at that day's balance", async () => {
		await ownDatabase();
		const old = await openOwn({
			name: "Maison",
			openingDate: "1990-01-01",
			openingBalance: "1 000,00",
		});
		const early = await postOwn(old.id, {
			date: "1991-03-01",
			label: "Travaux",
			amount: "-200,00",
		});
		const recent = await postOwn(old.id, {
			date: "2026-09-10",
			label: "Entretien",
			amount: "-50,00",
		});

		const archive = await exported();
		const ids = archive.of("Transaction").map((row) => row["id"]);

		expect(archive.of("Valuation")).toEqual([
			expect.objectContaining({
				account_id: old.id,
				kind: "opening_anchor",
				date: "1997-09-21",
				amount: "800.00",
				archant: { opening_date: "1990-01-01" },
			}),
		]);
		expect(ids).toContain(recent);
		expect(ids).not.toContain(early);
		expect(archive.csv("transactions.csv")).toContainEqual([
			"1991-03-01",
			"Maison",
			"200.00",
			"Travaux",
			"",
			"",
			"",
			"EUR",
		]);
		expect(archive.of("Balance")).toContainEqual(expect.objectContaining({ date: "1990-01-01" }));
		expect(surePreflight(archive.ndjson)).toEqual([]);
	});

	it("gives a bank-linked account's opening anchor the stored balance of its day", async () => {
		await ownDatabase();
		const db = database();
		const linked = await openOwn({ openingDate: "2026-04-01", openingBalance: "2 000,00" });
		await db.run(
			sql`insert into bank_connections (id, connector, institution_name, country, status, created_at, updated_at) values ('connection-1', 'enable-banking', 'Banque Test', 'FR', 'active', 0, 0)`,
		);
		await db.run(
			sql`insert into bank_accounts (id, bank_connection_id, identification_hash, provider_uid, name, currency, created_at, updated_at) values ('bank-account-1', 'connection-1', 'hash-1', 'uid-1', 'Compte', 'EUR', 0, 0)`,
		);
		await linkBankAccount(
			{ db, timeZone: "Europe/Paris" },
			linked.id,
			{ bankAccountId: "bank-account-1", balance: { amount: toMinorUnits(500_000), date: null } },
			{ origin: "sync" },
		);

		const archive = await exported();
		const anchor = archive
			.of("Valuation")
			.find((row) => row["account_id"] === linked.id && row["kind"] === "opening_anchor");
		const stored = await db.all<{ amount: number }>(
			sql`select entries.amount from entries where account_id = ${linked.id} and valuation_kind = 'opening_anchor'`,
		);

		// Computed backward from the bank's 5 000,00, the anchor's own 2 000,00 plays no part.
		expect(stored).toEqual([{ amount: 200_000 }]);
		expect(anchor).toMatchObject({ date: "2026-04-01", amount: "5000.00" });
		expect(surePreflight(archive.ndjson)).toEqual([]);
	});

	it("keeps the id of a deleted merchant a rule names, without a value_ref, as Sure does", async () => {
		const { baker, rules } = await household();
		await sendOwn("DELETE", `/api/merchants/${baker}`);

		const archive = await exported();
		const written = new Map(archive.of("Rule").map((row) => [row["id"], row]));

		expect(written.get(rules.categorise)?.["actions"]).toContainEqual({
			action_type: "set_transaction_merchant",
			value: baker,
		});
		expect(written.get(rules.transfer)?.["conditions"]).toContainEqual({
			condition_type: "transaction_merchant",
			operator: "=",
			value: baker,
		});
		expect(surePreflight(archive.ndjson)).toEqual([]);
	});

	it("escapes a CSV cell a spreadsheet would run, and keeps all.ndjson exact", async () => {
		await ownDatabase();
		const checking = await openOwn();
		const label = '=HYPERLINK("http://x","y")';
		const id = await postOwn(checking.id, { date: "2026-09-10", label, amount: "-1,00" });

		const archive = await exported();

		expect(archive.csv("transactions.csv")).toContainEqual([
			"2026-09-10",
			"Compte joint",
			"1.00",
			`'${label}`,
			"",
			"",
			"",
			"EUR",
		]);
		expect(archive.of("Transaction").find((row) => row["id"] === id)?.["name"]).toBe(label);
	});

	it("is checked by a preflight that refuses what Sure refuses", async () => {
		const { ids, toSavings } = await household();
		const archive = await exported();
		const broken = [
			{ type: "Security", data: { id: "s" } },
			{
				type: "Balance",
				data: { account_id: "nowhere", date: "2026-09-01", balance: "1.00", currency: "EUR" },
			},
			{ type: "Valuation", data: archive.of("Valuation")[0] },
			{ type: "Tag", data: archive.of("Tag")[0] },
			{
				type: "Transfer",
				data: {
					...archive.of("Transfer")[0],
					id: "t",
					inflow_transaction_id: toSavings.inflow,
					outflow_transaction_id: toSavings.inflow,
				},
			},
			{
				type: "Account",
				data: {
					...archive.of("Account").find((row) => row["id"] === ids.pea),
					id: "a",
					subtype: "car",
					accountable: { subtype: "car" },
				},
			},
		];

		const problems = surePreflight(
			`${archive.ndjson}${broken.map((row) => JSON.stringify(row)).join("\n")}\n`,
		);

		expect(problems).toEqual(
			expect.arrayContaining([
				expect.stringContaining("has an unsupported type Security"),
				expect.stringContaining("Balance.account_id points at no exported row"),
				expect.stringContaining("is a second valuation"),
				expect.stringContaining("repeats the tags id"),
				expect.stringContaining("Tag name"),
				expect.stringContaining("reuses the inflow_transaction_id"),
				expect.stringContaining("has sides of the wrong sign"),
				expect.stringContaining("moves money within one account"),
				expect.stringContaining("has a subtype Sure refuses: car"),
				expect.stringContaining("is an account without an opening anchor"),
			]),
		);
	});

	it("gives each side of a transfer Sure's kind, and keeps the refused pair", async () => {
		const { toSavings, toCard, toLoan, toPea, refused } = await household();

		const archive = await exported();
		const kinds = new Map(archive.of("Transaction").map((row) => [row["id"], row["kind"]]));
		const transfers = new Map(archive.of("Transfer").map((row) => [row["id"], row]));

		expect(
			[toSavings, toCard, toLoan, toPea].map((pair) => [
				kinds.get(pair.outflow),
				kinds.get(pair.inflow),
			]),
		).toEqual([
			["funds_movement", "funds_movement"],
			["cc_payment", "funds_movement"],
			["loan_payment", "funds_movement"],
			["investment_contribution", "funds_movement"],
		]);
		expect(transfers.get(toCard.transfer)).toMatchObject({
			outflow_transaction_id: toCard.outflow,
			inflow_transaction_id: toCard.inflow,
			status: "confirmed",
			archant: { kind: "credit_card_payment" },
		});
		expect(kinds.get(refused.outflow)).toBe("standard");
		expect(archive.of("RejectedTransfer")).toEqual([
			expect.objectContaining({
				outflow_transaction_id: refused.outflow,
				inflow_transaction_id: refused.inflow,
			}),
		]);
	});

	it("maps recurring patterns, categories and budgets", async () => {
		const { food, bakery, baker } = await household();

		const archive = await exported();

		// Created in the same millisecond: the id orders them.
		expect(
			archive
				.of("RecurringTransaction")
				.toSorted((a, b) => String(a["name"]).localeCompare(String(b["name"]))),
		).toEqual([
			expect.objectContaining({
				name: "LOYER",
				amount: "900.00",
				status: "ended",
				archant: { status: "dismissed" },
			}),
			expect.objectContaining({
				name: "NETFLIX",
				amount: "13.49",
				status: "active",
				manual: true,
				archant: { status: "confirmed" },
			}),
		]);
		expect(archive.of("Category")).toContainEqual(
			expect.objectContaining({
				id: bakery,
				parent_id: food,
				classification: "expense",
				lucide_icon: "tag",
			}),
		);
		expect(archive.csv("categories.csv")).toContainEqual([
			"Boulangerie",
			"#e99537",
			"Alimentation",
			"tag",
		]);
		expect(archive.of("Merchant")).toEqual([
			expect.objectContaining({ id: baker, name: "Boulanger du coin" }),
		]);
		expect(archive.csv("merchants.csv")).toEqual([
			["name", "color", "website_url"],
			["Boulanger du coin", "", ""],
		]);
		expect(archive.of("Budget")).toEqual([
			expect.objectContaining({
				start_date: "2026-08-01",
				end_date: "2026-08-31",
				budgeted_spending: "1000.00",
				expected_income: "2500.00",
				currency: "EUR",
			}),
			expect.objectContaining({ start_date: "2026-09-01", end_date: "2026-09-30" }),
		]);
		expect(archive.of("BudgetCategory")).toEqual([
			expect.objectContaining({
				category_id: food,
				budgeted_spending: "300.00",
				rollover_enabled: true,
				rolled_over_amount: "0.00",
			}),
			expect.objectContaining({
				category_id: food,
				budgeted_spending: "0.00",
				rollover_enabled: true,
				rolled_over_amount: "300.00",
			}),
		]);
	});

	it("writes rule operands as names with a value_ref, and keeps a replacement under archant", async () => {
		const { ids, bakery, baker, trip, odd, rules } = await household();

		const archive = await exported();
		const written = new Map(archive.of("Rule").map((row) => [row["id"], row]));

		expect(written.get(rules.categorise)).toMatchObject({
			name: "Boulangerie",
			resource_type: "transaction",
			active: true,
			effective_date: null,
			conditions: [
				{ condition_type: "transaction_name", operator: "like", value: "BOULANGERIE" },
				{
					condition_type: "compound",
					operator: "or",
					value: null,
					sub_conditions: [
						{ condition_type: "transaction_amount", operator: ">", value: "10.50" },
						{ condition_type: "transaction_category", operator: "is_null", value: null },
					],
				},
			],
			actions: [
				{
					action_type: "set_transaction_category",
					value: "Boulangerie",
					value_ref: { type: "Category", id: bakery, name: "Boulangerie" },
				},
				{
					action_type: "set_transaction_merchant",
					value: "Boulanger du coin",
					value_ref: { type: "Merchant", id: baker, name: "Boulanger du coin" },
				},
				{
					action_type: "set_transaction_tags",
					value: '"Voyage, été"',
					value_ref: { type: "Tag", id: trip, name: "Voyage, été" },
				},
			],
			archant: {
				actions: [{ action_type: "replace_in_transaction_name", value: "^CB ", replacement: "" }],
			},
		});
		expect(written.get(rules.transfer)).toMatchObject({
			name: null,
			conditions: [
				{
					condition_type: "transaction_tag",
					value: "A\\B|C",
					value_ref: { type: "Tag", id: odd, name: "A\\B|C" },
				},
				{
					condition_type: "transaction_merchant",
					value: "Boulanger du coin",
					value_ref: { type: "Merchant", id: baker, name: "Boulanger du coin" },
				},
			],
			actions: [{ action_type: "set_as_transfer_or_payment", value: ids.savings }],
			archant: { actions: [] },
		});
		expect(archive.csv("rules.csv")).toContainEqual([
			"Boulangerie",
			"transaction",
			"true",
			"",
			JSON.stringify(written.get(rules.categorise)?.["conditions"]),
			JSON.stringify(written.get(rules.categorise)?.["actions"]),
		]);
	});

	it("leaves a rule that only replaces in the label out of Sure's files", async () => {
		const { rules } = await household();

		const archive = await exported();

		expect(new Set(archive.of("Rule").map((row) => row["id"]))).toEqual(
			new Set([rules.categorise, rules.transfer]),
		);
		expect(archive.text["rules.csv"]).not.toContain("Nettoyage");
		expect(archive.csv("rules.csv")).toHaveLength(3);
	});

	it("writes what the budget page reads as rolled over, never a stale stored carry", async () => {
		await ownDatabase();
		const checking = await openOwn({ openingDate: "2026-04-01", openingBalance: "10 000,00" });
		const gift = await ownCategory("Cadeaux");
		await sendOwn("PUT", "/api/budgets/2026-06", {
			budgetedSpending: "1 000",
			expectedIncome: "0",
		});
		await sendOwn("PUT", `/api/budgets/2026-06/categories/${gift}`, { budgetedSpending: "100" });
		await sendOwn("PUT", `/api/budgets/2026-06/categories/${gift}/rollover`, {
			rolloverEnabled: true,
		});
		const spent = await postOwn(checking.id, {
			date: "2026-06-10",
			label: "Cadeau",
			amount: "-30,00",
		});
		await sendOwn("PATCH", `/api/transactions/${spent}`, { categoryId: gift });
		await sendOwn("PUT", "/api/budgets/2026-07", {
			budgetedSpending: "1 000",
			expectedIncome: "0",
		});
		const withdrawal = await postOwn(checking.id, {
			date: "2026-06-12",
			label: "Retrait",
			amount: "-30,00",
		});
		await sendOwn("PATCH", `/api/transactions/${withdrawal}`, { categoryId: gift });

		const page = z
			.object({
				data: z.object({
					categories: z.array(z.object({ categoryId: z.string(), rolledOver: z.number() })),
				}),
			})
			.parse((await ownRequest("GET", "/api/budgets/2026-07")).body)
			.data.categories.find((row) => row.categoryId === gift);
		const stored = await database().all<{ carried: number }>(
			sql`select rolled_over_amount as carried from budget_categories join budgets on budgets.id = budget_id where month = '2026-07'`,
		);
		const archive = await exported();
		const july = archive
			.of("BudgetCategory")
			.find((row) => row["category_id"] === gift && row["budgeted_spending"] === "0.00");

		expect(page?.rolledOver).toBe(4_000);
		expect(stored).toEqual([{ carried: 7_000 }]);
		expect(july?.["rolled_over_amount"]).toBe("40.00");
	});

	it("holds no secret, key, hash, entry key, session or file content", async () => {
		await ownDatabase();
		const db = database();
		const checking = await openOwn();
		const form = new FormData();
		form.append("file", new File([await creditAgricole()], "releve.ofx"));
		const upload = await buildApp(db).request(`/api/accounts/${checking.id}/imports`, {
			method: "POST",
			body: form,
		});
		const preview = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await upload.json()).data;
		await sendOwn("POST", `/api/imports/${preview.id}/confirm`);
		await db.run(
			sql`insert into bank_connections (id, connector, institution_name, country, status, session_id, created_at, updated_at) values ('connection-1', 'enable-banking', 'Banque Test', 'FR', 'active', 'secret-session-id', 0, 0)`,
		);
		await db.run(
			sql`insert into bank_accounts (id, bank_connection_id, identification_hash, provider_uid, name, iban_last4, currency, created_at, updated_at) values ('bank-account-1', 'connection-1', 'identification-hash-1', 'provider-uid-1', 'Compte', '4321', 'EUR', 0, 0)`,
		);
		await db.run(
			sql`update accounts set bank_account_id = 'bank-account-1' where id = ${checking.id}`,
		);
		await db.run(
			sql`insert into settings (key, value, updated_at) values ('enable_banking_private_key', 'encrypted-private-key', 0)`,
		);
		const secrets = [
			...(await db.all<{ value: string }>(sql`select token as value from sessions`)),
			...(await db.all<{ value: string }>(sql`select key as value from entry_keys`)),
			...(await db.all<{ value: string }>(
				sql`select password as value from auth_accounts where password is not null`,
			)),
			{ value: "secret-session-id" },
			{ value: "identification-hash-1" },
			{ value: "provider-uid-1" },
			{ value: "bank-account-1" },
			{ value: "encrypted-private-key" },
			{ value: "OFXHEADER" },
			{ value: "releve.ofx" },
			{ value: preview.id },
		].map((row) => row.value);

		const archive = await exported();
		const everything = Object.values(archive.text).join("\n");

		expect(secrets.length).toBeGreaterThan(10);
		expect(secrets.filter((secret) => everything.includes(secret))).toEqual([]);
		expect(archive.of("Transaction").length).toBeGreaterThan(0);
	});
});

/** Every libSQL transaction the database opens from now on, as the snapshot opens one. */
function transactionsOpened(db: Database) {
	type Opened = Awaited<ReturnType<Database["$client"]["transaction"]>>;
	const opened: Opened[] = [];
	const original = db.$client.transaction.bind(db.$client);

	vi.spyOn(db.$client, "transaction").mockImplementation(
		async (...mode: Parameters<typeof original>) => {
			const transaction = await original(...mode);
			opened.push(transaction);

			return transaction;
		},
	);

	return opened;
}

/** Reads `reader` to its end, one chunk after the other. */
async function readToEnd(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	const { done } = await reader.read();

	if (!done) {
		await readToEnd(reader);
	}
}

describe("the stream", () => {
	it("closes its snapshot when the client goes mid-way, and logs it", async () => {
		await household();
		const db = database();
		const opened = transactionsOpened(db);
		const log: string[] = [];
		const archive = exportArchive({
			db,
			timeZone: "Europe/Paris",
			logger: createLogger("info", { write: (text: string) => log.push(text) }),
		});
		const reader = archive.body.getReader();

		const first = await reader.read();
		await reader.cancel();

		expect(first.value?.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
		expect(opened).toHaveLength(1);
		expect(opened[0]?.closed).toBe(true);
		expect(JSON.parse(log[0] ?? "{}")).toMatchObject({ msg: "export cancelled" });
	});

	it("opens nothing for a body never read", async () => {
		await ownDatabase();
		const opened = transactionsOpened(database());

		const archive = exportArchive({
			db: database(),
			timeZone: "Europe/Paris",
			logger: createLogger("silent"),
		});
		// A macrotask: a stream that pulls ahead would have opened its snapshot by then.
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(opened).toHaveLength(0);
		await archive.body.cancel();
	});

	it("gives its snapshot back when the client stops reading, and errors the stream", async () => {
		await ownDatabase();
		const db = database();
		const opened = transactionsOpened(db);
		const archive = exportArchive({ db, timeZone: "Europe/Paris", logger: createLogger("silent") });
		const reader = archive.body.getReader();
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

		try {
			await reader.read();
			vi.advanceTimersByTime(EXPORT_IDLE_MS);
			const next = expect(reader.read()).rejects.toThrow("nothing read for too long");
			// The generator's `finally` runs on the next turns of the event loop.
			await new Promise((resolve) => setImmediate(resolve));

			await next;
			expect(opened).toHaveLength(1);
			expect(opened[0]?.closed).toBe(true);
		} finally {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		}
	});

	it("errors the stream on a failed read, closes its snapshot and logs the error's name only", async () => {
		await household();
		const db = database();
		const opened = transactionsOpened(db);
		const log: string[] = [];
		const archive = exportArchive({
			db,
			timeZone: "Europe/Paris",
			logger: createLogger("info", { write: (text: string) => log.push(text) }),
		});
		const reader = archive.body.getReader();
		await reader.read();
		const transaction = opened[0];

		if (transaction === undefined) {
			throw new Error("No snapshot was opened.");
		}

		vi.spyOn(transaction, "execute").mockRejectedValue(new RangeError("Compte joint 42.90"));
		const reads = readToEnd(reader);

		// Drizzle wraps the driver's error, its message holding the query.
		// Neutral: the server prints a stream's error, and Drizzle's holds the query.
		await expect(reads).rejects.toThrow(/^The export stopped\.$/u);
		expect(transaction.closed).toBe(true);
		expect(log).toHaveLength(1);
		expect(JSON.parse(log[0] ?? "{}")).toMatchObject({
			level: 50,
			msg: "export failed",
			error: "Error",
		});
		expect(log.join("")).not.toContain("42.90");
	});
});
