import type { NormalizedTransaction, ParsedStatement } from "../domain/statement.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput, Origin } from "./ledger.ts";

import { and, eq, gt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";
import { transactions } from "@archant/data/schema/transactions";

import * as forward from "../domain/balances/forward.ts";
import { addDays } from "../domain/dates.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import {
	balanceOn,
	balancesBetween,
	createAccount,
	deleteAccount,
	deleteSnapshot,
	deleteTransaction,
	findSnapshot,
	findTransaction,
	importOrigins,
	ingest,
	listSnapshots,
	listTransactions,
	openingDateOf,
	sumTransactions,
	recordSnapshot,
	updateSnapshot,
	updateTransaction,
} from "./ledger.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

const checking: NewAccountInput = {
	name: "Compte joint",
	type: "depository",
	subtype: "checking",
	currency: "EUR",
	openingBalance: toMinorUnits(123456),
	openingDate: "2026-09-01",
};

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function setToday(isoDateTime: string) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(isoDateTime));
}

describe("createAccount", () => {
	it("stores the account, one opening anchor and a balance for every day up to today", async () => {
		setToday("2026-09-21T10:00:00Z");

		const account = await createAccount(deps(), checking, { origin: "user" });

		const stored = await temp.db.select().from(accounts).where(eq(accounts.id, account.id)).get();
		expect(stored).toMatchObject({
			name: "Compte joint",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
		});

		const anchors = await temp.db.select().from(entries).where(eq(entries.accountId, account.id));
		expect(anchors).toEqual([
			expect.objectContaining({
				kind: "valuation",
				valuationKind: "opening_anchor",
				date: "2026-09-01",
				amount: 123456,
				currency: "EUR",
			}),
		]);

		const days = await temp.db
			.select()
			.from(balances)
			.where(eq(balances.accountId, account.id))
			.orderBy(balances.date);
		expect(days).toHaveLength(21);
		expect(days[0]).toMatchObject({ date: "2026-09-01", balance: 123456, currency: "EUR" });
		expect(days.at(-1)).toMatchObject({ date: "2026-09-21", balance: 123456 });
	});

	it("takes today in the application time zone, not in UTC", async () => {
		// 23:30 UTC on the 21st is already the 22nd in Paris.
		setToday("2026-09-21T23:30:00Z");

		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-09-22")).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
		const last = await temp.db
			.select()
			.from(balances)
			.where(eq(balances.accountId, account.id))
			.orderBy(balances.date);
		expect(last.at(-1)?.date).toBe("2026-09-22");
	});

	it("writes a long history in several statements", async () => {
		setToday("2026-09-21T10:00:00Z");

		const account = await createAccount(
			deps(),
			{ ...checking, openingDate: "2023-01-01" },
			{ origin: "user" },
		);

		const days = await temp.db.select().from(balances).where(eq(balances.accountId, account.id));
		expect(days).toHaveLength(1360);
	});

	it("keeps a credit card's amount owed as a positive stored balance", async () => {
		setToday("2026-09-21T10:00:00Z");

		const card = await createAccount(
			deps(),
			{
				...checking,
				name: "Carte",
				type: "credit_card",
				subtype: null,
				openingBalance: toMinorUnits(49030),
				openingDate: "2026-09-21",
			},
			{ origin: "user" },
		);

		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toEqual({
			amount: 49030,
			currency: "EUR",
		});
	});

	it("writes nothing when the last step fails", async () => {
		setToday("2026-09-21T10:00:00Z");
		const accountsBefore = await temp.db.select().from(accounts);
		const entriesBefore = await temp.db.select().from(entries);
		// Two rows for one day break the balances primary key, after the account
		// and its opening anchor are already inserted.
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(createAccount(deps(), checking, { origin: "user" })).rejects.toThrow();

		await expect(temp.db.select().from(accounts)).resolves.toEqual(accountsBefore);
		await expect(temp.db.select().from(entries)).resolves.toEqual(entriesBefore);
	});
});

describe("balanceOn", () => {
	it("carries the last stored day forward past today", async () => {
		setToday("2026-09-21T10:00:00Z");
		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-12-31")).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
	});

	it("is null before the opening date", async () => {
		setToday("2026-09-21T10:00:00Z");
		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-08-31")).resolves.toBeNull();
	});
});

