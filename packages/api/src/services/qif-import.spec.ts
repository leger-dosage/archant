import type { CsvImportRequest } from "./csv-import.ts";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@archant/data/client";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { openOwn, own, ownDatabase, useSignedInApp } from "../testing/app.ts";
import { importCsv, previewCsvImport } from "./csv-import.ts";
import { revertImport } from "./ledger/import-revert.ts";

useSignedInApp();

beforeEach(async () => {
	await ownDatabase();
});

// Story 30.6: Sure's `QifImport` through « Réglages › Importations ». The
// clock is 2026-09-21 10:00 UTC.

function db(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const deps = () => ({ db: db(), timeZone: "Europe/Paris", logger: createLogger("silent") });

const request = (
	lines: readonly string[],
	choices: Pick<CsvImportRequest, "configuration" | "mappings" | "edits"> = {},
): CsvImportRequest => ({
	type: "qif",
	file: { name: "quicken.qif", bytes: new TextEncoder().encode(lines.join("\r\n")) },
	...choices,
});

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

type Line = {
	account: string;
	date: string;
	amount: number;
	label: string;
	notes: string | null;
	category: string | null;
	tags: string | null;
	excluded: number;
	parent: string | null;
};

const lines = async () =>
	rows<Line>(sql`select a.name as account, e.date, e.amount, t.label, t.notes,
			c.name as category, t.excluded, p.amount as parent,
			(select group_concat(g.name, '|') from (select tg.name from taggings tt
				join tags tg on tg.id = tt.tag_id where tt.transaction_id = e.id order by tg.name) g) as tags
		from entries e join transactions t on t.entry_id = e.id join accounts a on a.id = e.account_id
		left join categories c on c.id = t.category_id
		left join entries p on p.id = e.parent_entry_id
		where e.kind = 'transaction' order by e.date, e.parent_entry_id is not null, e.amount`);

/** Two accounts, categories with tags, a split record and a transfer, dated month first. */
const TWO_ACCOUNTS = [
	"!Account",
	"NCourant QIF",
	"TBank",
	"^",
	"!Type:Bank",
	"D01/02'26",
	"T1,000.00",
	"POpening Balance",
	"^",
	"D01/05'26",
	"T-100.00",
	"PSupermarché",
	"L--Split--",
	"SAlimentation/Famille",
	"$-60.00",
	"EFruits",
	"SAuto:Essence",
	"$-40.00",
	"^",
	"D01/06'26",
	"T-12,50",
	"PCafé",
	"MCroissant",
	"LLoisirs/Vacances:Été",
	"^",
	"D01/20'26",
	"T-90.00",
	"PCourses",
	"L--Split--",
	"SAlimentation",
	"$-60.00",
	"SAuto:Essence",
	"$-20.00",
	"^",
	"!Account",
	"NCarte QIF",
	"TCCard",
	"^",
	"!Type:CCard",
	"D01/07'26",
	"T-30.00",
	"PLibrairie",
	"LLoisirs",
	"^",
];

describe("« Configurer et sélectionner »", () => {
	it("shows the detected date format, the categories and tags with their counts, and the splits", async () => {
		const read = await preview(TWO_ACCOUNTS);

		expect(read.configuration.dateFormat).toBe("%m/%d/%Y");
		// Sure's `valid_date_formats_with_preview`: the formats reading `01/02'26`.
		expect(read.qif?.dateFormats.map(({ format, first }) => [format, first])).toEqual([
			["%d/%m/%Y", "2026-02-01"],
			["%m/%d/%Y", "2026-01-02"],
			["%e/%m/%Y", "2026-02-01"],
		]);
		expect(read.qif?.categories).toEqual([
			{ name: "Alimentation", count: 0, split: true },
			{ name: "Auto:Essence", count: 0, split: true },
			{ name: "Loisirs", count: 2, split: false },
		]);
		expect(read.qif?.tags).toEqual([
			{ name: "Famille", count: 0 },
			{ name: "Vacances", count: 1 },
			{ name: "Été", count: 1 },
		]);
		expect(read.qif?.splits).toBe(true);
		expect(read.qif?.accounts).toBe(true);
		expect(read.clean.columns).toEqual([
			"date",
			"account",
			"amount",
			"name",
			"currency",
			"category",
			"tags",
			"notes",
		]);
		expect(read.clean.rows[1]?.values).toEqual([
			"2026-01-06",
			"Courant QIF",
			"-12.50",
			"Café",
			"",
			"Loisirs",
			"Vacances|Été",
			"Croissant",
		]);
		expect(read.errors).toEqual([]);
	});

	it("reads the dates with another format, and clears what is unchecked", async () => {
		const read = await preview(TWO_ACCOUNTS, {
			configuration: { dateFormat: "%d/%m/%Y", qifCategories: ["Alimentation"], qifTags: [] },
		});

		expect(read.clean.rows[0]?.values.slice(0, 1)).toEqual(["2026-05-01"]);
		expect(read.clean.rows[1]?.values.slice(5, 7)).toEqual(["", ""]);
		expect(read.mappings.categories.map(({ key }) => key)).toEqual(["", "Alimentation"]);
		expect(read.mappings.tags.map(({ key }) => key)).toEqual([""]);
	});

	it("refuses a file without accounts when no account is chosen, and a file that is no QIF", async () => {
		expect((await refusal(preview(["!Type:Bank", "D01/05/2026", "T-1", "PA", "^"]))).code).toBe(
			"QIF_ACCOUNT_REQUIRED",
		);
		expect((await refusal(preview(["Date,Amount", "2026-01-01,1"]))).code).toBe("QIF_INVALID");
	});
});

describe("publishing", () => {
	it("imports two accounts, their categories, tags and splits, every amount in minor units", async () => {
		const read = await preview(TWO_ACCOUNTS);

		expect(read.mappings.accounts).toEqual([
			{ key: "Carte QIF", count: 1, value: "internal_new_resource" },
			{ key: "Courant QIF", count: 3, value: "internal_new_resource" },
		]);
		expect(read.counts).toEqual({
			transactions: 4,
			trades: 0,
			categories: 3,
			tags: 3,
			accounts: 2,
		});

		await publish(TWO_ACCOUNTS);

		const created = await rows<{ name: string; type: string; opening: number; date: string }>(
			sql`select a.name, a.type, e.amount as opening, e.date from accounts a
				join entries e on e.account_id = a.id and e.valuation_kind = 'opening_anchor'
				order by a.name`,
		);

		expect(created).toEqual([
			{ name: "Carte QIF", type: "credit_card", opening: 0, date: "2026-01-06" },
			{ name: "Courant QIF", type: "depository", opening: 100000, date: "2026-01-02" },
		]);
		expect(await lines()).toEqual([
			{
				account: "Courant QIF",
				date: "2026-01-05",
				amount: -10000,
				label: "Supermarché",
				notes: null,
				category: null,
				tags: null,
				excluded: 1,
				parent: null,
			},
			{
				account: "Courant QIF",
				date: "2026-01-05",
				amount: -6000,
				label: "Fruits",
				notes: "Fruits",
				category: "Alimentation",
				tags: "Famille",
				excluded: 0,
				parent: -10000,
			},
			{
				account: "Courant QIF",
				date: "2026-01-05",
				amount: -4000,
				label: "Auto:Essence",
				notes: null,
				category: "Essence",
				tags: null,
				excluded: 0,
				parent: -10000,
			},
			{
				account: "Courant QIF",
				date: "2026-01-06",
				amount: -1250,
				label: "Café",
				notes: "Croissant",
				category: "Loisirs",
				tags: "Vacances|Été",
				excluded: 0,
				parent: null,
			},
			{
				account: "Carte QIF",
				date: "2026-01-07",
				amount: -3000,
				label: "Librairie",
				notes: null,
				category: "Loisirs",
				tags: null,
				excluded: 0,
				parent: null,
			},
			// Its lines sum to -80.00, not -90.00: one line at the total.
			{
				account: "Courant QIF",
				date: "2026-01-20",
				amount: -9000,
				label: "Courses",
				notes: null,
				category: null,
				tags: null,
				excluded: 0,
				parent: null,
			},
		]);

		const parents = await rows<{ name: string; parent: string | null }>(
			sql`select c.name, p.name as parent from categories c left join categories p on p.id = c.parent_id
				where c.name in ('Essence', 'Auto')`,
		);

		expect(parents).toEqual(
			expect.arrayContaining([
				{ name: "Auto", parent: null },
				{ name: "Essence", parent: "Auto" },
			]),
		);

		const sources = await rows<{ source: string }>(sql`select source from imports order by source`);

		expect(sources).toEqual([{ source: "qif" }, { source: "qif" }]);
	});

	it("puts each account's lines on the account it maps to, and the account-less ones on the chosen one", async () => {
		const courant = await openOwn({ name: "Courant QIF" });
		const autre = await openOwn({ name: "Autre" });
		const file = ["!Type:Bank", "D01/03/2026", "T-5.00", "PSans compte", "^", ...TWO_ACCOUNTS];
		const read = await preview(file, { configuration: { accountId: autre.id } });

		expect(read.mappings.accounts).toEqual([
			{ key: "Carte QIF", count: 1, value: "internal_new_resource" },
			{ key: "Courant QIF", count: 3, value: courant.id },
		]);

		await publish(file, {
			configuration: { accountId: autre.id },
			mappings: { accounts: [{ key: "Carte QIF", value: autre.id }] },
		});

		const byAccount = await rows<{ account: string; count: number }>(
			sql`select a.name as account, count(*) as count from entries e join accounts a on a.id = e.account_id
				where e.kind = 'transaction' and e.parent_entry_id is null group by a.name order by a.name`,
		);

		expect(byAccount).toEqual([
			{ account: "Autre", count: 2 },
			{ account: "Courant QIF", count: 3 },
		]);
	});

	it("imports buys and sales as trades, dividends and transfers as lines of the investment account", async () => {
		const file = [
			"!Account",
			"NPEA QIF",
			"TInvst",
			"^",
			"!Type:Security",
			"NApple Inc.",
			"SAAPL",
			"^",
			"!Type:Invst",
			"D02/03/2026",
			"NXIn",
			"T2000",
			"^",
			"D02/04/2026",
			"NBuy",
			"YApple Inc.",
			"I15",
			"Q10",
			"T155",
			"^",
			"D02/10/2026",
			"NSell",
			"YApple Inc.",
			"I20",
			"Q4",
			"T78",
			"^",
			"D02/15/2026",
			"NDiv",
			"YApple Inc.",
			"T12,50",
			"^",
			"D02/16/2026",
			"NMiscExp",
			"T3",
			"MFrais de garde",
			"^",
		];
		const read = await preview(file);

		expect(read.clean.columns).toEqual([
			"date",
			"account",
			"ticker",
			"qty",
			"price",
			"amount",
			"currency",
			"name",
		]);
		expect(read.clean.rows[2]?.values).toEqual([
			"2026-02-10",
			"PEA QIF",
			"AAPL",
			"-4",
			"20",
			"78",
			"",
			"Vente de 4 actions AAPL",
		]);
		expect(read.counts).toMatchObject({ transactions: 3, trades: 2, accounts: 1 });

		await publish(file);

		const trades = await rows<{ amount: number; quantity: string; price: string; fee: number }>(
			sql`select e.amount, t.quantity, t.price, t.fee from entries e join trades t on t.entry_id = e.id
				order by e.date`,
		);

		expect(trades).toEqual([
			{ amount: -15500, quantity: "10", price: "15", fee: 500 },
			{ amount: 7800, quantity: "-4", price: "20", fee: 200 },
		]);
		expect(
			(await lines()).map(({ account, amount, label }) => ({ account, amount, label })),
		).toEqual([
			{ account: "PEA QIF", amount: 200000, label: "Virement entrant" },
			{ account: "PEA QIF", amount: 1250, label: "Dividende : Apple Inc." },
			{ account: "PEA QIF", amount: -300, label: "Frais de garde" },
		]);

		const [pea] = await rows<{ type: string }>(
			sql`select type from accounts where name = 'PEA QIF'`,
		);

		expect(pea?.type).toBe("investment");
	});

	it("refuses a trade on an account that takes none", async () => {
		const courant = await openOwn({ name: "Courant" });
		const read = await preview(
			["!Type:Invst", "D02/04/2026", "NBuy", "YAAPL", "I15", "Q10", "T150", "^"],
			{ configuration: { accountId: courant.id } },
		);

		expect(read.errors.map(({ code }) => code)).toEqual(["trades_not_supported"]);
	});

	it("keeps an unreadable date on its row, fixed in « Nettoyer »", async () => {
		const courant = await openOwn({ name: "Courant" });
		const file = ["!Type:Bank", "D13/45/2026", "T-5.00", "PBoulangerie", "^"];
		const read = await preview(file, { configuration: { accountId: courant.id } });

		expect(read.clean.rows[0]?.values[0]).toBe("13/45/2026");
		expect(read.errors.map(({ code }) => code)).toEqual(["invalid_date"]);

		await publish(file, {
			configuration: { accountId: courant.id },
			edits: [{ line: 1, key: "date", value: "2026-04-13" }],
		});

		expect((await lines()).map(({ date, amount }) => ({ date, amount }))).toEqual([
			{ date: "2026-04-13", amount: -500 },
		]);
	});
});

/** A split record whose line carries a tag, its second split line bare. */
const splitRecord = (splitTags: string) => [
	"!Type:Bank",
	"D01/05/2026",
	"T-100.00",
	"PSupermarché",
	"LCourses/Vacances",
	`SAlimentation${splitTags}`,
	"$-60.00",
	"S",
	"$-40.00",
	"^",
];

describe("review cases", () => {
	it("maps the rows of a section before any account, when none is chosen", async () => {
		const autre = await openOwn({ name: "Autre" });
		const file = ["!Type:Bank", "D01/03/2026", "T-5.00", "PSans compte", "^", ...TWO_ACCOUNTS];
		const read = await preview(file);

		expect(read.mappings.accounts[0]).toEqual({ key: "", count: 1, value: null });
		expect(read.errors).toEqual([{ code: "unmapped_account", params: { key: "" } }]);

		await publish(file, { mappings: { accounts: [{ key: "", value: autre.id }] } });

		expect((await lines()).filter((line) => line.account === "Autre")).toHaveLength(1);
	});

	it("opens a new card at what its « Opening Balance » says it owes", async () => {
		await publish([
			"!Account",
			"NCarte QIF",
			"TCCard",
			"^",
			"!Type:CCard",
			"D01/02/2026",
			"T-500.00",
			"POpening Balance",
			"^",
			"D01/05/2026",
			"T-20.00",
			"PLibrairie",
			"^",
		]);

		const [opening] = await rows<{ amount: number }>(
			sql`select e.amount from entries e where e.valuation_kind = 'opening_anchor'`,
		);

		expect(opening?.amount).toBe(50000);
	});

	it("offers no account a bank feeds", async () => {
		const linked = await openOwn({ name: "Courant QIF" });
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
		await db().update(accounts).set({ bankAccountId }).where(eq(accounts.id, linked.id));

		const read = await preview(TWO_ACCOUNTS, {
			mappings: { accounts: [{ key: "Courant QIF", value: linked.id }] },
		});

		expect(read.mappings.accounts).toContainEqual({ key: "Courant QIF", count: 3, value: null });
	});

	it("gives a split line without tags or memo the line's tags and label, and refuses too many tags", async () => {
		const courant = await openOwn({ name: "Courant" });

		await publish(splitRecord(""), { configuration: { accountId: courant.id } });

		expect(
			(await lines())
				.filter((line) => line.parent !== null)
				.map(({ label, tags, category }) => ({
					label,
					tags,
					category,
				})),
		).toEqual([
			{ label: "Alimentation", tags: "Vacances", category: "Alimentation" },
			{ label: "Supermarché", tags: "Vacances", category: null },
		]);

		const many = `/${Array.from({ length: 51 }, (_, index) => `T${index}`).join(":")}`;
		const refused = await preview(splitRecord(many), { configuration: { accountId: courant.id } });

		expect(refused.errors.map(({ code }) => code)).toContain("too_many_tags");
	});

	it("reverts an import with its split lines, and moves an existing account's opening date", async () => {
		const courant = await openOwn({ name: "Courant QIF", openingDate: "2026-03-01" });

		await publish(TWO_ACCOUNTS);

		const [opening] = await rows<{ date: string }>(
			sql`select date from entries where account_id = ${courant.id} and valuation_kind = 'opening_anchor'`,
		);

		expect(opening?.date).toBe("2026-01-04");

		const [made] = await rows<{ id: string }>(
			sql`select id from imports where account_id = ${courant.id}`,
		);

		await revertImport(deps(), made?.id ?? "", { origin: "user" });

		expect((await lines()).filter((line) => line.account === "Courant QIF")).toEqual([]);
	});

	it("reads a mixed file's trades under the bank columns, a `Port` account as investment, and a cash action without total at zero", async () => {
		const file = [
			"!Account",
			"NCourant QIF",
			"TBank",
			"^",
			"!Type:Bank",
			"D02/01/2026",
			"T-5.00",
			"PBoulangerie",
			"^",
			"!Account",
			"NPortefeuille",
			"TPort",
			"^",
			"!Type:Invst",
			"D02/04/2026",
			"NBuy",
			"YAAPL",
			"I15",
			"Q1,000",
			"T15000",
			"^",
			"D02/05/2026",
			"NShrsIn",
			"YAAPL",
			"Q5",
			"^",
		];
		const read = await preview(file);

		expect(read.clean.columns).toEqual([
			"date",
			"account",
			"amount",
			"name",
			"currency",
			"category",
			"tags",
			"notes",
			"ticker",
			"qty",
			"price",
		]);
		expect(read.errors).toEqual([]);

		await publish(file);

		const [portfolio] = await rows<{ type: string }>(
			sql`select type from accounts where name = 'Portefeuille'`,
		);
		const [trade] = await rows<{ quantity: string }>(sql`select quantity from trades`);

		expect(portfolio?.type).toBe("investment");
		expect(trade?.quantity).toBe("1000");
		expect(
			(await lines()).filter((line) => line.account === "Portefeuille").map(({ amount }) => amount),
		).toEqual([0]);
	});

	it("leaves the fee at zero when a total is below quantity × price, or missing", async () => {
		await publish([
			"!Account",
			"NPEA QIF",
			"TInvst",
			"^",
			"!Type:Invst",
			"D02/04/2026",
			"NBuy",
			"YAAPL",
			"I15",
			"Q10",
			"T140",
			"^",
			"D02/05/2026",
			"NSell",
			"YAAPL",
			"I20",
			"Q2",
			"^",
		]);

		expect(
			await rows<{ amount: number; fee: number }>(
				sql`select e.amount, t.fee from entries e join trades t on t.entry_id = e.id order by e.date`,
			),
		).toEqual([
			{ amount: -15000, fee: 0 },
			{ amount: 4000, fee: 0 },
		]);
	});

	it("creates other assets and liabilities, and every account the file names, a line or not", async () => {
		await publish([
			"!Account",
			"NPrêt QIF",
			"TOth L",
			"^",
			"!Type:Oth L",
			"D01/02/2026",
			"T-1,000.00",
			"POpening Balance",
			"^",
			"D01/20/2026",
			"T100.00",
			"PÉchéance",
			"^",
			"!Account",
			"NMaison QIF",
			"TOth A",
			"^",
			"!Type:Oth A",
			"D01/03/2026",
			"T250000.00",
			"POpening Balance",
			"^",
		]);

		expect(
			await rows<{ name: string; type: string; opening: number; date: string }>(
				sql`select a.name, a.type, e.amount as opening, e.date from accounts a
					join entries e on e.account_id = a.id and e.valuation_kind = 'opening_anchor'
					order by a.name`,
			),
		).toEqual([
			{ name: "Maison QIF", type: "other_asset", opening: 25000000, date: "2026-01-03" },
			{ name: "Prêt QIF", type: "other_liability", opening: 100000, date: "2026-01-02" },
		]);
	});

	it("labels a split line by its category as written, even unchecked", async () => {
		const courant = await openOwn({ name: "Courant" });

		await publish(splitRecord(""), {
			configuration: { accountId: courant.id, qifCategories: [], qifTags: [] },
		});

		expect(
			(await lines())
				.filter((line) => line.parent !== null)
				.map(({ label, tags, category }) => ({ label, tags, category })),
		).toEqual([
			{ label: "Alimentation", tags: null, category: null },
			{ label: "Supermarché", tags: null, category: null },
		]);
	});
});