const line = (overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction => ({
	externalId: null,
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	currency: "EUR",
	label: "Boulangerie",
	notes: null,
	...overrides,
});

async function openChecking(overrides: Partial<NewAccountInput> = {}) {
	setToday("2026-09-21T10:00:00Z");

	return createAccount(deps(), { ...checking, ...overrides }, { origin: "user" });
}

async function add(
	accountId: string,
	overrides: Partial<NormalizedTransaction> = {},
	origin: Origin = "user",
) {
	const result = await ingest(
		deps(),
		accountId,
		{ transactions: [line(overrides)], rejected: [] },
		{ manual: true },
		{ origin },
	);
	const [id] = result.created;

	if (id === undefined) {
		throw new Error(`Line rejected: ${JSON.stringify(result.rejected)}`);
	}

	return id;
}

async function history(accountId: string) {
	const rows = await temp.db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(eq(balances.accountId, accountId))
		.orderBy(balances.date);

	return new Map(rows.map((row) => [row.date, row.balance]));
}

async function lockedFields(entryId: string) {
	const row = await temp.db
		.select({ locked: transactions.lockedFields })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.locked;
}

describe("ingest", () => {
	it("records an expense and recomputes the balance from its date", async () => {
		const account = await openChecking();

		const id = await add(account.id);

		await expect(findTransaction(deps(), id)).resolves.toEqual({
			id,
			accountId: account.id,
			date: "2026-09-10",
			amount: -4290,
			currency: "EUR",
			label: "Boulangerie",
			notes: null,
			excluded: false,
		});
		const days = await history(account.id);
		expect(days.size).toBe(21);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119166);
		expect(days.get("2026-09-21")).toBe(119166);
	});

	it("raises a card's amount owed on a purchase", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});

		await add(card.id, { amount: toMinorUnits(-3000) });

		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toEqual({
			amount: 52030,
			currency: "EUR",
		});
	});

	it("locks every field a user filled, notes included when present", async () => {
		const account = await openChecking();

		const withoutNotes = await add(account.id);
		const withNotes = await add(account.id, { notes: "Pour dimanche" });

		await expect(lockedFields(withoutNotes)).resolves.toEqual(["date", "amount", "label"]);
		await expect(lockedFields(withNotes)).resolves.toEqual(["date", "amount", "label", "notes"]);
	});

	it("locks nothing for any other origin", async () => {
		const account = await openChecking();

		const id = await add(account.id, {}, "sync");

		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("rejects lines on or before the opening day, too far ahead or in another currency", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({ date: "2026-09-01" }),
					line({ date: "2026-08-31" }),
					line({ date: "2027-09-23" }),
					line({ currency: "USD" }),
				],
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		expect(result).toMatchObject({
			created: [],
			rejected: [
				{ ref: "0", reason: "BEFORE_OPENING_DATE" },
				{ ref: "1", reason: "BEFORE_OPENING_DATE" },
				{ ref: "2", reason: "DATE_TOO_LATE" },
				{ ref: "3", reason: "CURRENCY_MISMATCH" },
			],
		});
		await expect(history(account.id)).resolves.toEqual(before);
		await expect(
			listTransactions(deps(), { accountIds: [account.id] }, { page: 1, pageSize: 50 }),
		).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	it("keeps the accepted lines of a statement and reports the others", async () => {
		const account = await openChecking();

		const result = await ingest(
			deps(),
			account.id,
			{ transactions: [line({ date: "2026-09-01" }), line({ date: "2026-09-15" })], rejected: [] },
			{ manual: true },
			{ origin: "user" },
		);

		expect(result.created).toHaveLength(1);
		expect(result.rejected).toEqual([{ ref: "0", reason: "BEFORE_OPENING_DATE" }]);
		await expect(balanceOn(deps(), account.id, "2026-09-14")).resolves.toMatchObject({
			amount: 123456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toMatchObject({
			amount: 119166,
		});
	});

	it("adds up several transactions on one day, from one statement or several", async () => {
		const account = await openChecking();
		await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({ date: "2026-09-10", amount: toMinorUnits(-4290) }),
					line({ date: "2026-09-10", amount: toMinorUnits(10000) }),
				],
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(128166);
		expect(days.get("2026-09-21")).toBe(128166);
	});

	it("replays the later transactions when an earlier one is recorded", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(-1000) });

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-4290) });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(119166);
		expect(days.get("2026-09-15")).toBe(118166);
		expect(days.get("2026-09-21")).toBe(118166);
	});

	it("extends the history to a transaction dated after today", async () => {
		const account = await openChecking();

		await add(account.id, { date: "2026-10-05" });

		const days = await history(account.id);
		expect([...days.keys()].at(-1)).toBe("2026-10-05");
		expect(days.get("2026-10-04")).toBe(123456);
		expect(days.get("2026-10-05")).toBe(119166);
	});

	it("refuses an account that does not exist", async () => {
		setToday("2026-09-21T10:00:00Z");

		await expect(
			ingest(
				deps(),
				"nope",
				{ transactions: [line()], rejected: [] },
				{ manual: true },
				{ origin: "user" },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves no row behind when the recompute fails", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(
			ingest(
				deps(),
				account.id,
				{ transactions: [line()], rejected: [] },
				{ manual: true },
				{ origin: "user" },
			),
		).rejects.toThrow();

		const stored = await temp.db
			.select()
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.kind, "transaction")));
		expect(stored).toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
	});
});

// Story 2.1: the keyed path of `ingest`, as an import drives it.

/** A previewed import row, as `services/imports.ts` stores it before the first preview. */
async function previewRow(accountId: string, db = temp.db): Promise<string> {
	const id = crypto.randomUUID();

	await db.insert(imports).values({
		id,
		accountId,
		source: "ofx",
		fileName: "releve.ofx",
		status: "previewed",
		content: Buffer.from("OFXHEADER:100"),
		options: {},
		createdAt: Date.now(),
	});

	return id;
}

const statementOf = (...lines: NormalizedTransaction[]): ParsedStatement => ({
	transactions: lines,
	rejected: [],
});

type ImportOptions = { moveOpeningDate?: string; db?: TempDatabase["db"] };

/** Previews a statement, stores the digest as the service does, and returns the preview. */
async function preview(
	accountId: string,
	statement: ParsedStatement,
	options: ImportOptions & { importId?: string } = {},
) {
	const db = options.db ?? temp.db;
	const importId = options.importId ?? (await previewRow(accountId, db));
	const result = await ingest(
		{ db, timeZone: "Europe/Paris" },
		accountId,
		statement,
		{ importId },
		{ origin: "sync", dryRun: true, moveOpeningDate: options.moveOpeningDate },
	);

	await db.update(imports).set({ previewDigest: result.digest }).where(eq(imports.id, importId));

	return { importId, result };
}

async function confirm(
	accountId: string,
	importId: string,
	statement: ParsedStatement,
	options: ImportOptions = {},
) {
	return ingest(
		{ db: options.db ?? temp.db, timeZone: "Europe/Paris" },
		accountId,
		statement,
		{ importId },
		{ origin: "sync", moveOpeningDate: options.moveOpeningDate },
	);
}

/** Previews then confirms, as the interface does when nothing changed in between. */
async function importStatement(
	accountId: string,
	statement: ParsedStatement,
	options: ImportOptions = {},
) {
	const { importId } = await preview(accountId, statement, options);

	return { importId, result: await confirm(accountId, importId, statement, options) };
}

async function keysOf(entryId: string) {
	const rows = await temp.db
		.select({ key: entryKeys.key, importId: entryKeys.importId })
		.from(entryKeys)
		.where(eq(entryKeys.entryId, entryId));

	return rows.map((row) => row.key).toSorted();
}

async function transactionCount(accountId: string) {
	const rows = await temp.db
		.select({ id: entries.id })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "transaction")));

	return rows.length;
}

const counts = (result: Awaited<ReturnType<typeof ingest>>) => ({
	created: result.groups.created.length,
	present: result.groups.present.length,
	matched: result.groups.matched.length,
	duplicates: result.groups.duplicates.length,
	rejected: result.groups.rejected.length,
});

const cafe = line({
	externalId: "F1",
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	label: "CB Café",
});
const salary = line({
	externalId: "F2",
	date: "2026-09-12",
	amount: toMinorUnits(215000),
	label: "VIR SALAIRE",
});

describe("ingest from an import", () => {
	it("previews the groups without writing anything", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const { result } = await preview(account.id, statementOf(cafe, salary));

		expect(result.groups.created).toEqual([
			{ ref: "0", date: "2026-09-10", amount: -4290, label: "CB Café", entryId: null },
			{ ref: "1", date: "2026-09-12", amount: 215000, label: "VIR SALAIRE", entryId: null },
		]);
		expect(counts(result)).toEqual({
			created: 2,
			present: 0,
			matched: 0,
			duplicates: 0,
			rejected: 0,
		});
		expect(result.created).toEqual([]);
		expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
		expect(result.openingSuggestion).toBeNull();
		expect(result.opening).toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("confirms: writes the lines with their keys, marks the import and moves the balance", async () => {
		const account = await openChecking();

		const { importId, result } = await importStatement(account.id, statementOf(cafe, salary));

		expect(result.created).toHaveLength(2);
		const [cafeId = "", salaryId = ""] = result.created;
		await expect(findTransaction(deps(), cafeId)).resolves.toMatchObject({
			date: "2026-09-10",
			amount: -4290,
			label: "CB Café",
		});
		await expect(keysOf(cafeId)).resolves.toEqual([
			expect.stringMatching(/^ext:F1$/u),
			expect.stringMatching(/^fp:[0-9a-f]{64}$/u),
		]);
		await expect(keysOf(salaryId)).resolves.toHaveLength(2);
		await expect(lockedFields(cafeId)).resolves.toEqual([]);
		const stored = await temp.db.select().from(imports).where(eq(imports.id, importId)).get();
		expect(stored).toMatchObject({
			status: "confirmed",
			counts: { created: 2, present: 0, matched: 0, duplicates: 0, rejected: 0 },
		});
		expect(typeof stored?.confirmedAt).toBe("number");
		expect(stored?.content).toHaveLength(0);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
	});

	it("gives two previews that differ only in the opening they would write different digests", async () => {
		const account = await openChecking();

		const kept = await preview(account.id, statementOf(cafe));
		const moved = await preview(account.id, statementOf(cafe), { moveOpeningDate: "2026-08-20" });

		expect(moved.result.groups).toEqual(kept.result.groups);
		expect(moved.result.opening).toEqual({ date: "2026-08-20", balance: 123456 });
		expect(moved.result.digest).not.toBe(kept.result.digest);
	});

	it("recognises every line of the same file on re-import", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe, salary));

		const { importId, result } = await preview(account.id, statementOf(cafe, salary));

		expect(counts(result)).toMatchObject({ created: 0, present: 2 });
		expect(result.groups.present.map((item) => item.entryId)).toEqual([
			expect.any(String),
			expect.any(String),
		]);
		await confirm(account.id, importId, statementOf(cafe, salary));
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("recognises a bank re-export with new FITIDs through the fingerprint", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));

		const { result } = await preview(
			account.id,
			statementOf({ ...cafe, externalId: "NEW", label: "CB CAFE" }),
		);

		expect(counts(result)).toMatchObject({ created: 0, present: 1 });
	});

	it("recognises a line by its FITID when the bank changed its label", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));

		const { result } = await preview(
			account.id,
			statementOf({ ...cafe, label: "CARTE CAFE GARE" }),
		);

		expect(counts(result)).toMatchObject({ created: 0, present: 1 });
	});

	it("creates two identical lines of one day, and recognises both on re-import", async () => {
		const account = await openChecking();
		const bread = line({ date: "2026-09-10", amount: toMinorUnits(-350), label: "CB BOULANGERIE" });

		const first = await importStatement(account.id, statementOf(bread, bread));
		const again = await preview(account.id, statementOf(bread, bread));

		expect(first.result.created).toHaveLength(2);
		expect(counts(again.result)).toMatchObject({ created: 0, present: 2 });
	});

	it("still recognises an imported line after its label and amount were edited", async () => {
		const account = await openChecking();
		const { result } = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = result.created;
		await updateTransaction(
			deps(),
			id,
			{ label: "Café du matin", amount: toMinorUnits(-5000) },
			{ origin: "user" },
		);

		const again = await preview(account.id, statementOf(cafe));

		expect(counts(again.result)).toMatchObject({ created: 0, present: 1 });
	});

	it("pairs a manual twin two days away, attaches the keys and changes nothing else", async () => {
		const account = await openChecking();
		const manual = await add(account.id, {
			date: "2026-09-03",
			amount: toMinorUnits(-4290),
			label: "Café",
		});
		const before = await history(account.id);
		const fileLine = line({
			externalId: "F9",
			date: "2026-09-05",
			amount: toMinorUnits(-4290),
			label: "CB CAFE GARE",
		});

		const { result } = await importStatement(account.id, statementOf(fileLine));

		expect(result.groups.matched).toEqual([expect.objectContaining({ ref: "0", entryId: manual })]);
		expect(result.created).toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(findTransaction(deps(), manual)).resolves.toMatchObject({
			date: "2026-09-03",
			label: "Café",
			amount: -4290,
		});
		await expect(lockedFields(manual)).resolves.toEqual(["date", "amount", "label"]);
		await expect(keysOf(manual)).resolves.toHaveLength(2);
		await expect(history(account.id)).resolves.toEqual(before);
		// Recognised next time, as the confirm label promised.
		expect(counts((await preview(account.id, statementOf(fileLine))).result)).toMatchObject({
			present: 1,
		});
	});

	it("creates a line with two equally near candidates and flags it a possible duplicate", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });

		const { result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);

		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1, matched: 0 });
		const [id = ""] = result.created;
		const row = await temp.db.select().from(transactions).where(eq(transactions.entryId, id)).get();
		expect(row?.possibleDuplicate).toBe(true);
		await expect(transactionCount(account.id)).resolves.toBe(3);
	});

	it("never pairs with an entry this source already keyed, nor one 4 days away", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));
		const manual = await add(account.id, { date: "2026-09-16", amount: toMinorUnits(-4290) });
		await add(account.id, { date: "2026-09-19", amount: toMinorUnits(-777) });

		const { result } = await preview(
			account.id,
			statementOf(
				line({ date: "2026-09-11", amount: toMinorUnits(-4290), label: "Autre café" }),
				line({ date: "2026-09-19", amount: toMinorUnits(-4290), label: "Encore un café" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-777), label: "Parking" }),
			),
		);

		expect(counts(result)).toMatchObject({ created: 2, matched: 1 });
		expect(result.groups.created.map((item) => item.ref)).toEqual(["0", "2"]);
		expect(result.groups.matched).toEqual([expect.objectContaining({ ref: "1", entryId: manual })]);
	});

	it("writes a FITID shared by two lines of one file once, on the first", async () => {
		const account = await openChecking();

		const { result } = await importStatement(
			account.id,
			statementOf(cafe, { ...cafe, label: "CB Café bis" }),
		);

		const [first = "", second = ""] = result.created;
		await expect(keysOf(first)).resolves.toEqual(["ext:F1", expect.stringMatching(/^fp:/u)]);
		await expect(keysOf(second)).resolves.toEqual([expect.stringMatching(/^fp:/u)]);
	});

	it("reports the source's unreadable lines with the ledger's refusals", async () => {
		const account = await openChecking();

		const { result } = await importStatement(account.id, {
			transactions: [line({ date: "2026-09-01" }), cafe],
			rejected: [{ ref: "3", reason: "INVALID_AMOUNT" }],
		});

		expect(result.groups.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT", line: null },
			{
				ref: "0",
				reason: "BEFORE_OPENING_DATE",
				line: { date: "2026-09-01", amount: -4290, label: "Boulangerie" },
			},
		]);
		expect(result.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT" },
			{ ref: "0", reason: "BEFORE_OPENING_DATE" },
		]);
		expect(result.openingSuggestion).toBe("2026-08-31");
	});

	it("refuses a confirm when the account changed since the preview, writing nothing", async () => {
		const account = await openChecking();
		const { importId } = await preview(account.id, statementOf(cafe, salary));
		await add(account.id, { date: "2026-09-11", amount: toMinorUnits(-4290), label: "Café" });
		const before = await history(account.id);

		await expect(confirm(account.id, importId, statementOf(cafe, salary))).rejects.toMatchObject({
			code: "IMPORT_PREVIEW_STALE",
		});

		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(history(account.id)).resolves.toEqual(before);
		const stored = await temp.db.select().from(imports).where(eq(imports.id, importId)).get();
		expect(stored?.status).toBe("previewed");
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.importId, importId)),
		).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an import already confirmed, unknown, or of another account", async () => {
		const account = await openChecking();
		const other = await openChecking();
		const { importId } = await importStatement(account.id, statementOf(cafe));
		const pending = await previewRow(other.id);

		await expect(confirm(account.id, importId, statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(confirm(account.id, "nope", statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(confirm(account.id, pending, statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("ignores an opening date that is not earlier than the account's", async () => {
		const account = await openChecking();

		const { result } = await preview(account.id, statementOf(cafe), {
			moveOpeningDate: "2026-09-05",
		});

		expect(result.opening).toBeNull();
		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
	});

	it("moves an asset's opening back, keeping the old opening day's balance and today's", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });
		const today = await balanceOn(deps(), account.id, "2026-09-21");
		const lines = statementOf(
			line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
			line({ date: "2026-09-01", amount: toMinorUnits(5000), label: "Remboursement" }),
			line({ date: "2026-09-15", amount: toMinorUnits(-300), label: "Pain" }),
		);
		const first = await preview(account.id, lines);

		expect(first.result.openingSuggestion).toBe("2026-08-19");
		expect(counts(first.result)).toMatchObject({ created: 1, rejected: 2 });

		const moved = await importStatement(account.id, lines, { moveOpeningDate: "2026-08-19" });

		expect(counts(moved.result)).toMatchObject({ created: 3, rejected: 0 });
		// 1 234,56 − (−20,00 + 50,00): the old opening day still ends at 1 234,56.
		expect(moved.result.opening).toEqual({ date: "2026-08-19", balance: 123456 - 3000 });
		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-19");
		await expect(balanceOn(deps(), account.id, "2026-08-19")).resolves.toMatchObject({
			amount: 120456,
		});
		await expect(balanceOn(deps(), account.id, "2026-08-20")).resolves.toMatchObject({
			amount: 118456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-01")).resolves.toMatchObject({
			amount: 123456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: (today?.amount ?? 0) - 300,
		});
	});

	it("moves a credit card's opening back, keeping the amount owed on the old opening day", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(50000),
		});
		const lines = statementOf(
			line({ date: "2026-08-25", amount: toMinorUnits(-3000), label: "Achat" }),
		);

		const { result } = await importStatement(card.id, lines, { moveOpeningDate: "2026-08-24" });

		// 500,00 owed − 30,00 bought after the new opening: 470,00 owed then.
		expect(result.opening).toEqual({ date: "2026-08-24", balance: 47000 });
		await expect(balanceOn(deps(), card.id, "2026-08-25")).resolves.toMatchObject({
			amount: 50000,
		});
		await expect(balanceOn(deps(), card.id, "2026-09-01")).resolves.toMatchObject({
			amount: 50000,
		});
	});

	it("imports 5,000 lines in chunks, then recognises all of them", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			const lines = statementOf(
				...Array.from({ length: 5000 }, (_, index) =>
					line({
						externalId: `F${index}`,
						date: addDays("2016-01-02", index % 3800),
						amount: toMinorUnits(-(index + 1)),
						label: `Opération ${index}`,
					}),
				),
			);
			const started = performance.now();

			const { result } = await importStatement(account.id, lines, { db: big.db });

			expect(performance.now() - started).toBeLessThan(10_000);
			expect(result.created).toHaveLength(5000);
			const again = await preview(account.id, lines, { db: big.db });
			expect(counts(again.result)).toMatchObject({ created: 0, present: 5000 });
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("importOrigins", () => {
	it("names the import behind each imported entry and leaves manual ones out", async () => {
		const account = await openChecking();
		const manual = await add(account.id);
		const { result } = await importStatement(account.id, statementOf(salary));
		const [imported = ""] = result.created;

		const origins = await importOrigins(deps(), [manual, imported]);

		expect([...origins.keys()]).toEqual([imported]);
		expect(origins.get(imported)?.source).toBe("ofx");
		expect(typeof origins.get(imported)?.confirmedAt).toBe("number");
		await expect(importOrigins(deps(), [])).resolves.toEqual(new Map());
	});
});

describe("deleting imported transactions", () => {
	it("deletes a transaction's keys with it, so re-importing brings it back", async () => {
		const account = await openChecking();
		const { result } = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = result.created;

		await deleteTransaction(deps(), id, { origin: "user" });

		await expect(keysOf(id)).resolves.toEqual([]);
		expect(counts((await preview(account.id, statementOf(cafe))).result)).toMatchObject({
			created: 1,
		});
	});

	it("deletes an account with its keys and imports", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));
		await previewRow(account.id);

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(
			temp.db.select().from(imports).where(eq(imports.accountId, account.id)),
		).resolves.toEqual([]);
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.accountId, account.id)),
		).resolves.toEqual([]);
	});
});

describe("updateTransaction", () => {
	it("moves and changes a transaction, recomputing from the earlier date and locking both fields", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(
				deps(),
				id,
				{ date: "2026-09-05", amount: toMinorUnits(-5000), label: "Boulangerie" },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "updated" });

		const days = await history(account.id);
		expect(days.get("2026-09-04")).toBe(123456);
		expect(days.get("2026-09-05")).toBe(118456);
		expect(days.get("2026-09-10")).toBe(118456);
		expect(days.get("2026-09-21")).toBe(118456);
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount"]);
	});

	it("moves a transaction later and restores the days it left", async () => {
		const account = await openChecking();
		const id = await add(account.id, { date: "2026-09-05" });

		await updateTransaction(deps(), id, { date: "2026-09-10" }, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(123456);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119166);
	});

	it("adds changed fields to those already locked, once each", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await updateTransaction(
			deps(),
			id,
			{ label: "Boulangerie Dupont", notes: "Pain" },
			{ origin: "user" },
		);

		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label", "notes"]);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie Dupont",
			notes: "Pain",
		});
	});

	it("never overwrites a locked field for another origin, nor locks what it changes", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await updateTransaction(
			deps(),
			id,
			{ label: "RULE LABEL", notes: "Catégorisé" },
			{ origin: "rule" },
		);

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			notes: "Catégorisé",
		});
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label"]);
	});

	it("writes nothing when no field changes", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const before = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { amount: toMinorUnits(-4290) }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			before,
		);
	});

	it("rejects a date on the opening day and changes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await expect(
			updateTransaction(deps(), id, { date: "2026-09-01" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ date: "2026-09-10" });
	});

	it("drops the rows past the new end when the latest transaction moves back", async () => {
		const account = await openChecking();
		const id = await add(account.id, { date: "2026-12-31" });

		await updateTransaction(deps(), id, { date: "2026-09-15" }, { origin: "user" });

		const days = await history(account.id);
		expect([...days.keys()].at(-1)).toBe("2026-09-21");
		expect(days.get("2026-09-15")).toBe(119166);
	});

	it("excludes a transaction from reports, locks the flag and leaves the balance alone", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const before = await history(account.id);

		await expect(
			updateTransaction(deps(), id, { excluded: true }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ excluded: true });
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label", "excluded"]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("never clears a locked exclusion for another origin", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await updateTransaction(deps(), id, { excluded: true }, { origin: "user" });

		await updateTransaction(deps(), id, { excluded: false }, { origin: "rule" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ excluded: true });
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(
			updateTransaction(deps(), "nope", { label: "x" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteTransaction", () => {
	it("removes the transaction and puts the balance back", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await deleteTransaction(deps(), id, { origin: "user" });

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(temp.db.select().from(entries).where(eq(entries.id, id))).resolves.toEqual([]);
		const days = await history(account.id);
		expect(new Set(days.values())).toEqual(new Set([123456]));
		expect(days.size).toBe(21);
	});

	it("keeps the later transactions deducted after deleting an earlier one", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(-1000) });
		const earlier = await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-4290) });

		await deleteTransaction(deps(), earlier, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(123456);
		expect(days.get("2026-09-15")).toBe(122456);
		expect(days.get("2026-09-21")).toBe(122456);
	});

	it("deletes the rows past the new end after removing the latest entry", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-10-15" });
		const future = await add(account.id, { date: "2026-12-31" });

		await deleteTransaction(deps(), future, { origin: "user" });

		const past = await temp.db
			.select()
			.from(balances)
			.where(and(eq(balances.accountId, account.id), gt(balances.date, "2026-10-15")));
		expect(past).toEqual([]);
		await expect(balanceOn(deps(), account.id, "2026-10-15")).resolves.toMatchObject({
			amount: 119166,
		});
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(deleteTransaction(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("listTransactions", () => {
	it("orders by date, then creation, then id, most recent first, and pages", async () => {
		const account = await openChecking();
		const first = await add(account.id, { date: "2026-09-12", label: "A" });
		setToday("2026-09-21T10:00:01Z");
		const second = await add(account.id, { date: "2026-09-12", label: "B" });
		const older = await add(account.id, { date: "2026-09-02", label: "C" });

		const all = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 1, pageSize: 50 },
		);
		const secondPage = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 2, pageSize: 2 },
		);

		expect(all.items.map((item) => item.id)).toEqual([second, first, older]);
		expect(all.total).toBe(3);
		expect(secondPage).toEqual({ items: [expect.objectContaining({ id: older })], total: 3 });
	});
});

// Two accounts of the I/O matrix of Story 1.5, each test with its own pair, so
// rows from other tests never match.
async function openPair() {
	const joint = await openChecking({ name: "Compte joint" });
	const card = await openChecking({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: toMinorUnits(0),
	});

	return { joint, card, accountIds: [joint.id, card.id] };
}

const labelsOf = (page: { items: { label: string }[] }) => page.items.map((item) => item.label);

describe("listTransactions across accounts", () => {
	it("lists every account's transactions most recent first, with the account's name", async () => {
		const { joint, card, accountIds } = await openPair();
		await add(joint.id, { date: "2026-09-02", label: "C1" });
		await add(card.id, { date: "2026-09-05", label: "K1" });
		await add(joint.id, { date: "2026-09-08", label: "C2" });
		await add(card.id, { date: "2026-09-11", label: "K2" });
		await add(joint.id, { date: "2026-09-14", label: "C3" });
		await add(card.id, { date: "2026-09-17", label: "K3" });

		const page = await listTransactions(deps(), { accountIds }, firstPage);

		expect(labelsOf(page)).toEqual(["K3", "C3", "K2", "C2", "K1", "C1"]);
		expect(page.total).toBe(6);
		expect(page.items[0]).toMatchObject({ accountId: card.id, accountName: "Carte" });
		expect(page.items[1]).toMatchObject({ accountId: joint.id, accountName: "Compte joint" });
	});

	it("lists every account when no account is named", async () => {
		const { joint } = await openPair();
		const label = `Partout ${crypto.randomUUID()}`;
		await add(joint.id, { label });

		const page = await listTransactions(deps(), { q: label }, firstPage);

		expect(labelsOf(page)).toEqual([label]);
	});

	it("combines account, dates and text, the text in the label or the notes", async () => {
		const { joint, card, accountIds } = await openPair();
		await add(joint.id, { date: "2026-09-02", label: "Carrefour", notes: null });
		await add(joint.id, { date: "2026-09-03", label: "Carrefour Market" });
		await add(joint.id, { date: "2026-09-05", label: "Épicerie", notes: "chez CARREFOUR" });
		await add(joint.id, { date: "2026-09-12", label: "Carrefour City" });
		await add(joint.id, { date: "2026-09-06", label: "Boulangerie" });
		await add(card.id, { date: "2026-09-06", label: "Carrefour" });

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id], from: "2026-09-03", to: "2026-09-10", q: "carre" },
			firstPage,
		);

		expect(labelsOf(page)).toEqual(["Épicerie", "Carrefour Market"]);
		expect(page.total).toBe(2);
		await expect(
			listTransactions(deps(), { accountIds, q: "carrefour" }, firstPage),
		).resolves.toMatchObject({ total: 5 });
	});

	it("matches %, _ and \\ in the text literally", async () => {
		const { joint } = await openPair();
		await add(joint.id, { label: "Remise 50%" });
		await add(joint.id, { label: "Remise 500" });
		await add(joint.id, { label: "Frais_bancaires" });
		await add(joint.id, { label: "Frais bancaires" });
		await add(joint.id, { label: "Dossier C:\\temp" });
		const accountIds = [joint.id];

		await expect(listTransactions(deps(), { accountIds, q: "50%" }, firstPage)).resolves.toEqual({
			items: [expect.objectContaining({ label: "Remise 50%" })],
			total: 1,
		});
		await expect(
			listTransactions(deps(), { accountIds, q: "s_b" }, firstPage),
		).resolves.toMatchObject({ items: [{ label: "Frais_bancaires" }] });
		await expect(
			listTransactions(deps(), { accountIds, q: ":\\t" }, firstPage),
		).resolves.toMatchObject({ items: [{ label: "Dossier C:\\temp" }] });
	});

	it("bounds the absolute amount, both ways", async () => {
		const { joint, accountIds } = await openPair();
		await add(joint.id, { label: "Dépense", amount: toMinorUnits(-4290) });
		await add(joint.id, { label: "Revenu", amount: toMinorUnits(4500) });
		await add(joint.id, { label: "Petite", amount: toMinorUnits(-1200) });
		await add(joint.id, { label: "Grosse", amount: toMinorUnits(-9000) });
		const range = (min: number | null, max: number | null) => ({
			accountIds,
			amounts: [
				{
					currency: "EUR",
					min: min === null ? null : toMinorUnits(min),
					max: max === null ? null : toMinorUnits(max),
				},
			],
		});

		const between = await listTransactions(deps(), range(4000, 5000), firstPage);
		const atLeast = await listTransactions(deps(), range(4290, null), firstPage);
		const atMost = await listTransactions(deps(), range(null, 4500), firstPage);
		const open = await listTransactions(deps(), range(null, null), firstPage);

		expect(labelsOf(between).toSorted()).toEqual(["Dépense", "Revenu"]);
		expect(labelsOf(atLeast).toSorted()).toEqual(["Dépense", "Grosse", "Revenu"]);
		expect(labelsOf(atMost).toSorted()).toEqual(["Dépense", "Petite", "Revenu"]);
		expect(open.total).toBe(4);
	});

	it("leaves out the currencies the amount bounds do not name", async () => {
		const { joint } = await openPair();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		await add(joint.id, { label: "Euros", amount: toMinorUnits(-4290) });
		await add(dollars.id, { label: "Dollars", amount: toMinorUnits(-4290), currency: "USD" });
		const amounts = [{ currency: "EUR", min: toMinorUnits(4000), max: toMinorUnits(5000) }];

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, dollars.id], amounts },
			firstPage,
		);

		expect(labelsOf(page)).toEqual(["Euros"]);
	});

	it("matches nothing for an empty account list or no currency left in range", async () => {
		const { joint, accountIds } = await openPair();
		await add(joint.id);

		await expect(listTransactions(deps(), { accountIds: [] }, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
		await expect(listTransactions(deps(), { accountIds, amounts: [] }, firstPage)).resolves.toEqual(
			{ items: [], total: 0 },
		);
		await expect(sumTransactions(deps(), { accountIds: [] })).resolves.toEqual([]);
	});

	it("is an empty page for an unknown account", async () => {
		await expect(listTransactions(deps(), { accountIds: ["nope"] }, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
	});
});

describe("sumTransactions", () => {
	it("sums and counts per currency, excluded transactions included", async () => {
		const { joint } = await openPair();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const excluded = await add(joint.id, { amount: toMinorUnits(-4290) });
		await updateTransaction(deps(), excluded, { excluded: true }, { origin: "user" });
		await add(joint.id, { amount: toMinorUnits(10000) });
		await add(dollars.id, { amount: toMinorUnits(-1000), currency: "USD" });

		await expect(sumTransactions(deps(), { accountIds: [joint.id, dollars.id] })).resolves.toEqual([
			{ currency: "EUR", amount: 5710, count: 2 },
			{ currency: "USD", amount: -1000, count: 1 },
		]);
	});

	it("sums only the rows the text matches", async () => {
		const { joint } = await openPair();
		await add(joint.id, { label: "Loyer", amount: toMinorUnits(-90000) });
		await add(joint.id, { label: "Pain", amount: toMinorUnits(-120) });

		await expect(sumTransactions(deps(), { accountIds: [joint.id], q: "loyer" })).resolves.toEqual([
			{ currency: "EUR", amount: -90000, count: 1 },
		]);
	});
});

describe("the first page of 50,000 transactions", () => {
	let big: TempDatabase;

	beforeAll(async () => {
		big = await createTempDatabase();
		const now = Date.UTC(2026, 8, 21);
		const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
		setToday("2026-09-21T10:00:00Z");
		const joint = await createAccount(
			bigDeps,
			{ ...checking, openingDate: "2016-01-01" },
			{ origin: "user" },
		);
		const card = await createAccount(
			bigDeps,
			{ ...checking, name: "Carte", openingDate: "2016-01-01" },
			{ origin: "user" },
		);
		vi.useRealTimers();
		const accountIds = [joint.id, card.id];
		const rows = Array.from({ length: 50_000 }, (_, index) => ({
			id: crypto.randomUUID(),
			accountId: accountIds[index % 2] ?? "",
			// Spread over ten years, a few a day, as a household's history would be.
			date: new Date(Date.UTC(2016, 0, 2) + (index % 3650) * 86_400_000).toISOString().slice(0, 10),
			amount: -((index % 9000) + 1),
			index,
		}));

		const chunks = Array.from({ length: rows.length / 2000 }, (_, index) =>
			rows.slice(index * 2000, (index + 1) * 2000),
		);

		// Seeded directly: the ledger would recompute ten years of balances per row,
		// and only the list's read path is being measured. In sequence, so the
		// transaction rows always find their entries.
		await chunks.reduce(async (previous, chunk) => {
			await previous;
			await big.db.insert(entries).values(
				chunk.map((row) => ({
					id: row.id,
					accountId: row.accountId,
					kind: "transaction" as const,
					date: row.date,
					amount: row.amount,
					currency: "EUR",
					createdAt: now + row.index,
					updatedAt: now + row.index,
				})),
			);
			await big.db
				.insert(transactions)
				.values(
					chunk.map((row) => ({ entryId: row.id, label: `Opération ${row.index}`, notes: null })),
				);
		}, Promise.resolve());
	}, 60_000);

	afterAll(async () => {
		await big.dispose();
	});

	it("answers the list, the count and the sum in under 300 ms", async () => {
		const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
		// One warm-up read, as a running server has had: the first query pays
		// for opening the file.
		await listTransactions(bigDeps, {}, firstPage);
		await sumTransactions(bigDeps, {});

		const started = performance.now();
		const page = await listTransactions(bigDeps, {}, firstPage);
		await sumTransactions(bigDeps, {});
		const elapsed = performance.now() - started;

		expect(page.total).toBe(50_000);
		expect(page.items).toHaveLength(50);
		expect(elapsed).toBeLessThan(300);
	});
});

describe("balancesBetween", () => {
	it("returns each day of the range, both ends included, oldest first", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10" });

		await expect(balancesBetween(deps(), account.id, "2026-09-09", "2026-09-11")).resolves.toEqual([
			{ date: "2026-09-09", balance: 123456 },
			{ date: "2026-09-10", balance: 119166 },
			{ date: "2026-09-11", balance: 119166 },
		]);
	});

	it("leaves out the rows past the range, such as those of a future transaction", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-10-01" });

		const rows = await balancesBetween(deps(), account.id, "2026-09-01", "2026-09-21");

		expect(rows).toHaveLength(21);
		expect(rows.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("carries the last write's balance to today when nothing was written since", async () => {
		const account = await openChecking();
		setToday("2026-10-21T10:00:00Z");

		const rows = await balancesBetween(deps(), account.id, "2026-09-21", "2026-10-21");

		expect(rows).toHaveLength(31);
		expect(rows[0]).toEqual({ date: "2026-09-21", balance: 123456 });
		expect(rows.at(-1)).toEqual({ date: "2026-10-21", balance: 123456 });
	});

	it("is empty for an unknown account", async () => {
		await expect(balancesBetween(deps(), "nope", "2026-09-01", "2026-09-21")).resolves.toEqual([]);
	});
});

describe("openingDateOf", () => {
	it("returns the opening anchor's date, or null for an unknown account", async () => {
		const account = await openChecking();

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(openingDateOf(deps(), "nope")).resolves.toBeNull();
	});
});

// Checking opened on 2026-01-10 at 1 500,00 with a -120,00 on 2026-03-02: the
// I/O matrix of Story 1.4.
async function openPinned(overrides: Partial<NewAccountInput> = {}) {
	const account = await openChecking({
		openingBalance: toMinorUnits(150000),
		openingDate: "2026-01-10",
		...overrides,
	});
	await add(account.id, { date: "2026-03-02", amount: toMinorUnits(-12000) });

	return account;
}

async function snapshot(accountId: string, date: string, balance: number) {
	const result = await recordSnapshot(
		deps(),
		accountId,
		{ date, balance: toMinorUnits(balance) },
		{ origin: "user" },
	);

	if (result.status !== "recorded") {
		throw new Error(`Snapshot rejected: ${result.reason}`);
	}

	return result.id;
}

const firstPage = { page: 1, pageSize: 50 };

describe("recordSnapshot", () => {
	it("fixes the day's balance and the next days continue from it", async () => {
		const account = await openPinned();

		await snapshot(account.id, "2026-03-05", 200000);
		await add(account.id, { date: "2026-03-06", amount: toMinorUnits(-5000) });

		const days = await history(account.id);
		expect(days.get("2026-03-04")).toBe(138000);
		expect(days.get("2026-03-05")).toBe(200000);
		expect(days.get("2026-03-06")).toBe(195000);
		expect(days.get("2026-09-21")).toBe(195000);
	});

	it("stores a valuation in the account's currency", async () => {
		const account = await openPinned();

		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			temp.db.select().from(entries).where(eq(entries.id, id)).get(),
		).resolves.toMatchObject({
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date: "2026-03-05",
			amount: 200000,
			currency: "EUR",
		});
	});

	it("keeps the day at the snapshot when a transaction lands on it", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);

		await add(account.id, { date: "2026-03-05", amount: toMinorUnits(-3000) });

		const days = await history(account.id);
		expect(days.get("2026-03-05")).toBe(200000);
		expect(days.get("2026-09-21")).toBe(200000);
	});

	it("updates the snapshot already on that date and keeps its id", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		const again = await snapshot(account.id, "2026-03-05", 199000);

		expect(again).toBe(id);
		const list = await listSnapshots(deps(), account.id, firstPage);
		expect(list.total).toBe(1);
		expect(list.items[0]).toMatchObject({ id, balance: 199000 });
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 199000,
		});
	});

	it("stores an overdraft and a card's amount owed as typed", async () => {
		const account = await openPinned();
		const card = await openPinned({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});

		await snapshot(account.id, "2026-03-05", -8000);
		await snapshot(card.id, "2026-03-05", 52000);

		await expect(balanceOn(deps(), account.id, "2026-03-05")).resolves.toMatchObject({
			amount: -8000,
		});
		await expect(balanceOn(deps(), card.id, "2026-03-05")).resolves.toMatchObject({
			amount: 52000,
		});
	});

	it("refuses the opening date and tomorrow, and writes nothing", async () => {
		const account = await openPinned();
		const before = await history(account.id);

		await expect(
			recordSnapshot(
				deps(),
				account.id,
				{ date: "2026-01-10", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });
		await expect(
			recordSnapshot(
				deps(),
				account.id,
				{ date: "2026-09-22", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "rejected", reason: "DATE_IN_FUTURE" });

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	it("refuses an account that does not exist", async () => {
		setToday("2026-09-21T10:00:00Z");

		await expect(
			recordSnapshot(
				deps(),
				"nope",
				{ date: "2026-03-05", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves no row behind when the recompute fails", async () => {
		const account = await openPinned();
		const before = await history(account.id);
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(snapshot(account.id, "2026-03-05", 200000)).rejects.toThrow();

		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toMatchObject({ total: 0 });
		await expect(history(account.id)).resolves.toEqual(before);
	});
});

describe("updateSnapshot", () => {
	it("moves a snapshot earlier and recomputes from the new date", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-02-20" }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		const days = await history(account.id);
		expect(days.get("2026-02-19")).toBe(150000);
		expect(days.get("2026-02-20")).toBe(200000);
		expect(days.get("2026-03-02")).toBe(188000);
		expect(days.get("2026-03-05")).toBe(188000);
	});

	it("moves a snapshot later and restores the days it left", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-02-20", 200000);

		await updateSnapshot(deps(), id, { date: "2026-03-05" }, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-02-20")).toBe(150000);
		expect(days.get("2026-03-04")).toBe(138000);
		expect(days.get("2026-03-05")).toBe(200000);
	});

	it("changes the balance alone", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await updateSnapshot(deps(), id, { balance: toMinorUnits(210000) }, { origin: "user" });

		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({
			date: "2026-03-05",
			balance: 210000,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 210000,
		});
	});

	it("refuses a date another snapshot holds and changes nothing", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-02-20", 190000);
		const id = await snapshot(account.id, "2026-03-05", 200000);
		const before = await history(account.id);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-02-20" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "SNAPSHOT_EXISTS" });

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toMatchObject({ total: 2 });
	});

	it("keeps its own date without calling it taken", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(
				deps(),
				id,
				{ date: "2026-03-05", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "updated" });
	});

	it("refuses the opening date and tomorrow", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-01-10" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });
		await expect(
			updateSnapshot(deps(), id, { date: "2026-09-22" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "DATE_IN_FUTURE" });
		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({ date: "2026-03-05" });
	});

	it("answers NOT_FOUND for an unknown id and for a transaction's id", async () => {
		const account = await openPinned();
		const transaction = await add(account.id);

		await expect(
			updateSnapshot(deps(), "nope", { date: "2026-03-05" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			updateSnapshot(deps(), transaction, { date: "2026-03-05" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteSnapshot", () => {
	it("lets the balances follow the transactions again from its date", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await deleteSnapshot(deps(), id, { origin: "user" });

		await expect(findSnapshot(deps(), id)).resolves.toBeNull();
		const days = await history(account.id);
		expect(days.get("2026-03-05")).toBe(138000);
		expect(days.get("2026-09-21")).toBe(138000);
	});

	it("answers NOT_FOUND for an unknown snapshot", async () => {
		await expect(deleteSnapshot(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("listSnapshots", () => {
	it("gives each snapshot the balance its day would have had, and the gap", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toEqual({
			items: [
				{
					id,
					accountId: account.id,
					date: "2026-03-05",
					balance: 200000,
					computed: 138000,
					gap: 62000,
					currency: "EUR",
				},
			],
			total: 1,
		});
	});

	it("counts a transaction of the snapshot day in the computed balance", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);

		await add(account.id, { date: "2026-03-05", amount: toMinorUnits(-3000) });

		const { items } = await listSnapshots(deps(), account.id, firstPage);
		expect(items[0]).toMatchObject({ computed: 135000, gap: 65000 });
	});

	it("subtracts a card's purchases from the amount owed", async () => {
		const card = await openPinned({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});
		await snapshot(card.id, "2026-03-05", 52000);

		const { items } = await listSnapshots(deps(), card.id, firstPage);

		// 490,30 owed, plus the 120,00 purchase of 03-02.
		expect(items[0]).toMatchObject({ balance: 52000, computed: 61030, gap: -9030 });
	});

	it("orders by date, most recent first, and pages", async () => {
		const account = await openPinned();
		const older = await snapshot(account.id, "2026-02-20", 190000);
		const newer = await snapshot(account.id, "2026-03-05", 200000);

		const all = await listSnapshots(deps(), account.id, firstPage);
		const secondPage = await listSnapshots(deps(), account.id, { page: 2, pageSize: 1 });

		expect(all.items.map((item) => item.id)).toEqual([newer, older]);
		// The later snapshot is computed from the earlier one.
		expect(all.items[0]).toMatchObject({ computed: 178000, gap: 22000 });
		expect(secondPage).toEqual({ items: [expect.objectContaining({ id: older })], total: 2 });
	});

	it("fails loudly when the day before a snapshot has no balance row", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);
		await temp.db
			.delete(balances)
			.where(and(eq(balances.accountId, account.id), eq(balances.date, "2026-03-04")));

		await expect(listSnapshots(deps(), account.id, firstPage)).rejects.toMatchObject({
			code: "INTERNAL_ERROR",
		});
	});
});

describe("findSnapshot", () => {
	it("returns one snapshot with its gap, or null for an id that names none", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);
		const transaction = await add(account.id);

		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({ id, gap: 62000 });
		await expect(findSnapshot(deps(), transaction)).resolves.toBeNull();
		await expect(findSnapshot(deps(), "nope")).resolves.toBeNull();
	});
});

/** Every row an account owns, in the four tables `deleteAccount` clears. */
async function rowsOf(db: TempDatabase["db"], accountId: string) {
	const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId));
	const entryRows = await db.select().from(entries).where(eq(entries.accountId, accountId));
	const transactionRows = await db
		.select({ entryId: transactions.entryId })
		.from(transactions)
		.innerJoin(entries, eq(entries.id, transactions.entryId))
		.where(eq(entries.accountId, accountId));
	const balanceRows = await db.select().from(balances).where(eq(balances.accountId, accountId));

	return {
		accounts: accountRows.length,
		entries: entryRows.length,
		transactions: transactionRows.length,
		balances: balanceRows.length,
	};
}

describe("deleteAccount", () => {
	it("removes the account, its transactions, snapshots, opening anchor and balances", async () => {
		const account = await openPinned();
		await add(account.id, { date: "2026-04-01" });
		await add(account.id, { date: "2026-05-01" });
		await snapshot(account.id, "2026-03-05", 200000);
		const other = await openPinned({ name: "Livret A", subtype: "savings" });
		const otherBefore = await rowsOf(temp.db, other.id);

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toEqual({
			accounts: 0,
			entries: 0,
			transactions: 0,
			balances: 0,
		});
		await expect(rowsOf(temp.db, other.id)).resolves.toEqual(otherBefore);
		expect(otherBefore).toMatchObject({ accounts: 1, entries: 2, transactions: 1 });
		await expect(balanceOn(deps(), other.id, "2026-09-21")).resolves.toMatchObject({
			amount: 138000,
		});
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		await expect(deleteAccount(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("deletes more transactions than SQLite binds parameters in one statement", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			vi.useRealTimers();
			// Past the 32 766 parameters a list of ids would bind.
			const ids = Array.from({ length: 33_000 }, () => crypto.randomUUID());
			const chunks = Array.from({ length: Math.ceil(ids.length / 2000) }, (_, index) =>
				ids.slice(index * 2000, (index + 1) * 2000),
			);

			// Seeded directly, as the 50,000-row list test does: only the delete is under test.
			await chunks.reduce(async (previous, chunk) => {
				await previous;
				await big.db.insert(entries).values(
					chunk.map((id) => ({
						id,
						accountId: account.id,
						kind: "transaction" as const,
						date: "2026-01-02",
						amount: -1,
						currency: "EUR",
						createdAt: 0,
						updatedAt: 0,
					})),
				);
				await big.db
					.insert(transactions)
					.values(chunk.map((id) => ({ entryId: id, label: "Opération", notes: null })));
			}, Promise.resolve());

			await deleteAccount(bigDeps, account.id, { origin: "user" });

			await expect(rowsOf(big.db, account.id)).resolves.toEqual({
				accounts: 0,
				entries: 0,
				transactions: 0,
				balances: 0,
			});
		} finally {
			await big.dispose();
		}
	}, 60_000);
});
