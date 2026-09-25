import type { RowPlan } from "../domain/rules/matching.ts";
import type { NormalizedTransaction, ParsedStatement } from "../domain/statement.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput, Origin } from "./ledger.ts";

import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { FileSourceId } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import { merchants } from "@archant/data/schema/merchants";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { rules } from "@archant/data/schema/rules";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind } from "@archant/data/transfer-kinds";

import * as forward from "../domain/balances/forward.ts";
import { countsInCashFlow, direction } from "../domain/cash-flow.ts";
import { addDays } from "../domain/dates.ts";
import { lineKeys } from "../domain/keys.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../schemas/transactions.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { updateAccount } from "./accounts.ts";
import {
	balanceOn,
	balancesBetween,
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	cashFlowByCategory,
	createAccount,
	deleteAccount,
	deleteSnapshot,
	deleteTransaction,
	dismissDuplicate,
	duplicateCandidates,
	findSnapshot,
	findTransaction,
	entryOrigins,
	ingest,
	linkBankAccount,
	listSnapshots,
	oldestPendingDate,
	listTransactions,
	matchTransfer,
	mergeDuplicate,
	countByCategory,
	countByMerchant,
	countByTag,
	moveMerchant,
	openingDateOf,
	recategorise,
	sumTransactions,
	transferCandidates,
	unmatchTransfer,
	recordSnapshot,
	rejectTransfer,
	removableOf,
	removeTag,
	revertImport,
	applyRulePlan,
	applyRulePlanToHistory,
	ruleCandidates,
	unlinkBankAccount,
	updateSnapshot,
	updateTransaction,
} from "./ledger.ts";
import { createRule, setRuleEnabled } from "./rules.ts";

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
	reference: null,
	notes: null,
	pending: false,
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
		{ transactions: [line(overrides)], balance: null, rejected: [] },
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

/** The daily balances from `date` on, as `history` gives them. */
async function historyFrom(accountId: string, date: string) {
	const all = await history(accountId);

	return new Map([...all].filter(([day]) => day >= date));
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
			reference: null,
			excluded: false,
			pending: false,
			categoryId: null,
			merchantId: null,
			tagIds: [],
			transfer: null,
			transferSuggested: false,
			possibleDuplicate: false,
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
				balance: null,
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
			{
				transactions: [line({ date: "2026-09-01" }), line({ date: "2026-09-15" })],
				balance: null,
				rejected: [],
			},
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
				balance: null,
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
				{ transactions: [line()], balance: null, rejected: [] },
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
				{ transactions: [line()], balance: null, rejected: [] },
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
async function previewRow(
	accountId: string,
	db = temp.db,
	source: FileSourceId = "ofx",
): Promise<string> {
	const id = crypto.randomUUID();

	await db.insert(imports).values({
		id,
		accountId,
		source,
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
	balance: null,
	rejected: [],
});

type ImportOptions = { moveOpeningDate?: string; db?: TempDatabase["db"]; source?: FileSourceId };

/** Previews a statement, stores the digest as the service does, and returns the preview. */
async function preview(
	accountId: string,
	statement: ParsedStatement,
	options: ImportOptions & { importId?: string } = {},
) {
	const db = options.db ?? temp.db;
	const importId = options.importId ?? (await previewRow(accountId, db, options.source));
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

	it("writes a line's reference", async () => {
		const account = await openChecking();

		const { result } = await importStatement(
			account.id,
			statementOf({ ...cafe, reference: "1234567" }, salary),
		);

		const [cafeId = "", salaryId = ""] = result.created;
		await expect(findTransaction(deps(), cafeId)).resolves.toMatchObject({ reference: "1234567" });
		await expect(findTransaction(deps(), salaryId)).resolves.toMatchObject({ reference: null });
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
			balance: null,
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

// Story 2.2: step 7 of the pipeline, the statement balance.

/** A statement with `cafe` and `salary` closing on `amount`, signed as the bank prints it. */
const closingOn = (
	amount: number,
	date = "2026-09-15",
	currency = "EUR",
	lines: NormalizedTransaction[] = [cafe, salary],
): ParsedStatement => ({
	transactions: lines,
	balance: { amount: toMinorUnits(amount), currency, date },
	rejected: [],
});

async function snapshotsOf(accountId: string) {
	return temp.db
		.select({
			id: entries.id,
			date: entries.date,
			balance: entries.amount,
			importId: entries.importId,
			updatedAt: entries.updatedAt,
		})
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "reconciliation")));
}

describe("ingest the statement balance", () => {
	it("previews a checking account's balance as recorded, and writes nothing", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const { result } = await preview(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("records it on confirm as a snapshot owned by the import, which sets the balance", async () => {
		const account = await openChecking();

		const { importId, result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ date: "2026-09-15", balance: 240861, importId }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toEqual({
			amount: 240861,
			currency: "EUR",
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 240861,
		});
		// The lines before it still move the days before it.
		await expect(balanceOn(deps(), account.id, "2026-09-12")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });
		expect(items).toEqual([expect.objectContaining({ date: "2026-09-15", balance: 240861 })]);
	});

	it("turns a card's negative statement balance into a positive amount owed", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});

		const { result } = await importStatement(card.id, closingOn(-51230, "2026-09-15", "EUR", []));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 51230 });
		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toMatchObject({
			amount: 51230,
		});
	});

	it("records nothing for a statement without a balance", async () => {
		const account = await openChecking();

		const { result } = await importStatement(account.id, statementOf(cafe));

		expect(result.balance).toBeNull();
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
	});

	it("ignores a balance on a manual statement: only an import carries one", async () => {
		const account = await openChecking();

		const result = await ingest(
			deps(),
			account.id,
			closingOn(999, "2026-09-15", "EUR", [cafe]),
			{ manual: true },
			{ origin: "user" },
		);

		expect(result.balance).toBeNull();
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
	});

	it("keeps a snapshot the user entered on that date, and gives the gap", async () => {
		const account = await openChecking();
		const typed = await snapshot(account.id, "2026-09-15", 240000);

		const { result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({
			status: "kept",
			date: "2026-09-15",
			balance: 240861,
			recorded: 240000,
			gap: 861,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: typed, balance: 240000, importId: null }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toMatchObject({
			amount: 240000,
		});
	});

	it("writes nothing when the same file comes again, keeping the first import as owner", async () => {
		const account = await openChecking();
		const first = await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);
		const before = await history(account.id);

		const again = await importStatement(account.id, closingOn(240861));

		expect(again.result.balance).toEqual({
			status: "present",
			date: "2026-09-15",
			balance: 240861,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			{ ...written, importId: first.importId },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("gives a snapshot the user typed with the same value as present, writing nothing", async () => {
		const account = await openChecking();
		const typed = await snapshot(account.id, "2026-09-15", 240861);
		const [before] = await snapshotsOf(account.id);

		const { result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "present", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			{ ...before, id: typed, importId: null },
		]);
	});

	it("records a later balance when every line is already present", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		const later = await importStatement(account.id, closingOn(230000, "2026-09-18"));

		expect(counts(later.result)).toMatchObject({ created: 0, present: 2 });
		expect(later.result.balance).toEqual({
			status: "recorded",
			date: "2026-09-18",
			balance: 230000,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ date: "2026-09-18", balance: 230000, importId: later.importId }),
			]),
		);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 230000,
		});
	});

	it("replaces another import's snapshot on that date with a newer file's value", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);

		// The same lines, all present: only the snapshot moves the balance.
		const newer = await importStatement(account.id, closingOn(250000));

		expect(counts(newer.result)).toMatchObject({ created: 0, present: 2 });
		expect(newer.result.balance).toEqual({
			status: "recorded",
			date: "2026-09-15",
			balance: 250000,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: written?.id, balance: 250000, importId: newer.importId }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 250000,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-14")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
	});

	it.each([
		["on the opening date", "2026-09-01", "EUR", "BEFORE_OPENING_DATE"],
		["before the opening date", "2026-08-20", "EUR", "BEFORE_OPENING_DATE"],
		["after today", "2026-09-22", "EUR", "DATE_IN_FUTURE"],
		["in another currency", "2026-09-15", "USD", "CURRENCY_MISMATCH"],
	])("skips a balance dated %s, writing nothing for it", async (_name, date, currency, reason) => {
		const card = await openChecking({ type: "credit_card", subtype: null });

		const { result } = await importStatement(card.id, closingOn(-51230, date, currency));

		expect(result.balance).toEqual({ status: "skipped", date, balance: 51230, reason });
		expect(result.created).toHaveLength(2);
		await expect(snapshotsOf(card.id)).resolves.toEqual([]);
	});

	it("checks the date against the opening date the import moves", async () => {
		const account = await openChecking();
		const lines = closingOn(100000, "2026-08-25", "EUR", [
			line({ date: "2026-08-22", amount: toMinorUnits(-2000), label: "Loyer" }),
		]);

		const { result } = await importStatement(account.id, lines, { moveOpeningDate: "2026-08-20" });

		expect(result.balance).toEqual({ status: "recorded", date: "2026-08-25", balance: 100000 });
		await expect(balanceOn(deps(), account.id, "2026-08-25")).resolves.toMatchObject({
			amount: 100000,
		});
	});

	it("refuses a confirm when the user entered a snapshot on that date since the preview", async () => {
		const account = await openChecking();
		const { importId } = await preview(account.id, closingOn(240861));
		await snapshot(account.id, "2026-09-15", 240000);
		const before = await history(account.id);

		await expect(confirm(account.id, importId, closingOn(240861))).rejects.toMatchObject({
			code: "IMPORT_PREVIEW_STALE",
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 240000, importId: null }),
		]);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("hands an imported snapshot to the user once they record a value on its date", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		await snapshot(account.id, "2026-09-15", 240500);

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 240500, importId: null }),
		]);
		const { result } = await preview(account.id, closingOn(240861));
		expect(result.balance).toMatchObject({ status: "kept", recorded: 240500, gap: 361 });
	});

	it("hands an imported snapshot to the user once they edit it", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);

		await updateSnapshot(deps(), written?.id ?? "", { date: "2026-09-16" }, { origin: "user" });

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ date: "2026-09-16", balance: 240861, importId: null }),
		]);
	});
});

describe("entryOrigins", () => {
	it("names the import behind each imported entry and leaves manual ones out", async () => {
		const account = await openChecking();
		const manual = await add(account.id);
		const { result } = await importStatement(account.id, statementOf(salary));
		const [imported = ""] = result.created;

		const origins = await entryOrigins(deps(), [manual, imported]);

		expect([...origins.keys()]).toEqual([imported]);
		const origin = origins.get(imported);
		expect(origin).toMatchObject({ kind: "import", source: "ofx" });
		expect(origin?.kind === "import" && typeof origin.confirmedAt).toBe("number");
		await expect(entryOrigins(deps(), [])).resolves.toEqual(new Map());
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

// Story 2.5: the history and the revert.

async function importOf(importId: string) {
	return temp.db.select().from(imports).where(eq(imports.id, importId)).get();
}

async function entryImport(entryId: string) {
	const row = await temp.db
		.select({ importId: entries.importId })
		.from(entries)
		.where(eq(entries.id, entryId))
		.get();

	return row?.importId;
}

const revert = (importId: string) => revertImport(deps(), importId, { origin: "user" });

describe("the creation marker", () => {
	it("marks the created lines and the possible duplicates, never a matched entry", async () => {
		const account = await openChecking();
		const manual = await add(account.id, { date: "2026-09-03", amount: toMinorUnits(-777) });
		await add(account.id, { date: "2026-09-14", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-16", amount: toMinorUnits(-1000) });

		const { importId, result } = await importStatement(
			account.id,
			statementOf(
				cafe,
				line({ date: "2026-09-04", amount: toMinorUnits(-777), label: "Parking" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-1000), label: "Péage" }),
			),
		);

		expect(counts(result)).toMatchObject({ created: 1, matched: 1, duplicates: 1 });
		const [created = "", duplicate = ""] = result.created;
		await expect(entryImport(created)).resolves.toBe(importId);
		await expect(entryImport(duplicate)).resolves.toBe(importId);
		await expect(entryImport(manual)).resolves.toBeNull();
	});

	it("leaves a manual line unmarked", async () => {
		const account = await openChecking();

		const id = await add(account.id);

		await expect(entryImport(id)).resolves.toBeNull();
	});

	it("stores where the opening stood only when the import moves it", async () => {
		const account = await openChecking();

		const kept = await importStatement(account.id, statementOf(cafe));
		const moved = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);

		await expect(importOf(kept.importId)).resolves.toMatchObject({ previousOpeningDate: null });
		await expect(importOf(moved.importId)).resolves.toMatchObject({
			previousOpeningDate: "2026-09-01",
			revertedAt: null,
		});
	});
});

describe("revertImport", () => {
	it("deletes what the import created, its keys and its snapshot, and puts the balances back", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1500), label: "Pharmacie" });
		const before = await history(account.id);
		const { importId, result } = await importStatement(account.id, closingOn(240861));
		const [cafeId = ""] = result.created;

		const reverted = await revert(importId);

		expect(reverted).toEqual({
			accountId: account.id,
			removed: { transactions: 2, snapshot: 1 },
		});
		await expect(findTransaction(deps(), cafeId)).resolves.toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.importId, importId)),
		).resolves.toEqual([]);
		await expect(
			temp.db.select().from(transactions).where(eq(transactions.entryId, cafeId)),
		).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
		const stored = await importOf(importId);
		expect(stored).toMatchObject({ status: "reverted", counts: counts(result) });
		expect(typeof stored?.revertedAt).toBe("number");
	});

	it("keeps a matched manual entry as it was, without the import's keys", async () => {
		const account = await openChecking();
		const manual = await add(account.id, {
			date: "2026-09-03",
			amount: toMinorUnits(-4290),
			label: "Café",
		});
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf({ ...cafe, date: "2026-09-05" }),
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 0, snapshot: 0 },
		});

		await expect(findTransaction(deps(), manual)).resolves.toMatchObject({
			date: "2026-09-03",
			label: "Café",
			amount: -4290,
		});
		await expect(keysOf(manual)).resolves.toEqual([]);
		await expect(entryOrigins(deps(), [manual])).resolves.toEqual(new Map());
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("keeps an entry another source confirmed since, with that source's key", async () => {
		const account = await openChecking();
		const ofx = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = ofx.result.created;
		const csv = await importStatement(
			account.id,
			statementOf({ ...cafe, externalId: null, date: "2026-09-11", label: "CARTE CAFE" }),
			{ source: "csv" },
		);
		expect(csv.result.groups.matched).toEqual([expect.objectContaining({ entryId: id })]);

		await expect(revert(ofx.importId)).resolves.toMatchObject({
			removed: { transactions: 0, snapshot: 0 },
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "CB Café" });
		await expect(entryImport(id)).resolves.toBeNull();
		const keys = await temp.db
			.select({ source: entryKeys.source, importId: entryKeys.importId })
			.from(entryKeys)
			.where(eq(entryKeys.entryId, id));
		expect(keys).toEqual([{ source: "csv", importId: csv.importId }]);
	});

	it("deletes the taggings of the transactions it deletes", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const { importId, result } = await importStatement(account.id, statementOf(cafe, salary));
		const [cafeId = "", salaryId = ""] = result.created;
		await updateTransaction(deps(), cafeId, { tagIds: [holidays] }, { origin: "user" });
		await updateTransaction(deps(), salaryId, { tagIds: [holidays] }, { origin: "user" });

		await expect(revert(importId)).resolves.toMatchObject({ removed: { transactions: 2 } });

		await expect(tagsOf(cafeId)).resolves.toEqual([]);
		await expect(tagsOf(salaryId)).resolves.toEqual([]);
	});

	it("deletes a transaction the user edited since the import", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const { importId, result } = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = result.created;
		await updateTransaction(deps(), id, { label: "Café du matin" }, { origin: "user" });

		await revert(importId);

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("keeps a snapshot the user edited since the import", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);
		await updateSnapshot(
			deps(),
			written?.id ?? "",
			{ balance: toMinorUnits(240000) },
			{
				origin: "user",
			},
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 2, snapshot: 0 },
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: written?.id, balance: 240000, importId: null }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 240000,
		});
	});

	it("leaves a snapshot a newer file took over on that date", async () => {
		const account = await openChecking();
		const first = await importStatement(account.id, closingOn(240861));
		const newer = await importStatement(account.id, closingOn(250000));

		await expect(revert(first.importId)).resolves.toMatchObject({
			removed: { transactions: 2, snapshot: 0 },
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 250000, importId: newer.importId }),
		]);
	});

	it("puts the opening date and amount back, with no balance before it", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf(
				line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
				line({ date: "2026-09-01", amount: toMinorUnits(5000), label: "Remboursement" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-300), label: "Pain" }),
			),
			{ moveOpeningDate: "2026-08-19" },
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 3, snapshot: 0 },
		});

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("reads the same file the same way once reverted", async () => {
		const account = await openChecking();
		const file = statementOf(
			line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
			line({ date: "2026-09-05", amount: toMinorUnits(-300), label: "Pain" }),
		);
		const first = await importStatement(account.id, file, { moveOpeningDate: "2026-08-19" });
		const imported = await history(account.id);

		await revert(first.importId);
		const { result } = await importStatement(account.id, file, {
			moveOpeningDate: "2026-08-19",
		});

		expect(counts(result)).toMatchObject({ created: 2, rejected: 0 });
		await expect(history(account.id)).resolves.toEqual(imported);
	});

	it("stops the opening date the day before a line another source still holds", async () => {
		const account = await openChecking();
		const first = await importStatement(
			account.id,
			statementOf(
				line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
				line({ date: "2026-08-25", amount: toMinorUnits(-700), label: "Pain" }),
			),
			{ moveOpeningDate: "2026-08-19" },
		);
		const csv = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-26", amount: toMinorUnits(-700), label: "CB PAIN" })),
			{ source: "csv" },
		);
		expect(counts(csv.result)).toMatchObject({ matched: 1 });
		const kept = await historyFrom(account.id, "2026-08-24");

		await expect(revert(first.importId)).resolves.toMatchObject({
			removed: { transactions: 1, snapshot: 0 },
		});

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-24");
		// 1 234,56 + 27,00 shifted in, less the 20,00 given back.
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-08-24", amount: 123456 + 700 },
		]);
		await expect(history(account.id)).resolves.toEqual(kept);
		await expect(balanceOn(deps(), account.id, "2026-09-01")).resolves.toMatchObject({
			amount: 123456,
		});
	});

	it("stops the opening date the day before a snapshot, whatever the entry's kind", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		const kept = await snapshot(account.id, "2026-08-22", 120000);

		await revert(importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-21");
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: kept, date: "2026-08-22", balance: 120000 }),
		]);
		const [first] = (await history(account.id)).keys();
		expect(first).toBe("2026-08-21");
	});

	it("keeps the opening where a later import moved it further", async () => {
		const account = await openChecking();
		const alone = await openChecking();
		const later = statementOf(
			line({ date: "2026-08-10", amount: toMinorUnits(-500), label: "Pain" }),
		);
		const first = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		await importStatement(account.id, later, { moveOpeningDate: "2026-08-09" });
		await importStatement(alone.id, later, { moveOpeningDate: "2026-08-09" });

		await revert(first.importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-09");
		await expect(history(account.id)).resolves.toEqual(await history(alone.id));
	});

	it("undoes two moves fully when reverted in reverse order", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const first = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		const second = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-10", amount: toMinorUnits(-500), label: "Pain" })),
			{ moveOpeningDate: "2026-08-09" },
		);

		await revert(second.importId);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-08-19", amount: 123456 + 2000 },
		]);

		await revert(first.importId);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("gives a credit card's opening back its amount owed and its date", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(50000),
		});
		const before = await history(card.id);
		const { importId, result } = await importStatement(
			card.id,
			statementOf(line({ date: "2026-08-25", amount: toMinorUnits(-3000), label: "Achat" })),
			{ moveOpeningDate: "2026-08-24" },
		);
		expect(result.opening).toEqual({ date: "2026-08-24", balance: 47000 });

		await revert(importId);

		await expect(valuationsOf(card.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 50000 },
		]);
		await expect(history(card.id)).resolves.toEqual(before);
	});

	it("puts a bank-linked account's opening date back and derives its balances from there", async () => {
		const { account } = await linkedAccount();
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		await expect(balanceOn(deps(), account.id, "2026-08-19")).resolves.toMatchObject({
			amount: 102000,
		});

		await revert(importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("deletes the possible duplicates the import created, and counts them beforehand", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });
		const before = await history(account.id);
		const { importId, result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);
		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1 });
		const [duplicate = ""] = result.created;

		await expect(removableOf(deps(), [importId])).resolves.toEqual(
			new Map([[importId, { transactions: 1, snapshot: 0 }]]),
		);
		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 1, snapshot: 0 },
		});

		await expect(findTransaction(deps(), duplicate)).resolves.toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(2);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("lets the same file be imported again, every line created anew", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, closingOn(240861));
		await revert(importId);

		const { result } = await preview(account.id, closingOn(240861));

		expect(counts(result)).toMatchObject({ created: 2, present: 0 });
		expect(result.balance).toMatchObject({ status: "recorded" });
	});

	it("refuses an import reverted already or only previewed, and changes nothing", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, statementOf(cafe));
		await revert(importId);
		const pending = await previewRow(account.id);
		const before = await history(account.id);

		await expect(revert(importId)).rejects.toMatchObject({ code: "IMPORT_NOT_REVERTABLE" });
		await expect(revert(pending)).rejects.toMatchObject({ code: "IMPORT_NOT_REVERTABLE" });
		await expect(revert("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });

		await expect(importOf(pending)).resolves.toMatchObject({ status: "previewed" });
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("reverts 5,000 lines in one transaction", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			const before = await big.db
				.select()
				.from(balances)
				.where(eq(balances.accountId, account.id))
				.orderBy(balances.date);
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
			const { importId } = await importStatement(account.id, lines, { db: big.db });
			const started = performance.now();

			const reverted = await revertImport(bigDeps, importId, { origin: "user" });

			expect(performance.now() - started).toBeLessThan(10_000);
			expect(reverted.removed).toEqual({ transactions: 5000, snapshot: 0 });
			await expect(
				big.db.select({ id: entries.id }).from(entries).where(eq(entries.kind, "transaction")),
			).resolves.toEqual([]);
			await expect(big.db.select().from(entryKeys)).resolves.toEqual([]);
			await expect(
				big.db
					.select()
					.from(balances)
					.where(eq(balances.accountId, account.id))
					.orderBy(balances.date),
			).resolves.toEqual(before);
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("removableOf", () => {
	it("counts what a revert would delete now, per import", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-03", amount: toMinorUnits(-777) });
		const snapshotted = await importStatement(account.id, closingOn(240861));
		const matchedOnly = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-04", amount: toMinorUnits(-777), label: "Parking" })),
			{ source: "csv" },
		);
		// A CSV line confirming the café the OFX file created: one fewer to delete.
		await importStatement(
			account.id,
			statementOf({ ...cafe, externalId: null, date: "2026-09-11", label: "CARTE CAFE" }),
			{ source: "csv" },
		);

		const removable = await removableOf(deps(), [snapshotted.importId, matchedOnly.importId]);

		expect(removable).toEqual(
			new Map([
				[snapshotted.importId, { transactions: 1, snapshot: 1 }],
				[matchedOnly.importId, { transactions: 0, snapshot: 0 }],
			]),
		);
		await expect(removableOf(deps(), [])).resolves.toEqual(new Map());
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

	it("sets a category by hand, recording the user and locking it, without touching balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { categoryId: groceries }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ categoryId: groceries });
		await expect(categoryOriginOf(id)).resolves.toBe("user");
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("clears a category by hand, locking it too", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, { origin: "rule" });

		await updateTransaction(deps(), id, { categoryId: null }, { origin: "user" });

		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(categoryOriginOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
	});

	it("records a rule's category without locking it, and a provider's for a sync", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const byRule = await add(account.id, {}, "sync");
		const bySync = await add(account.id, {}, "sync");

		await updateTransaction(deps(), byRule, { categoryId: groceries }, { origin: "rule" });
		await updateTransaction(deps(), bySync, { categoryId: groceries }, { origin: "sync" });

		await expect(categoryOriginOf(byRule)).resolves.toBe("rule");
		await expect(lockedFields(byRule)).resolves.toEqual([]);
		await expect(categoryOriginOf(bySync)).resolves.toBe("provider");
	});

	it("never changes a locked category for another origin", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const set = await add(account.id, {}, "sync");
		const cleared = await add(account.id, {}, "sync");
		await updateTransaction(deps(), set, { categoryId: groceries }, { origin: "user" });
		await updateTransaction(deps(), cleared, { categoryId: null }, { origin: "user" });
		// Clearing an empty category changes nothing, so nothing is locked yet.
		await updateTransaction(deps(), cleared, { categoryId: groceries }, { origin: "user" });
		await updateTransaction(deps(), cleared, { categoryId: null }, { origin: "user" });

		await updateTransaction(deps(), set, { categoryId: leisure }, { origin: "rule" });
		await updateTransaction(deps(), cleared, { categoryId: leisure }, { origin: "rule" });

		await expect(categoryOf(set)).resolves.toBe(groceries);
		await expect(categoryOriginOf(set)).resolves.toBe("user");
		await expect(categoryOf(cleared)).resolves.toBeNull();
	});

	it("refuses to set or clear one transaction's category for maintenance", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, { origin: "rule" });

		await expect(
			updateTransaction(deps(), id, { categoryId: null }, { origin: "maintenance" }),
		).rejects.toThrow(/maintenance/u);

		await expect(categoryOf(id)).resolves.toBe(groceries);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
	});

	it("refuses an unknown category and writes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(deps(), id, { categoryId: "nope", label: "Autre" }, { origin: "user" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "categoryId", code: "invalid_value" }],
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			categoryId: null,
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("sets a merchant by hand, locking it, without touching the entry or balances", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ merchantId: carrefour });
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("sets a category and a merchant together without recomputing balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		const recompute = vi.spyOn(forward, "forwardBalances");

		await updateTransaction(
			deps(),
			id,
			{ categoryId: groceries, merchantId: carrefour },
			{ origin: "user" },
		);

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			categoryId: groceries,
			merchantId: carrefour,
		});
		await expect(lockedFields(id)).resolves.toEqual(["category", "merchant"]);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("clears a merchant by hand, locking it too", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "rule" });
		await expect(lockedFields(id)).resolves.toEqual([]);

		await updateTransaction(deps(), id, { merchantId: null }, { origin: "user" });

		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
	});

	it("never changes a locked merchant for another origin", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const lidl = await newMerchant("Lidl");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "user" });

		await updateTransaction(deps(), id, { merchantId: lidl }, { origin: "rule" });
		await updateTransaction(deps(), id, { merchantId: null }, { origin: "provider" });

		await expect(merchantOf(id)).resolves.toBe(carrefour);
	});

	it("refuses an unknown merchant and writes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(deps(), id, { merchantId: "nope", label: "Autre" }, { origin: "user" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "merchantId", code: "invalid_value" }],
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			merchantId: null,
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});
	it("sets tags by hand, locking them, without touching the entry or balances", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			updateTransaction(deps(), id, { tagIds: [holidays, work, holidays] }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(tagsOf(id)).resolves.toEqual([holidays, work].toSorted());
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			tagIds: [holidays, work].toSorted(),
		});
		await expect(lockedFields(id)).resolves.toEqual(["tags"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("replaces the whole set of tags", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await updateTransaction(deps(), id, { tagIds: [work] }, { origin: "user" });

		await expect(tagsOf(id)).resolves.toEqual([work]);
	});

	it("clears the tags by hand, locking them", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "rule" });
		await expect(lockedFields(id)).resolves.toEqual([]);

		await updateTransaction(deps(), id, { tagIds: [] }, { origin: "user" });

		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(lockedFields(id)).resolves.toEqual(["tags"]);
	});

	it("treats the same tags in another order as no change", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays, work] }, { origin: "rule" });

		await updateTransaction(deps(), id, { tagIds: [work, holidays] }, { origin: "user" });

		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("never changes locked tags for another origin", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await updateTransaction(deps(), id, { tagIds: [work] }, { origin: "rule" });
		await updateTransaction(deps(), id, { tagIds: [] }, { origin: "provider" });

		await expect(tagsOf(id)).resolves.toEqual([holidays]);
	});

	it("refuses an unknown tag and writes nothing", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(
				deps(),
				id,
				{ tagIds: [holidays, "nope"], label: "Autre" },
				{ origin: "user" },
			),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "tagIds", code: "invalid_value" }],
		});

		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "Boulangerie" });
		await expect(lockedFields(id)).resolves.toEqual([]);
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

	it("deletes a tagged transaction with its taggings, keeping the tag", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id);
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await deleteTransaction(deps(), id, { origin: "user" });

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(temp.db.select().from(tags).where(eq(tags.id, holidays))).resolves.toHaveLength(1);
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

	it("filters on categories as given, on « Sans catégorie », or both", async () => {
		const { joint } = await openPair();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const other = await newCategory("Santé");
		const categorise = async (label: string, categoryId: string | null) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { categoryId }, { origin: "user" });
		};
		await categorise("Marché", groceries);
		await categorise("Cinéma", leisure);
		await categorise("Pharmacie", other);
		await categorise("Virement", null);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ categoryIds: [groceries, leisure] })).resolves.toEqual([
			"Cinéma",
			"Marché",
		]);
		await expect(labels({ uncategorised: true })).resolves.toEqual(["Virement"]);
		await expect(labels({ categoryIds: [groceries], uncategorised: true })).resolves.toEqual([
			"Marché",
			"Virement",
		]);
		await expect(labels({ categoryIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ categoryIds: [] })).resolves.toEqual([]);
		await expect(
			listTransactions(deps(), { accountIds, categoryIds: [groceries] }, firstPage),
		).resolves.toMatchObject({ total: 1, items: [{ categoryId: groceries }] });
		await expect(
			sumTransactions(deps(), { accountIds, categoryIds: [groceries], uncategorised: true }),
		).resolves.toEqual([{ currency: "EUR", amount: -8580, count: 2 }]);
	});

	it("filters on merchants, ORed, with count and sum to match", async () => {
		const { joint } = await openPair();
		const carrefour = await newMerchant("Carrefour");
		const lidl = await newMerchant("Lidl");
		const other = await newMerchant("Fnac");
		const link = async (label: string, merchantId: string | null) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { merchantId }, { origin: "user" });
		};
		await link("CB CARREFOUR 1234", carrefour);
		await link("CARREFOUR MARKET", carrefour);
		await link("LIDL", lidl);
		await link("FNAC", other);
		await link("Virement", null);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ merchantIds: [carrefour, lidl] })).resolves.toEqual([
			"CARREFOUR MARKET",
			"CB CARREFOUR 1234",
			"LIDL",
		]);
		await expect(labels({ merchantIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ merchantIds: [] })).resolves.toEqual([]);
		await expect(
			listTransactions(deps(), { accountIds, merchantIds: [carrefour, lidl] }, firstPage),
		).resolves.toMatchObject({ total: 3 });
		await expect(
			sumTransactions(deps(), { accountIds, merchantIds: [carrefour, lidl] }),
		).resolves.toEqual([{ currency: "EUR", amount: -12870, count: 3 }]);
	});

	it("filters on tags, ORed, listing and counting a row with both tags once", async () => {
		const { joint } = await openPair();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const other = await newTag("Autre");
		const tag = async (label: string, tagIds: string[]) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { tagIds }, { origin: "user" });

			return id;
		};
		const both = await tag("Hôtel", [holidays, work]);
		await tag("Train", [holidays]);
		await tag("Peinture", [work]);
		await tag("Livre", [other]);
		await tag("Virement", []);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ tagIds: [holidays, work] })).resolves.toEqual([
			"Hôtel",
			"Peinture",
			"Train",
		]);
		await expect(labels({ tagIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ tagIds: [] })).resolves.toEqual([]);
		const page = await listTransactions(
			deps(),
			{ accountIds, tagIds: [holidays, work] },
			firstPage,
		);
		expect(page.total).toBe(3);
		expect(page.items.find((item) => item.id === both)?.tagIds).toEqual(
			[holidays, work].toSorted(),
		);
		await expect(
			sumTransactions(deps(), { accountIds, tagIds: [holidays, work] }),
		).resolves.toEqual([{ currency: "EUR", amount: -12870, count: 3 }]);
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
	let bigAccountId = "";

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
		// Each odd row is the other side of the even row before it, on the other
		// account a day later: every row has a candidate, so the page pays for the
		// suggestion's search.
		const rows = Array.from({ length: 50_000 }, (_, index) => {
			const pair = Math.floor(index / 2);
			const magnitude = (pair % 9000) + 1;

			return {
				id: crypto.randomUUID(),
				accountId: accountIds[index % 2] ?? "",
				// Spread over ten years, a few a day, as a household's history would be.
				date: new Date(Date.UTC(2016, 0, 2) + ((pair % 3650) + (index % 2)) * 86_400_000)
					.toISOString()
					.slice(0, 10),
				amount: index % 2 === 0 ? -magnitude : magnitude,
				index,
			};
		});
		bigAccountId = joint.id;

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

	it("answers the first page of one account in under 300 ms", async () => {
		const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
		const filter = { accountIds: [bigAccountId] };
		await listTransactions(bigDeps, filter, firstPage);

		const started = performance.now();
		const page = await listTransactions(bigDeps, filter, firstPage);
		const elapsed = performance.now() - started;

		expect(page.total).toBe(25_000);
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

	it("removes an import's snapshot before the import it points at", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toMatchObject({ accounts: 0, entries: 0 });
		await expect(
			temp.db.select().from(imports).where(eq(imports.accountId, account.id)),
		).resolves.toEqual([]);
	});

	it("removes the taggings of its transactions, keeping the tags and other accounts' taggings", async () => {
		const account = await openChecking();
		const other = await openChecking({ name: "Livret A", subtype: "savings" });
		const holidays = await newTag("Vacances");
		const mine = await add(account.id);
		const theirs = await add(other.id);
		await updateTransaction(deps(), mine, { tagIds: [holidays] }, { origin: "user" });
		await updateTransaction(deps(), theirs, { tagIds: [holidays] }, { origin: "user" });

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toMatchObject({ transactions: 0 });
		await expect(tagsOf(mine)).resolves.toEqual([]);
		await expect(tagsOf(theirs)).resolves.toEqual([holidays]);
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

async function newCategory(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(categories).values({
		id,
		name: `${name} ${id}`,
		kind: "expense",
		color: "#e99537",
		icon: "tag",
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

async function categoryOf(entryId: string) {
	const row = await temp.db
		.select({ categoryId: transactions.categoryId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.categoryId;
}

async function categoryOriginOf(entryId: string) {
	const row = await temp.db
		.select({ origin: transactions.categoryOrigin })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.origin;
}

describe("recategorise", () => {
	it("moves every transaction of a category to another, and only those", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const food = await newCategory("Alimentation");
		const other = await newCategory("Loisirs");
		// One after the other: each is an `immediate` ledger transaction.
		const ids = [
			await add(account.id, { label: "Marché" }),
			await add(account.id, { label: "Épicerie" }),
			await add(account.id, { label: "Primeur" }),
		];
		const untouched = await add(account.id, { label: "Cinéma" });
		await temp.db
			.update(transactions)
			.set({ categoryId: groceries, categoryOrigin: "rule" })
			.where(inArray(transactions.entryId, ids));
		await temp.db
			.update(transactions)
			.set({ categoryId: other, categoryOrigin: "rule" })
			.where(eq(transactions.entryId, untouched));
		const days = await history(account.id);

		await expect(recategorise(deps(), groceries, food, { origin: "maintenance" })).resolves.toBe(3);

		await expect(Promise.all(ids.map(categoryOf))).resolves.toEqual([food, food, food]);
		await expect(categoryOf(untouched)).resolves.toBe(other);
		await expect(Promise.all(ids.map(categoryOriginOf))).resolves.toEqual(["rule", "rule", "rule"]);
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("keeps a category set by hand locked and the user's when it merges", async () => {
		const account = await openChecking();
		const source = await newCategory("Supermarché");
		const target = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: source }, { origin: "user" });

		await recategorise(deps(), source, target, { origin: "maintenance" });

		await expect(categoryOf(id)).resolves.toBe(target);
		await expect(categoryOriginOf(id)).resolves.toBe("user");
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
	});

	it("leaves the transactions uncategorised with null, dropping the origin and keeping the locks", async () => {
		const account = await openChecking();
		const category = await newCategory("Cadeaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(
			deps(),
			id,
			{ label: "Fleuriste", categoryId: category },
			{ origin: "user" },
		);

		await expect(recategorise(deps(), category, null, { origin: "maintenance" })).resolves.toBe(1);

		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(categoryOriginOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["label", "category"]);
	});

	it("moves nothing from a category no transaction uses", async () => {
		const empty = await newCategory("Vide");
		const target = await newCategory("Cible");

		await expect(recategorise(deps(), empty, target, { origin: "maintenance" })).resolves.toBe(0);
	});
});

describe("countByCategory", () => {
	it("counts each category's transactions, leaving out uncategorised ones and empty categories", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const empty = await newCategory("Vide");
		const first = await add(account.id, { label: "Marché" });
		const second = await add(account.id, { label: "Épicerie" });
		const third = await add(account.id, { label: "Cinéma" });
		await add(account.id, { label: "Sans catégorie" });
		await temp.db
			.update(transactions)
			.set({ categoryId: groceries, categoryOrigin: "rule" })
			.where(inArray(transactions.entryId, [first, second]));
		await temp.db
			.update(transactions)
			.set({ categoryId: leisure, categoryOrigin: "rule" })
			.where(eq(transactions.entryId, third));

		const perCategory = await countByCategory(deps());

		expect(perCategory.get(groceries)).toBe(2);
		expect(perCategory.get(leisure)).toBe(1);
		expect(perCategory.has(empty)).toBe(false);
		expect([...perCategory.keys()]).not.toContain(null);
	});
});

async function newMerchant(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(merchants).values({ id, name: `${name} ${id}`, createdAt: 0, updatedAt: 0 });

	return id;
}

async function merchantOf(entryId: string) {
	const row = await temp.db
		.select({ merchantId: transactions.merchantId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.merchantId;
}

describe("moveMerchant", () => {
	it("moves every transaction of a merchant to another, keeping locks and balances", async () => {
		const account = await openChecking();
		const source = await newMerchant("CB Carrefour");
		const target = await newMerchant("Carrefour");
		const other = await newMerchant("Lidl");
		const locked = await add(account.id, { label: "CB CARREFOUR 1234" }, "sync");
		const market = await add(account.id, { label: "CARREFOUR MARKET" }, "sync");
		const city = await add(account.id, { label: "CARREFOUR CITY" }, "sync");
		const untouched = await add(account.id, { label: "LIDL" }, "sync");
		await updateTransaction(deps(), locked, { merchantId: source }, { origin: "user" });
		await updateTransaction(deps(), market, { merchantId: source }, { origin: "rule" });
		await updateTransaction(deps(), city, { merchantId: source }, { origin: "rule" });
		await updateTransaction(deps(), untouched, { merchantId: other }, { origin: "rule" });
		const days = await history(account.id);

		await expect(moveMerchant(deps(), source, target, { origin: "maintenance" })).resolves.toBe(3);

		const ids = [locked, market, city];
		await expect(Promise.all(ids.map(merchantOf))).resolves.toEqual([target, target, target]);
		await expect(merchantOf(untouched)).resolves.toBe(other);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([["merchant"], [], []]);
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("unlinks the transactions with null, keeping the locks", async () => {
		const account = await openChecking();
		const merchant = await newMerchant("Fleuriste");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { merchantId: merchant }, { origin: "user" });
		await updateTransaction(deps(), second, { merchantId: merchant }, { origin: "rule" });

		await expect(moveMerchant(deps(), merchant, null, { origin: "maintenance" })).resolves.toBe(2);

		await expect(merchantOf(first)).resolves.toBeNull();
		await expect(merchantOf(second)).resolves.toBeNull();
		await expect(lockedFields(first)).resolves.toEqual(["merchant"]);
	});
});

describe("countByMerchant", () => {
	it("counts each merchant's transactions, leaving out unlinked ones and empty merchants", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const empty = await newMerchant("Vide");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { merchantId: carrefour }, { origin: "rule" });
		await updateTransaction(deps(), second, { merchantId: carrefour }, { origin: "rule" });

		const perMerchant = await countByMerchant(deps());

		expect(perMerchant.get(carrefour)).toBe(2);
		expect(perMerchant.has(empty)).toBe(false);
		expect([...perMerchant.keys()]).not.toContain(null);
	});
});

async function newTag(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(tags).values({ id, name: `${name} ${id}`, createdAt: 0, updatedAt: 0 });

	return id;
}

async function tagsOf(entryId: string) {
	const rows = await temp.db
		.select({ tagId: taggings.tagId })
		.from(taggings)
		.where(eq(taggings.transactionId, entryId))
		.orderBy(taggings.tagId);

	return rows.map((row) => row.tagId);
}

describe("removeTag", () => {
	it("removes a tag from every transaction, keeping locks and balances", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { tagIds: [holidays, work] }, { origin: "user" });
		await updateTransaction(deps(), second, { tagIds: [holidays] }, { origin: "rule" });
		const days = await history(account.id);

		await expect(removeTag(deps(), holidays, { origin: "maintenance" })).resolves.toBe(2);

		await expect(tagsOf(first)).resolves.toEqual([work]);
		await expect(tagsOf(second)).resolves.toEqual([]);
		await expect(lockedFields(first)).resolves.toEqual(["tags"]);
		await expect(lockedFields(second)).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(days);
	});
});

describe("countByTag", () => {
	it("counts each tag's transactions, leaving out unused tags", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const empty = await newTag("Vide");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { tagIds: [holidays] }, { origin: "rule" });
		await updateTransaction(deps(), second, { tagIds: [holidays] }, { origin: "rule" });

		const perTag = await countByTag(deps());

		expect(perTag.get(holidays)).toBe(2);
		expect(perTag.has(empty)).toBe(false);
	});
});

// Story 4.5: bulk edit.

const asUser = { origin: "user" } as const;

async function excludedOf(entryId: string) {
	const row = await temp.db
		.select({ excluded: transactions.excluded })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.excluded;
}

describe("bulkUpdateTransactions", () => {
	it("sets a category on the given rows, locking it, without touching the balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const ids = [
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
		];
		const days = await history(account.id);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			bulkUpdateTransactions(deps(), { ids }, { categoryId: groceries }, asUser),
		).resolves.toBe(3);

		await expect(Promise.all(ids.map(categoryOf))).resolves.toEqual([
			groceries,
			groceries,
			groceries,
		]);
		await expect(Promise.all(ids.map(categoryOriginOf))).resolves.toEqual(["user", "user", "user"]);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([
			["category"],
			["category"],
			["category"],
		]);
		expect(recompute).not.toHaveBeenCalled();
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("clears a merchant, locking it", async () => {
		const account = await openChecking();
		const merchant = await newMerchant("Fleuriste");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: merchant }, { origin: "rule" });

		await bulkUpdateTransactions(deps(), { ids: [id] }, { merchantId: null }, asUser);

		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
	});

	it("adds tags to those a row carries, never removing one", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const tagged = await add(account.id, {}, "sync");
		const bare = await add(account.id, {}, "sync");
		await updateTransaction(deps(), tagged, { tagIds: [holidays] }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [tagged, bare] }, { addTagIds: [work] }, asUser),
		).resolves.toBe(2);

		await expect(tagsOf(tagged)).resolves.toEqual([holidays, work].toSorted());
		await expect(tagsOf(bare)).resolves.toEqual([work]);
		await expect(lockedFields(tagged)).resolves.toEqual(["tags"]);
	});

	it("writes nothing when a row would carry more tags than the cap", async () => {
		const account = await openChecking();
		const full = Array.from({ length: MAX_TAGS_PER_TRANSACTION }, () => crypto.randomUUID());
		await temp.db
			.insert(tags)
			.values(full.map((id) => ({ id, name: `Tag ${id}`, createdAt: 0, updatedAt: 0 })));
		const extra = await newTag("En trop");
		const bare = await add(account.id, {}, "sync");
		const crowded = await add(account.id, {}, "sync");
		await updateTransaction(deps(), crowded, { tagIds: full }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [bare, crowded] }, { addTagIds: [extra] }, asUser),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "patch.addTagIds", code: "too_big" }],
		});

		await expect(tagsOf(bare)).resolves.toEqual([]);
		await expect(tagsOf(crowded)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
		await expect(lockedFields(bare)).resolves.toEqual([]);
	});

	it("counts a row already on the category without locking it again", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const already = await add(account.id, {}, "sync");
		const moved = await add(account.id, {}, "sync");
		await updateTransaction(deps(), already, { categoryId: groceries }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [already, moved] }, { categoryId: groceries }, asUser),
		).resolves.toBe(2);

		await expect(lockedFields(already)).resolves.toEqual([]);
		await expect(categoryOriginOf(already)).resolves.toBe("rule");
		await expect(lockedFields(moved)).resolves.toEqual(["category"]);
	});

	it("updates every row a filter matches, whatever the page", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const other = await newCategory("Loisirs");
		const uncategorised = [
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
		];
		const kept = await add(account.id, {}, "sync");
		await updateTransaction(deps(), kept, { categoryId: other }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id], uncategorised: true } },
				{ categoryId: groceries },
				asUser,
			),
		).resolves.toBe(3);

		await expect(Promise.all(uncategorised.map(categoryOf))).resolves.toEqual([
			groceries,
			groceries,
			groceries,
		]);
		await expect(categoryOf(kept)).resolves.toBe(other);
	});

	it("answers 0 when the filter matches nothing", async () => {
		const account = await openChecking();
		await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id], q: "introuvable" } },
				{ excluded: true },
				asUser,
			),
		).resolves.toBe(0);
		await expect(
			bulkUpdateTransactions(deps(), { filter: { merchantIds: [] } }, { excluded: true }, asUser),
		).resolves.toBe(0);
	});

	it("writes nothing when an id names no transaction", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ ids: [first, second, "nope"] },
				{ categoryId: groceries },
				asUser,
			),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "ids", code: "invalid_value" }],
		});

		await expect(categoryOf(first)).resolves.toBeNull();
		await expect(categoryOf(second)).resolves.toBeNull();
	});

	it("reads a repeated id once", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(deps(), { ids: [id, id] }, { excluded: true }, asUser),
		).resolves.toBe(1);
	});

	it.each([
		["patch.categoryId", { categoryId: "nope" }],
		["patch.merchantId", { merchantId: "nope" }],
		["patch.addTagIds", { addTagIds: ["nope"] }],
	])("writes nothing for an unknown reference, on %s", async (path, patch) => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(deps(), { ids: [id] }, patch, asUser),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code: "invalid_value" }],
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("excludes the rows, locking the field, without rewriting a balance", async () => {
		const account = await openChecking();
		const ids = [await add(account.id, {}, "sync"), await add(account.id, {}, "sync")];
		const days = await history(account.id);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await bulkUpdateTransactions(deps(), { ids }, { excluded: true }, asUser);

		await expect(Promise.all(ids.map(excludedOf))).resolves.toEqual([true, true]);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([["excluded"], ["excluded"]]);
		expect(recompute).not.toHaveBeenCalled();
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("keeps a locked field for any origin but the user's", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, asUser);

		await bulkUpdateTransactions(
			deps(),
			{ ids: [id] },
			{ categoryId: leisure },
			{ origin: "rule" },
		);

		await expect(categoryOf(id)).resolves.toBe(groceries);
	});
});

describe("bulkUpdateTransactions on 5,000 rows", () => {
	it("categorises every row a filter matches in one transaction", async () => {
		const big = await createTempDatabase();

		try {
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			setToday("2026-09-21T10:00:00Z");
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			const category = crypto.randomUUID();
			const tag = crypto.randomUUID();
			await big.db.insert(categories).values({
				id: category,
				name: "Courses",
				kind: "expense",
				color: "#e99537",
				icon: "tag",
				createdAt: 0,
				updatedAt: 0,
			});
			await big.db.insert(tags).values({ id: tag, name: "Vacances", createdAt: 0, updatedAt: 0 });
			const rows = Array.from({ length: 5000 }, (_, index) => ({
				id: crypto.randomUUID(),
				date: new Date(Date.UTC(2016, 0, 2) + (index % 3650) * 86_400_000)
					.toISOString()
					.slice(0, 10),
				index,
			}));
			// Seeded directly, in sequence, for the same reason as the 50,000-row list.
			await Array.from({ length: 5 }, (_, index) =>
				rows.slice(index * 1000, (index + 1) * 1000),
			).reduce(async (previous, chunk) => {
				await previous;
				await big.db.insert(entries).values(
					chunk.map((row) => ({
						id: row.id,
						accountId: account.id,
						kind: "transaction" as const,
						date: row.date,
						amount: -1,
						currency: "EUR",
						createdAt: row.index,
						updatedAt: row.index,
					})),
				);
				await big.db
					.insert(transactions)
					.values(chunk.map((row) => ({ entryId: row.id, label: `Opération ${row.index}` })));
			}, Promise.resolve());
			const transaction = vi.spyOn(big.db, "transaction");

			await expect(
				bulkUpdateTransactions(
					bigDeps,
					{ filter: { uncategorised: true } },
					{ categoryId: category, addTagIds: [tag] },
					asUser,
				),
			).resolves.toBe(5000);

			expect(transaction).toHaveBeenCalledTimes(1);
			await expect(
				big.db.all(
					sql`select count(*) as count from transactions where category_id = ${category} and locked_fields = '["category","tags"]'`,
				),
			).resolves.toEqual([{ count: 5000 }]);
			await expect(
				big.db.all(sql`select count(*) as count from taggings where tag_id = ${tag}`),
			).resolves.toEqual([{ count: 5000 }]);
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("bulkDeleteTransactions", () => {
	it("deletes rows over two accounts with their keys and taggings, recomputing each account once", async () => {
		const joint = await openChecking();
		const card = await openChecking({ name: "Carte" });
		const holidays = await newTag("Vacances");
		const { result } = await importStatement(joint.id, statementOf(cafe));
		const [imported = ""] = result.created;
		const early = await add(joint.id, { date: "2026-09-05", amount: toMinorUnits(-1000) });
		const kept = await add(joint.id, { date: "2026-09-15", amount: toMinorUnits(-500) });
		const onCard = await add(card.id, { date: "2026-09-08" });
		await updateTransaction(deps(), onCard, { tagIds: [holidays] }, asUser);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			bulkDeleteTransactions(deps(), { ids: [imported, early, onCard] }, asUser),
		).resolves.toBe(3);

		await expect(
			temp.db
				.select()
				.from(entries)
				.where(inArray(entries.id, [imported, early, onCard])),
		).resolves.toEqual([]);
		await expect(keysOf(imported)).resolves.toEqual([]);
		await expect(tagsOf(onCard)).resolves.toEqual([]);
		await expect(findTransaction(deps(), kept)).resolves.not.toBeNull();
		expect(recompute).toHaveBeenCalledTimes(2);
		expect(recompute.mock.calls.map(([input]) => input.from).toSorted()).toEqual([
			"2026-09-05",
			"2026-09-08",
		]);
		const jointDays = await history(joint.id);
		expect(jointDays.get("2026-09-14")).toBe(123456);
		expect(jointDays.get("2026-09-21")).toBe(122956);
		const cardDays = await history(card.id);
		expect(new Set(cardDays.values())).toEqual(new Set([123456]));
	});

	it("deletes every row a filter matches", async () => {
		const account = await openChecking();
		await add(account.id, { label: "Boulangerie" });
		await add(account.id, { label: "Boulangerie Dupont" });
		const kept = await add(account.id, { label: "Pharmacie" });

		await expect(
			bulkDeleteTransactions(
				deps(),
				{ filter: { accountIds: [account.id], q: "boulangerie" } },
				asUser,
			),
		).resolves.toBe(2);

		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(findTransaction(deps(), kept)).resolves.not.toBeNull();
	});

	it("deletes nothing when an id names no transaction", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await expect(
			bulkDeleteTransactions(deps(), { ids: [id, "nope"] }, asUser),
		).rejects.toMatchObject({ fields: [{ path: "ids", code: "invalid_value" }] });

		await expect(findTransaction(deps(), id)).resolves.not.toBeNull();
	});

	it("never deletes a snapshot or an opening anchor named by id", async () => {
		const account = await openChecking();
		const anchor = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "opening_anchor")))
			.get();

		await expect(
			bulkDeleteTransactions(deps(), { ids: [anchor?.id ?? ""] }, asUser),
		).rejects.toMatchObject({ fields: [{ path: "ids", code: "invalid_value" }] });
	});
});

// Every test shares one database, and candidates are searched across all
// accounts: each amount is used once, so another test's rows never qualify.
let lastTransferAmount = 987_000;
const transferAmount = () => (lastTransferAmount += 13);

async function openHousehold() {
	const checkingAccount = await openChecking({ name: "Compte courant" });
	const livret = await openChecking({
		name: "Livret A",
		subtype: "savings",
		openingBalance: toMinorUnits(0),
	});
	const card = await openChecking({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: toMinorUnits(0),
	});

	return { checking: checkingAccount, livret, card };
}

async function transferRows(entryId: string) {
	return temp.db
		.select()
		.from(transfers)
		.where(
			or(eq(transfers.outflowTransactionId, entryId), eq(transfers.inflowTransactionId, entryId)),
		);
}

async function insertTransfer(outflow: string, inflow: string, kind: TransferKind) {
	await temp.db.insert(transfers).values({
		id: crypto.randomUUID(),
		outflowTransactionId: outflow,
		inflowTransactionId: inflow,
		kind,
		createdAt: 0,
	});
}

/**
 * `add`, then undoes the transfer step 6 may have made, for the tests that
 * need the row unmatched.
 */
async function addStandard(accountId: string, overrides: Partial<NormalizedTransaction> = {}) {
	const id = await add(accountId, overrides);
	const [linked] = await transferRows(id);

	if (linked !== undefined) {
		await unmatchTransfer(deps(), linked.id, { origin: "user" });
	}

	return id;
}

describe("transferCandidates", () => {
	it("offers only the opposite amount in another account within four days", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const dayFour = await addStandard(livret.id, {
			date: "2026-09-14",
			amount: toMinorUnits(amount),
		});
		await add(livret.id, { date: "2026-09-15", amount: toMinorUnits(amount) });
		await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(amount) });
		await add(livret.id, { date: "2026-09-11", amount: toMinorUnits(amount - 1) });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([
			{
				id: dayFour,
				date: "2026-09-14",
				label: "Boulangerie",
				amount,
				currency: "EUR",
				accountId: livret.id,
				accountName: "Livret A",
			},
		]);
	});

	it("lists the closest date first, before or after", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const far = await addStandard(livret.id, { date: "2026-09-13", amount: toMinorUnits(-amount) });
		const near = await add(card.id, { date: "2026-09-09", amount: toMinorUnits(-amount) });

		const candidates = await transferCandidates(deps(), source);

		expect(candidates.map((candidate) => candidate.id)).toEqual([near, far]);
	});

	it("leaves out another currency, zero amounts and a matched counterpart", async () => {
		const { checking: joint, livret } = await openHousehold();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await add(dollars.id, { date: "2026-09-10", amount: toMinorUnits(amount), currency: "USD" });
		const zero = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(0) });
		await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(0) });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), zero)).resolves.toEqual([]);

		const taken = await addStandard(livret.id, {
			date: "2026-09-10",
			amount: toMinorUnits(amount),
		});
		const other = await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(-amount) });
		await matchTransfer(deps(), other, taken, { origin: "user" });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), other)).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(transferCandidates(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

const refusedMatch = async (source: string, counterpart: string) =>
	expect(matchTransfer(deps(), source, counterpart, { origin: "user" })).rejects.toMatchObject({
		code: "VALIDATION_ERROR",
		fields: [{ path: "counterpartId", code: "not_a_candidate" }],
	});

describe("matchTransfer", () => {
	it("links a move to savings as an internal move, moving no balance and touching nothing else", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const groceries = await newCategory("Courses");
		const holidays = await newTag("Vacances");
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const inflow = await addStandard(livret.id, {
			date: "2026-09-13",
			amount: toMinorUnits(amount),
		});
		await updateTransaction(
			deps(),
			outflow,
			{ categoryId: groceries, tagIds: [holidays] },
			{ origin: "user" },
		);
		const before = {
			joint: await history(joint.id),
			livret: await history(livret.id),
			locks: await lockedFields(outflow),
		};

		// Started from the inflow: the negative side is still the outflow.
		const transfer = await matchTransfer(deps(), inflow, outflow, { origin: "user" });

		expect(transfer).toMatchObject({
			outflowTransactionId: outflow,
			inflowTransactionId: inflow,
			kind: "internal_move",
		});
		await expect(transferRows(outflow)).resolves.toEqual([transfer]);
		await expect(history(joint.id)).resolves.toEqual(before.joint);
		await expect(history(livret.id)).resolves.toEqual(before.livret);
		await expect(lockedFields(outflow)).resolves.toEqual(before.locks);
		await expect(categoryOf(outflow)).resolves.toBe(groceries);
		await expect(tagsOf(outflow)).resolves.toEqual([holidays]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({
			transfer: {
				id: transfer.id,
				kind: "internal_move",
				counterpartAccountId: livret.id,
				counterpartAccountName: "Livret A",
			},
		});
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: {
				id: transfer.id,
				counterpartAccountId: joint.id,
				counterpartAccountName: "Compte courant",
			},
		});
		const page = await listTransactions(deps(), { accountIds: [joint.id, livret.id] }, firstPage);
		expect(page.items.map((item) => item.transfer?.counterpartAccountName)).toEqual([
			"Compte courant",
			"Livret A",
		]);
	});

	it("makes a payment into a credit card a card payment", async () => {
		const { checking: joint, card } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await addStandard(card.id, { amount: toMinorUnits(amount) });

		await expect(matchTransfer(deps(), outflow, inflow, { origin: "user" })).resolves.toMatchObject(
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "credit_card_payment" },
		);
	});

	it("refuses a counterpart already matched, writing nothing", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const first = await add(joint.id, { amount: toMinorUnits(-amount) });
		const second = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		await matchTransfer(deps(), first, inflow, { origin: "user" });

		await expect(matchTransfer(deps(), second, inflow, { origin: "user" })).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "counterpartId", code: "not_a_candidate" }],
		});
		await expect(transferRows(second)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toHaveLength(1);
	});

	it("refuses another currency, two zeros, the same account and an unknown counterpart", async () => {
		const { checking: joint, livret } = await openHousehold();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const amount = transferAmount();
		const euros = await add(joint.id, { amount: toMinorUnits(-amount) });
		const usd = await add(dollars.id, { amount: toMinorUnits(amount), currency: "USD" });
		const zero = await add(joint.id, { amount: toMinorUnits(0) });
		const otherZero = await add(livret.id, { amount: toMinorUnits(0) });
		const sameAccount = await add(joint.id, { amount: toMinorUnits(amount) });

		await refusedMatch(euros, usd);
		await refusedMatch(zero, otherZero);
		await refusedMatch(euros, sameAccount);
		await refusedMatch(euros, "nope");
		await expect(
			temp.db.select().from(transfers).where(eq(transfers.outflowTransactionId, euros)),
		).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { checking: joint } = await openHousehold();
		const id = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });

		await expect(matchTransfer(deps(), "nope", id, { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

/** Two accounts and the transfer step 6 links between them on creation. */
async function matchedPair(date = "2026-09-10") {
	const household = await openHousehold();
	const amount = transferAmount();
	const outflow = await add(household.checking.id, { date, amount: toMinorUnits(-amount) });
	const inflow = await add(household.livret.id, { date, amount: toMinorUnits(amount) });
	const [transfer] = await transferRows(outflow);

	if (transfer === undefined) {
		throw new Error("Step 6 did not link the pair.");
	}

	return { ...household, amount, outflow, inflow, transfer };
}

describe("unmatchTransfer", () => {
	it("returns both sides to standard transactions", async () => {
		const { outflow, inflow, transfer, checking: joint } = await matchedPair();
		const before = await history(joint.id);

		await unmatchTransfer(deps(), transfer.id, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ transfer: null });
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
		await expect(history(joint.id)).resolves.toEqual(before);
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
	});

	it("answers NOT_FOUND for an unknown transfer", async () => {
		await expect(unmatchTransfer(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("a transfer when a side goes", () => {
	it("goes with a deleted side, the other one standard again", async () => {
		const { outflow, inflow } = await matchedPair();

		await deleteTransaction(deps(), outflow, { origin: "user" });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a bulk delete", async () => {
		const { outflow, inflow } = await matchedPair();

		await bulkDeleteTransactions(deps(), { ids: [inflow] }, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a bulk delete of both sides", async () => {
		const { outflow, inflow } = await matchedPair();

		await expect(
			bulkDeleteTransactions(deps(), { ids: [outflow, inflow] }, { origin: "user" }),
		).resolves.toBe(2);
		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("goes with a reverted import", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const { importId, result } = await importStatement(
			joint.id,
			statementOf(line({ date: "2026-09-10", amount: toMinorUnits(-amount), label: "VIR LIVRET" })),
		);
		const [outflow = ""] = result.created;
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await expect(transferRows(outflow)).resolves.toHaveLength(1);

		await revert(importId);

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a deleted account, the other account's side staying", async () => {
		const { checking: joint, outflow, inflow } = await matchedPair();

		await deleteAccount(deps(), joint.id, { origin: "user" });

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes when a side's amount changes, and stays when only its date or label does", async () => {
		const kept = await matchedPair();
		const dropped = await matchedPair();

		await updateTransaction(
			deps(),
			kept.outflow,
			{ date: "2026-09-12", label: "Épargne" },
			{ origin: "user" },
		);
		await updateTransaction(
			deps(),
			dropped.outflow,
			{ amount: toMinorUnits(-(dropped.amount - 50)) },
			{ origin: "user" },
		);

		// The sheet sends every field, the unchanged amount included.
		await updateTransaction(
			deps(),
			kept.inflow,
			{ amount: toMinorUnits(kept.amount), label: "Épargne reçue" },
			{ origin: "user" },
		);

		await expect(transferRows(kept.outflow)).resolves.toEqual([kept.transfer]);
		await expect(transferRows(dropped.outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), dropped.inflow)).resolves.toMatchObject({
			transfer: null,
		});
	});
});

/** A transfer of `kind` from `outflowAccount` to `inflowAccount`, inserted as is. */
async function pairOf(kind: TransferKind, outflowAccount: string, inflowAccount: string) {
	const amount = transferAmount();
	const outflow = await add(outflowAccount, {
		amount: toMinorUnits(-amount),
		label: `${kind} out`,
	});
	const inflow = await addStandard(inflowAccount, {
		amount: toMinorUnits(amount),
		label: `${kind} in`,
	});
	await insertTransfer(outflow, inflow, kind);

	return { outflow, inflow };
}

async function openLoan() {
	return openChecking({
		name: "Prêt immobilier",
		type: "loan",
		subtype: "mortgage",
		openingBalance: toMinorUnits(18_000_000),
	});
}

async function openPea() {
	return openChecking({
		name: "PEA",
		type: "investment",
		subtype: "pea",
		openingBalance: toMinorUnits(2_500_000),
	});
}

/** A transfer of `kind` from `outflowAccount` to `inflowAccount`, linked by a real match. */
async function matchedOf(kind: TransferKind, outflowAccount: string, inflowAccount: string) {
	const amount = transferAmount();
	const outflow = await addStandard(outflowAccount, {
		amount: toMinorUnits(-amount),
		label: `${kind} out`,
	});
	const inflow = await addStandard(inflowAccount, {
		amount: toMinorUnits(amount),
		label: `${kind} in`,
	});
	const transfer = await matchTransfer(deps(), outflow, inflow, { origin: "user" });
	expect(transfer.kind).toBe(kind);

	return { outflow, inflow };
}

/** A repayment from `outflowAccount` into `loanAccount`. */
const loanPaymentOf = (outflowAccount: string, loanAccount: string) =>
	matchedOf("loan_payment", outflowAccount, loanAccount);

/** A contribution from `outflowAccount` into `investmentAccount`. */
const contributionOf = (outflowAccount: string, investmentAccount: string) =>
	matchedOf("investment_contribution", outflowAccount, investmentAccount);

const sortedIds = (page: { items: { id: string }[] }) =>
	page.items.map((item) => item.id).toSorted();

describe("the direction filter", () => {
	it("partitions every case as `direction` does", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const mortgage = await openLoan();
		const pea = await openPea();
		const accountIds = [joint.id, livret.id, card.id, mortgage.id, pea.id];
		// Amounts of their own: step 6 would link them to another test's rows.
		const earned = transferAmount();
		const expense = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "expense",
		});
		const income = await add(joint.id, { amount: toMinorUnits(earned), label: "income" });
		const zero = await add(joint.id, { amount: toMinorUnits(0), label: "zero" });
		const move = await pairOf("internal_move", joint.id, livret.id);
		const cardPayment = await pairOf("credit_card_payment", joint.id, card.id);
		const loan = await loanPaymentOf(joint.id, mortgage.id);
		const investment = await contributionOf(joint.id, pea.id);
		const expected = {
			income: [income],
			expense: [expense, zero, loan.outflow, investment.outflow],
			transfer: [
				move.outflow,
				move.inflow,
				cardPayment.outflow,
				cardPayment.inflow,
				loan.inflow,
				investment.inflow,
			],
		};

		const all = await listTransactions(deps(), { accountIds }, firstPage);
		const [incomes, expenses, moves] = await Promise.all(
			(["income", "expense", "transfer"] as const).map(async (value) =>
				listTransactions(deps(), { accountIds, direction: [value] }, firstPage),
			),
		);

		const byRule = (value: string) =>
			all.items
				.filter((item) => direction(item) === value)
				.map((item) => item.id)
				.toSorted();
		expect(byRule("income")).toEqual(expected.income.toSorted());
		expect(byRule("expense")).toEqual(expected.expense.toSorted());
		expect(byRule("transfer")).toEqual(expected.transfer.toSorted());
		expect(incomes && sortedIds(incomes)).toEqual(byRule("income"));
		expect(expenses && sortedIds(expenses)).toEqual(byRule("expense"));
		expect(moves && sortedIds(moves)).toEqual(byRule("transfer"));
		await expect(
			listTransactions(deps(), { accountIds, direction: ["income", "expense"] }, firstPage),
		).resolves.toMatchObject({ total: 5 });
		await expect(
			listTransactions(deps(), { accountIds, direction: [] }, firstPage),
		).resolves.toEqual({ items: [], total: 0 });
		await expect(sumTransactions(deps(), { accountIds, direction: ["income"] })).resolves.toEqual([
			{ currency: "EUR", amount: earned, count: 1 },
		]);
	});
});

const byCategoryAndAmount = (rows: { categoryId: string | null; amount: number }[]) =>
	rows.toSorted(
		(a, b) => String(a.categoryId).localeCompare(String(b.categoryId)) || a.amount - b.amount,
	);

describe("cashFlowByCategory", () => {
	it("sums per category and sign exactly the rows `countsInCashFlow` counts", async () => {
		const { livret, card } = await openHousehold();
		const mortgage = await openLoan();
		const pea = await openPea();
		// Opened in August, so a row can sit on the last day before the month.
		const joint = await openChecking({ name: "Compte courant", openingDate: "2026-08-01" });
		const accountIds = [joint.id, livret.id, card.id, mortgage.id, pea.id];
		const groceries = await newCategory("Courses");
		const inCategory = async (amount: number, date = "2026-09-10") => {
			const id = await add(joint.id, { amount: toMinorUnits(amount), date, label: "Courses" });
			await updateTransaction(deps(), id, { categoryId: groceries }, asUser);

			return id;
		};
		// Amounts of their own: step 6 would link them to another test's rows.
		await inCategory(-transferAmount());
		await inCategory(transferAmount());
		await inCategory(-transferAmount(), "2026-09-01");
		await inCategory(-transferAmount(), "2026-09-30");
		await inCategory(-transferAmount(), "2026-10-01");
		await inCategory(-transferAmount(), "2026-08-31");
		await add(joint.id, { amount: toMinorUnits(transferAmount()), label: "income" });
		await add(joint.id, { amount: toMinorUnits(-transferAmount()), label: "expense" });
		await add(joint.id, { amount: toMinorUnits(0), label: "zero" });
		const excluded = await inCategory(-transferAmount());
		await updateTransaction(deps(), excluded, { excluded: true }, asUser);
		const pendingRow = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "pending",
			pending: true,
		});
		await updateTransaction(deps(), pendingRow, { categoryId: groceries }, asUser);
		await add(joint.id, {
			amount: toMinorUnits(transferAmount()),
			label: "pending",
			pending: true,
		});
		const categorisedSide = await inCategory(-transferAmount());
		const counterpart = await addStandard(livret.id, {
			amount: toMinorUnits(transferAmount()),
			label: "side in",
		});
		await insertTransfer(categorisedSide, counterpart, "internal_move");
		await pairOf("internal_move", joint.id, livret.id);
		await pairOf("credit_card_payment", joint.id, card.id);
		await loanPaymentOf(joint.id, mortgage.id);
		await contributionOf(joint.id, pea.id);

		const all = await listTransactions(deps(), { accountIds }, firstPage);
		const expected = new Map<string, { categoryId: string | null; amount: number }>();
		for (const item of all.items) {
			if (item.date >= "2026-09-01" && item.date <= "2026-09-30" && countsInCashFlow(item)) {
				const key = `${item.categoryId}:${item.amount > 0}`;
				const current = expected.get(key);
				expected.set(key, {
					categoryId: item.categoryId,
					amount: (current?.amount ?? 0) + item.amount,
				});
			}
		}
		const rows = await cashFlowByCategory(deps(), {
			from: "2026-09-01",
			to: "2026-09-30",
			accountIds,
		});

		expect(byCategoryAndAmount(rows)).toEqual(byCategoryAndAmount([...expected.values()]));
		// Courses: both signs of three counted expenses and one refund, and
		// uncategorised: one income, then the expense, the zero and two outflows.
		expect(rows).toHaveLength(4);
		await expect(
			cashFlowByCategory(deps(), { from: "2026-09-01", to: "2026-09-30", accountIds: [] }),
		).resolves.toEqual([]);
	});
});

describe("transfer sides and categories", () => {
	it("leaves a transfer side out of « Sans catégorie »", async () => {
		const { checking: joint, livret, outflow, inflow } = await matchedPair();
		const standard = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, livret.id], uncategorised: true },
			firstPage,
		);

		expect(page.items.map((item) => item.id)).toEqual([standard]);
		expect(page.items.map((item) => item.id)).not.toContain(outflow);
		expect(page.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("lists the outflow of a loan payment under « Sans catégorie », as the dashboard counts it", async () => {
		const { checking: joint } = await openHousehold();
		const mortgage = await openLoan();
		const { outflow, inflow } = await loanPaymentOf(joint.id, mortgage.id);

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, mortgage.id], uncategorised: true, direction: ["expense"] },
			firstPage,
		);
		const all = await listTransactions(
			deps(),
			{ accountIds: [joint.id, mortgage.id], uncategorised: true },
			firstPage,
		);

		expect(page.items.map((item) => item.id)).toEqual([outflow]);
		expect(all.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("sets a bulk category on standard rows only, other fields on every row", async () => {
		const { checking: joint, livret, outflow, inflow } = await matchedPair();
		const standard = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });
		const groceries = await newCategory("Courses");
		const outflowLocks = await lockedFields(outflow);

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [joint.id, livret.id] } },
				{ categoryId: groceries, excluded: true },
				{ origin: "user" },
			),
		).resolves.toBe(3);

		await expect(categoryOf(standard)).resolves.toBe(groceries);
		await expect(categoryOf(outflow)).resolves.toBeNull();
		await expect(categoryOf(inflow)).resolves.toBeNull();
		await expect(categoryOriginOf(outflow)).resolves.toBeNull();
		await expect(lockedFields(outflow)).resolves.toEqual([...(outflowLocks ?? []), "excluded"]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ excluded: true });
	});
});

async function rejectedRows(entryId: string) {
	return temp.db
		.select({
			outflow: rejectedTransfers.outflowTransactionId,
			inflow: rejectedTransfers.inflowTransactionId,
		})
		.from(rejectedTransfers)
		.where(
			or(
				eq(rejectedTransfers.outflowTransactionId, entryId),
				eq(rejectedTransfers.inflowTransactionId, entryId),
			),
		);
}

const suggested = async (entryId: string) =>
	(await findTransaction(deps(), entryId))?.transferSuggested;

// Story 11.2: neither an excluded row nor a row of a deactivated account is a
// side, as Sure's `Family::AutoTransferMatchable`.

const exclude = (entryId: string) =>
	updateTransaction(deps(), entryId, { excluded: true }, { origin: "user" });

const deactivate = (accountId: string) => updateAccount(deps(), accountId, { active: false });

describe("transfer matching and excluded or inactive sides", () => {
	it("never offers, links or suggests an excluded candidate", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await exclude(inflow);

		const outflow = await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("gives an excluded source no candidate", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await exclude(outflow);

		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("never offers, links or suggests a row of a deactivated account, either side", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		await deactivate(livret.id);
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-12", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("links the real pair beside an excluded twin, which no longer breaks uniqueness", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const twin = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await exclude(twin);
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const [transfer] = await transferRows(outflow);
		expect(transfer).toMatchObject({ outflowTransactionId: outflow, inflowTransactionId: inflow });

		// Unlinked, the outflow has one candidate left: no suggestion.
		await unmatchTransfer(deps(), transfer?.id ?? "", { origin: "user" });
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("links the real pair beside a twin on a deactivated account", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await deactivate(card.id);
		const twin = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const [transfer] = await transferRows(outflow);
		expect(transfer).toMatchObject({ outflowTransactionId: outflow, inflowTransactionId: inflow });
		await expect(transferRows(twin)).resolves.toEqual([]);

		await unmatchTransfer(deps(), transfer?.id ?? "", { origin: "user" });
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("keeps an existing transfer when a side is excluded or its account deactivated", async () => {
		const { outflow, inflow, livret, transfer } = await matchedPair();

		await exclude(outflow);
		await deactivate(livret.id);

		await expect(transferRows(outflow)).resolves.toEqual([transfer]);
		await expect(transferRows(inflow)).resolves.toEqual([transfer]);
	});
});

describe("automatic transfer matching", () => {
	it("links a unique pair on creation as an internal move, moving nothing else", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const groceries = await newCategory("Courses");
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await updateTransaction(deps(), outflow, { categoryId: groceries }, { origin: "user" });
		const before = { joint: await history(joint.id), locks: await lockedFields(outflow) };

		const inflow = await add(livret.id, { date: "2026-09-14", amount: toMinorUnits(amount) });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "internal_move" },
		]);
		await expect(history(joint.id)).resolves.toEqual(before.joint);
		await expect(lockedFields(outflow)).resolves.toEqual(before.locks);
		await expect(categoryOf(outflow)).resolves.toBe(groceries);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: { counterpartAccountName: "Compte courant" },
			transferSuggested: false,
		});
	});

	it("leaves a row five days away alone, without a suggestion", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const inflow = await add(livret.id, { date: "2026-09-15", amount: toMinorUnits(amount) });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("links a payment into a card as a card payment", async () => {
		const { checking: joint, card } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await add(card.id, { amount: toMinorUnits(amount) });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, kind: "credit_card_payment" },
		]);
	});

	it("links an imported inflow once the import is confirmed, never in the preview", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const statement = statementOf(
			line({ date: "2026-09-12", amount: toMinorUnits(amount), label: "VIR COMPTE" }),
		);

		const previewed = await preview(livret.id, statement);

		await expect(transferRows(outflow)).resolves.toEqual([]);

		const confirmed = await confirm(livret.id, previewed.importId, statement);

		expect(confirmed.groups).toEqual(previewed.result.groups);
		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ inflowTransactionId: confirmed.created[0] },
		]);
	});

	it("links nothing when a row has two candidates, and suggests a match on it", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await importStatement(livret.id, statementOf(line({ amount: toMinorUnits(amount) })));
		await importStatement(card.id, statementOf(line({ amount: toMinorUnits(amount) })));

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(true);
		await expect(transferCandidates(deps(), outflow)).resolves.toHaveLength(2);
		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, livret.id, card.id] },
			firstPage,
		);
		expect(page.items.filter((item) => item.transferSuggested).map((item) => item.id)).toEqual([
			outflow,
		]);
	});

	it("links nothing when the candidate has another candidate, which it suggests", async () => {
		const { checking: joint, livret } = await openHousehold();
		const other = await openChecking({ name: "Compte joint" });
		const amount = transferAmount();
		const savings = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		// Linked on creation, then unlinked with « Dissocier »: one candidate each.
		const shared = await addStandard(other.id, {
			date: "2026-09-06",
			amount: toMinorUnits(-amount),
		});
		await expect(suggested(savings)).resolves.toBe(false);

		const outflow = await add(joint.id, { date: "2026-09-14", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(savings)).resolves.toEqual([]);
		await expect(suggested(savings)).resolves.toBe(true);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(shared)).resolves.toBe(false);
	});

	it("leaves an outflow that two inflows of one file compete for unlinked", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await importStatement(
			livret.id,
			statementOf(
				line({ amount: toMinorUnits(amount), label: "A" }),
				line({ amount: toMinorUnits(amount), label: "B" }),
			),
		);

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("never links two opposite rows of one file on one account", async () => {
		const { checking: joint } = await openHousehold();
		const amount = transferAmount();

		const { result } = await importStatement(
			joint.id,
			statementOf(
				line({ amount: toMinorUnits(-amount), label: "Sortie" }),
				line({ amount: toMinorUnits(amount), label: "Entrée" }),
			),
		);

		expect(result.created).toHaveLength(2);
		await expect(transferRows(result.created[0] ?? "")).resolves.toEqual([]);
	});

	it("never links on an edit or a bulk edit", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount + 1) });

		await updateTransaction(deps(), inflow, { amount: toMinorUnits(amount) }, { origin: "user" });
		await bulkUpdateTransactions(
			deps(),
			{ ids: [outflow, inflow] },
			{ excluded: true },
			{
				origin: "user",
			},
		);

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});
});

describe("rejectTransfer", () => {
	it("undoes the transfer and records the pair", async () => {
		const { outflow, inflow, transfer, checking: joint } = await matchedPair();
		const before = await history(joint.id);

		await rejectTransfer(deps(), transfer.id, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(rejectedRows(outflow)).resolves.toEqual([{ outflow, inflow }]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: null,
			transferSuggested: false,
		});
		await expect(history(joint.id)).resolves.toEqual(before);
	});

	it("never offers nor accepts the rejected pair, and still links others", async () => {
		const { outflow, inflow, transfer, card, amount } = await matchedPair();
		await rejectTransfer(deps(), transfer.id, { origin: "user" });
		const refused = {
			code: "VALIDATION_ERROR",
			fields: [{ path: "counterpartId", code: "not_a_candidate" }],
		};

		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(matchTransfer(deps(), outflow, inflow, { origin: "user" })).rejects.toMatchObject(
			refused,
		);
		await expect(matchTransfer(deps(), inflow, outflow, { origin: "user" })).rejects.toMatchObject(
			refused,
		);

		// Were the rejected pair counted, the outflow would have two candidates
		// and stay unlinked.
		const repaid = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		await expect(transferRows(repaid)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: repaid },
		]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transfer", async () => {
		await expect(rejectTransfer(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

async function rejectedPair() {
	const pair = await matchedPair();
	await rejectTransfer(deps(), pair.transfer.id, { origin: "user" });

	return pair;
}

describe("a rejected pair when a side goes", () => {
	it("goes with a deleted side", async () => {
		const { outflow, inflow } = await rejectedPair();

		await deleteTransaction(deps(), inflow, { origin: "user" });

		await expect(rejectedRows(outflow)).resolves.toEqual([]);
	});

	it("goes with a bulk delete", async () => {
		const { outflow, inflow } = await rejectedPair();

		await bulkDeleteTransactions(deps(), { ids: [outflow] }, { origin: "user" });

		await expect(rejectedRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
	});

	it("goes with a reverted import", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const { importId, result } = await importStatement(
			joint.id,
			statementOf(line({ date: "2026-09-10", amount: toMinorUnits(-amount), label: "VIR" })),
		);
		const [outflow = ""] = result.created;
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const [transfer] = await transferRows(inflow);
		await rejectTransfer(deps(), transfer?.id ?? "", { origin: "user" });

		await revert(importId);

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(rejectedRows(inflow)).resolves.toEqual([]);
	});

	it("goes with a deleted account", async () => {
		const { checking: joint, outflow, inflow } = await rejectedPair();

		await deleteAccount(deps(), joint.id, { origin: "user" });

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(rejectedRows(inflow)).resolves.toEqual([]);
	});
});

// Story 8.1: step 5 applies the enabled rules to the rows an ingest creates.

const labelLike = (value: string) => ({
	conditionType: "transaction_name",
	operator: "like",
	value,
});

describe("rules at ingestion", () => {
	// Every rule reaches every new transaction: none may outlive its test.
	afterEach(async () => {
		await temp.db.delete(rules);
	});

	let created = 0;

	/** A rule setting `categoryId`, created after every earlier one. */
	async function newRule(
		categoryId: string,
		conditions: Parameters<typeof createRule>[1]["conditions"] = [],
		effectiveDate: string | null = null,
	) {
		return newRuleWith(
			[{ actionType: "set_transaction_category", value: categoryId }],
			conditions,
			effectiveDate,
		);
	}

	/** A rule with `actions`, created after every earlier one. */
	async function newRuleWith(
		actions: Parameters<typeof createRule>[1]["actions"],
		conditions: Parameters<typeof createRule>[1]["conditions"] = [],
		effectiveDate: string | null = null,
	) {
		const rule = await createRule(deps(), { effectiveDate, conditions, actions });
		created += 1;
		// Frozen clocks would give two rules the same creation time.
		await temp.db.update(rules).set({ createdAt: created }).where(eq(rules.id, rule.id));

		return rule;
	}

	it("categorises a new transaction a rule matches, with a rule origin and no lock", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [labelLike("carrefour  city")]);

		const hit = await add(account.id, { label: "CB CARREFOUR CITY 12/09" });
		const miss = await add(account.id, { label: "CB AUCHAN" });

		await expect(categoryOf(hit)).resolves.toBe(groceries);
		await expect(categoryOriginOf(hit)).resolves.toBe("rule");
		await expect(lockedFields(hit)).resolves.toEqual(["date", "amount", "label"]);
		await expect(categoryOf(miss)).resolves.toBeNull();
	});

	it("matches an amount above 50,00 in the reporting currency only", async () => {
		const account = await openChecking();
		const dollars = await openChecking({ name: "USD", currency: "USD" });
		const big = await newCategory("Gros achats");
		await newRule(big, [{ conditionType: "transaction_amount", operator: ">", value: "50,00" }]);

		const expense = await add(account.id, { amount: toMinorUnits(-6000) });
		const small = await add(account.id, { amount: toMinorUnits(4000) });
		const income = await add(account.id, { amount: toMinorUnits(6000) });
		const foreign = await add(dollars.id, { amount: toMinorUnits(-6000), currency: "USD" });

		await expect(categoryOf(expense)).resolves.toBe(big);
		await expect(categoryOf(small)).resolves.toBeNull();
		await expect(categoryOf(income)).resolves.toBe(big);
		await expect(categoryOf(foreign)).resolves.toBeNull();
	});

	it("lets the later of two matching rules win, and skips a disabled one", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const other = await newCategory("Autre");
		await newRule(groceries);
		await newRule(leisure);
		const disabled = await newRule(other);
		await setRuleEnabled(deps(), disabled.id, { enabled: false });

		const id = await add(account.id);

		await expect(categoryOf(id)).resolves.toBe(leisure);
	});

	it("reaches only the lines dated on or after the start date", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [], "2026-09-10");

		const before = await add(account.id, { date: "2026-09-09" });
		const on = await add(account.id, { date: "2026-09-10" });

		await expect(categoryOf(before)).resolves.toBeNull();
		await expect(categoryOf(on)).resolves.toBe(groceries);
	});

	it("writes nothing for a rule whose category was deleted, nor for an account condition on a deleted account", async () => {
		const account = await openChecking();
		const gone = await openChecking({ name: "Fermé" });
		const groceries = await newCategory("Courses");
		const deleted = await newCategory("Supprimée");
		await newRule(groceries, [
			{ conditionType: "transaction_account", operator: "=", value: gone.id },
		]);
		await newRule(deleted);
		await temp.db.delete(categories).where(eq(categories.id, deleted));
		await deleteAccount(deps(), gone.id, { origin: "user" });

		const id = await add(account.id);

		await expect(categoryOf(id)).resolves.toBeNull();
	});

	it("categorises a possible duplicate an import creates", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });
		const tolls = await newCategory("Péages");
		await newRule(tolls, [labelLike("péage")]);

		const { result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);

		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1 });
		const [id = ""] = result.created;
		await expect(categoryOf(id)).resolves.toBe(tolls);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
	});

	it("categorises the lines of a confirmed import it matches, and nothing at preview", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [labelLike("carrefour")]);
		const statement = statementOf(
			line({ externalId: "1", label: "CB CARREFOUR MARKET" }),
			line({ externalId: "2", label: "CB BOULANGERIE" }),
			line({ externalId: "3", label: "Carrefour city", date: "2026-09-11" }),
			line({ externalId: "4", label: "VIR SALAIRE", amount: toMinorUnits(215000) }),
			line({ externalId: "5", label: "PRLV EDF" }),
		);

		const { importId } = await preview(account.id, statement);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		const result = await confirm(account.id, importId, statement);

		const categorised = await Promise.all(result.created.map(categoryOf));
		expect(categorised).toEqual([groceries, null, groceries, null, null]);
	});

	// Story 8.2: every action, chained over one planned state per row.

	it("chains a merchant into a tag, and renames and excludes an imported line", async () => {
		const account = await openChecking();
		const amazon = await newMerchant("Amazon");
		const purchases = await newTag("Achats");
		await newRuleWith(
			[
				{ actionType: "set_transaction_merchant", value: amazon },
				{ actionType: "set_transaction_name", value: " Amazon " },
				{ actionType: "exclude_transaction" },
			],
			[labelLike("amzn")],
		);
		await newRuleWith(
			[{ actionType: "set_transaction_tags", value: purchases }],
			[{ conditionType: "transaction_merchant", operator: "=", value: amazon }],
		);

		const { result } = await importStatement(
			account.id,
			statementOf(
				line({ externalId: "1", label: "CB AMZN MKTP" }),
				line({ externalId: "2", label: "PRLV AMZN PRIME" }),
				line({ externalId: "3", label: "CB FNAC" }),
			),
		);

		const [first = "", second = "", other = ""] = result.created;
		const both = [first, second];
		await expect(Promise.all(both.map(merchantOf))).resolves.toEqual([amazon, amazon]);
		await expect(Promise.all(both.map(tagsOf))).resolves.toEqual([[purchases], [purchases]]);
		await expect(Promise.all(both.map(excludedOf))).resolves.toEqual([true, true]);
		await expect(Promise.all(both.map(lockedFields))).resolves.toEqual([[], []]);
		await expect(
			Promise.all(both.map(async (id) => (await findTransaction(deps(), id))?.label)),
		).resolves.toEqual(["Amazon", "Amazon"]);
		await expect(merchantOf(other)).resolves.toBeNull();
		await expect(tagsOf(other)).resolves.toEqual([]);
	});

	it("never renames a line typed by hand, whose label is locked", async () => {
		const account = await openChecking();
		await newRuleWith([{ actionType: "set_transaction_name", value: "Boulangerie Paul" }]);

		const typed = await add(account.id, { label: "CB PAUL" });
		const synced = await add(account.id, { label: "CB PAUL" }, "sync");

		await expect(findTransaction(deps(), typed)).resolves.toMatchObject({ label: "CB PAUL" });
		await expect(findTransaction(deps(), synced)).resolves.toMatchObject({
			label: "Boulangerie Paul",
		});
	});

	it("matches on notes and type, and sees no transfer on a new line", async () => {
		const account = await openChecking();
		const gifts = await newCategory("Cadeaux");
		const moves = await newCategory("Virements");
		await newRule(gifts, [
			{ conditionType: "transaction_notes", operator: "like", value: "cadeau" },
			{ conditionType: "transaction_type", operator: "=", value: "expense" },
		]);
		await newRule(moves, [{ conditionType: "transaction_type", operator: "=", value: "transfer" }]);

		const gift = await add(account.id, { amount: toMinorUnits(-1000), notes: "Cadeau Léa" });
		const refund = await add(account.id, { amount: toMinorUnits(1000), notes: "Cadeau Léa" });

		await expect(categoryOf(gift)).resolves.toBe(gifts);
		await expect(categoryOf(refund)).resolves.toBeNull();
	});

	it("records the expected account without creating an entry or a transfer", async () => {
		const { checking: joint, livret } = await openHousehold();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const id = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "VIR EPARGNE",
		});

		await expect(expectedOf(id)).resolves.toBe(livret.id);
		await expect(transferRows(id)).resolves.toEqual([]);
		await expect(transactionCount(livret.id)).resolves.toBe(0);
	});

	it("never links a line a rule excludes, step 5 running before step 6", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		await newRuleWith([{ actionType: "exclude_transaction" }], [labelLike("interne")]);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR INTERNE" });

		await expect(excludedOf(outflow)).resolves.toBe(true);
		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("pairs a line with the one candidate on the expected account, whatever other accounts hold", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const onLivret = await add(livret.id, { amount: toMinorUnits(amount) });
		await add(card.id, { amount: toMinorUnits(amount) });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: onLivret, kind: "internal_move" },
		]);
	});

	it("leaves a line unpaired when the expected account holds two candidates", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		await add(livret.id, { amount: toMinorUnits(amount), label: "A" });
		await add(livret.id, { amount: toMinorUnits(amount), label: "B" });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("stops a later rule from seeing a rename the locked label refused", async () => {
		const account = await openChecking();
		const bakery = await newCategory("Boulangerie");
		await newRuleWith([{ actionType: "set_transaction_name", value: "Paul" }]);
		await newRule(bakery, [{ conditionType: "transaction_name", operator: "=", value: "Paul" }]);

		const typed = await add(account.id, { label: "CB PAUL" });

		await expect(findTransaction(deps(), typed)).resolves.toMatchObject({ label: "CB PAUL" });
		await expect(categoryOf(typed)).resolves.toBeNull();
	});

	it("narrows the candidate's own list too, so its line with two candidates still pairs", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const onLivret = await add(livret.id, { amount: toMinorUnits(amount) });
		// A second candidate for the Livret A line, unlinked from it: without
		// narrowing its list, the choice would not be mutual.
		await addStandard(card.id, { amount: toMinorUnits(-amount) });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: onLivret },
		]);
	});

	it("keeps a rejected pair apart when one side expects the other's account", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		const [linked] = await transferRows(outflow);
		await rejectTransfer(deps(), linked?.id ?? "", { origin: "user" });

		// A new line makes the expecting side a candidate again: its list is
		// read anew, and the rejected Livret A line must stay out of it.
		await add(card.id, { amount: toMinorUnits(amount) });

		await expect(rejectedRows(outflow)).resolves.toEqual([{ outflow, inflow }]);
		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("pairs an expecting line with the expected account's line when that one arrives later", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		// A second candidate for the inflow, on another account: without the
		// expectation, the inflow would have two and pair with neither.
		await add(card.id, { amount: toMinorUnits(-amount), label: "Autre" });

		const { result } = await importStatement(
			livret.id,
			statementOf(line({ amount: toMinorUnits(amount), label: "VIR RECU" })),
		);

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: result.created[0] },
		]);
	});
});

async function expectedOf(entryId: string) {
	const row = await temp.db
		.select({ expected: transactions.expectedTransferAccountId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.expected;
}

async function write(plan: Map<string, RowPlan>) {
	return temp.db.transaction(async (tx) => applyRulePlan(tx, plan, { origin: "rule" }));
}

describe("applyRulePlan", () => {
	it("writes nothing for an empty plan", async () => {
		await expect(write(new Map())).resolves.toEqual({ changed: [], marked: [] });
	});

	it("writes every planned field with a rule origin, and locks nothing", async () => {
		const { checking: joint, livret } = await openHousehold();
		const groceries = await newCategory("Courses");
		const merchant = await newMerchant("Amazon");
		const kept = await newTag("Voyage");
		const added = await newTag("Achats");
		const id = await add(joint.id, {}, "sync");
		const twin = await add(joint.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [kept] }, { origin: "rule" });

		const written = await write(
			new Map([
				[
					id,
					{
						categoryId: groceries,
						merchantId: merchant,
						addTagIds: [added],
						label: "Amazon",
						excluded: true,
						expectedTransferAccountId: livret.id,
					},
				],
				[twin, { categoryId: groceries }],
			]),
		);

		expect(written).toEqual({ changed: [id, twin], marked: [id] });
		await expect(categoryOf(id)).resolves.toBe(groceries);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
		await expect(merchantOf(id)).resolves.toBe(merchant);
		await expect(tagsOf(id)).resolves.toEqual([added, kept].toSorted());
		await expect(excludedOf(id)).resolves.toBe(true);
		await expect(expectedOf(id)).resolves.toBe(livret.id);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "Amazon" });
		await expect(lockedFields(id)).resolves.toEqual([]);
		await expect(categoryOf(twin)).resolves.toBe(groceries);
	});

	it("skips locked fields, and values the row already holds", async () => {
		const { checking: joint, livret } = await openHousehold();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const merchant = await newMerchant("Amazon");
		const tag = await newTag("Achats");
		const locked = await add(joint.id);
		await updateTransaction(deps(), locked, { categoryId: leisure }, { origin: "user" });
		// Clearing a field by hand locks it too, as in Sure; set here directly.
		await temp.db
			.update(transactions)
			.set({ lockedFields: ["label", "category", "merchant", "tags", "excluded"] })
			.where(eq(transactions.entryId, locked));
		const already = await add(joint.id, {}, "sync");
		await write(
			new Map([[already, { categoryId: groceries, expectedTransferAccountId: livret.id }]]),
		);

		const written = await write(
			new Map([
				[
					locked,
					{
						categoryId: groceries,
						merchantId: merchant,
						addTagIds: [tag],
						label: "X",
						excluded: true,
					},
				],
				[already, { categoryId: groceries, expectedTransferAccountId: livret.id }],
			]),
		);

		expect(written).toEqual({ changed: [], marked: [] });
		await expect(categoryOf(locked)).resolves.toBe(leisure);
		await expect(categoryOriginOf(locked)).resolves.toBe("user");
		await expect(merchantOf(locked)).resolves.toBeNull();
		await expect(tagsOf(locked)).resolves.toEqual([]);
		await expect(excludedOf(locked)).resolves.toBe(false);
		await expect(findTransaction(deps(), locked)).resolves.toMatchObject({ label: "Boulangerie" });
	});

	it("adds a tag beside the others, and skips it at the cap", async () => {
		const account = await openChecking();
		const full = await Promise.all(
			Array.from({ length: MAX_TAGS_PER_TRANSACTION }, (_, index) => newTag(`Plein ${index}`)),
		);
		const added = await newTag("Achats");
		const crowded = await add(account.id);
		await updateTransaction(deps(), crowded, { tagIds: full }, { origin: "rule" });

		await expect(write(new Map([[crowded, { addTagIds: [added] }]]))).resolves.toEqual({
			changed: [],
			marked: [],
		});
		await expect(tagsOf(crowded)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
	});

	it("skips a planned tag the row carries since the plan, spending no slot", async () => {
		const account = await openChecking();
		const almost = await Promise.all(
			Array.from({ length: MAX_TAGS_PER_TRANSACTION - 1 }, (_, index) =>
				newTag(`Presque ${index}`),
			),
		);
		const carried = almost[0] ?? "";
		const added = await newTag("Achats");
		const id = await add(account.id);
		await updateTransaction(deps(), id, { tagIds: almost }, { origin: "rule" });

		await expect(write(new Map([[id, { addTagIds: [carried] }]]))).resolves.toEqual({
			changed: [],
			marked: [],
		});
		await expect(write(new Map([[id, { addTagIds: [carried, added] }]]))).resolves.toEqual({
			changed: [id],
			marked: [],
		});
		await expect(tagsOf(id)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
		await expect(tagsOf(id)).resolves.toContain(added);
	});

	it("writes nothing for a row, category, merchant, tag or account gone since the plan", async () => {
		const { checking: joint } = await openHousehold();
		const id = await add(joint.id, {}, "sync");

		const written = await write(
			new Map<string, RowPlan>([
				[
					id,
					{
						categoryId: "gone",
						merchantId: "gone",
						addTagIds: ["gone"],
						expectedTransferAccountId: "gone",
					},
				],
				["no-such-row", { label: "X" }],
			]),
		);

		expect(written).toEqual({ changed: [], marked: [] });
		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(expectedOf(id)).resolves.toBeNull();
	});

	it("expects no counterpart on a row in a transfer, nor in the row's own account", async () => {
		const { outflow, checking: joint } = await matchedPair();
		const { livret } = await openHousehold();
		const alone = await add(joint.id, {}, "sync");

		await expect(
			write(
				new Map([
					[outflow, { expectedTransferAccountId: livret.id }],
					[alone, { expectedTransferAccountId: joint.id }],
				]),
			),
		).resolves.toEqual({ changed: [], marked: [] });
		await expect(expectedOf(outflow)).resolves.toBeNull();
		await expect(expectedOf(alone)).resolves.toBeNull();
	});
});

// Story 8.3: applying rules to history reads every transaction as a rule does.

const candidatesOf = async (ids: readonly string[], from: string | null = null) =>
	(await ruleCandidates(temp.db, from)).filter((candidate) => ids.includes(candidate.id));

describe("ruleCandidates", () => {
	it("reads what a rule reads and writes, locks and the transfer kind included", async () => {
		const { outflow, inflow, livret } = await matchedPair();
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const merchant = await newMerchant("Amazon");
		const tag = await newTag("Achats");
		const edited = await add(account.id, { label: "AMZN Mktp", notes: "Colis" }, "sync");
		await updateTransaction(
			deps(),
			edited,
			{ categoryId: groceries, merchantId: merchant, tagIds: [tag], excluded: true },
			{ origin: "user" },
		);
		await temp.db
			.update(transactions)
			.set({ expectedTransferAccountId: livret.id })
			.where(eq(transactions.entryId, edited));

		const [read] = await candidatesOf([edited]);

		expect(read).toMatchObject({
			id: edited,
			accountId: account.id,
			date: "2026-09-10",
			amount: -4290,
			currency: "EUR",
			label: "AMZN Mktp",
			notes: "Colis",
			merchantId: merchant,
			categoryId: groceries,
			tagIds: [tag],
			excluded: true,
			transfer: null,
			expectedTransferAccountId: livret.id,
		});
		expect(read?.lockedFields).toEqual(
			expect.arrayContaining(["category", "merchant", "tags", "excluded"]),
		);
		await expect(candidatesOf([outflow, inflow])).resolves.toMatchObject([
			{ transfer: { kind: "internal_move" } },
			{ transfer: { kind: "internal_move" } },
		]);
	});

	it("keeps rows dated on or after the start, every date without one", async () => {
		const account = await openChecking({ openingDate: "2026-05-01" });
		const may = await add(account.id, { date: "2026-05-31" });
		const june = await add(account.id, { date: "2026-06-01" });

		await expect(candidatesOf([may, june], "2026-06-01")).resolves.toMatchObject([{ id: june }]);
		await expect(candidatesOf([may, june])).resolves.toMatchObject([{ id: may }, { id: june }]);
	});

	it("leaves out the opening anchor and a reconciliation", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await snapshot(account.id, "2026-09-15", 1000);

		const own = (await ruleCandidates(temp.db, null)).filter(
			(candidate) => candidate.accountId === account.id,
		);

		expect(own.map((candidate) => candidate.id)).toEqual([id]);
	});

	it("reads the tags of more rows than one lookup holds", async () => {
		const account = await openChecking();
		const tag = await newTag("Lot");
		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: Array.from({ length: 520 }, (_, index) =>
					line({ label: `Ligne ${index}`, amount: toMinorUnits(-(index + 1)) }),
				),
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "sync" },
		);
		const last = result.created.at(-1) ?? "";
		await temp.db.insert(taggings).values({ transactionId: last, tagId: tag });

		const read = await candidatesOf(result.created);

		expect(read).toHaveLength(520);
		expect(read.find((candidate) => candidate.id === last)?.tagIds).toEqual([tag]);
	});
});

describe("applyRulePlanToHistory", () => {
	it("pairs an existing row with the expected account's line it had to share before", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		// Both inflows come first, so the outflow arrives with two candidates
		// and step 6 leaves every row unpaired.
		await add(card.id, { amount: toMinorUnits(amount), label: "Remboursement" });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount), label: "VIR RECU" });
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		await expect(transferRows(outflow)).resolves.toEqual([]);

		const changed = await applyRulePlanToHistory(
			deps(),
			new Map([[outflow, { expectedTransferAccountId: livret.id }]]),
			{ origin: "rule" },
		);

		expect(changed).toBe(1);
		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "internal_move" },
		]);
	});
});

/** A bank account on a connection of its own, as the callback stores it. */
async function newBankAccount() {
	const connectionId = crypto.randomUUID();
	const id = crypto.randomUUID();
	await temp.db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		createdAt: 0,
		updatedAt: 0,
	});
	await temp.db.insert(bankAccounts).values({
		id,
		bankConnectionId: connectionId,
		identificationHash: `hash-${id}`,
		providerUid: `uid-${id}`,
		name: "Compte courant",
		currency: "EUR",
		createdAt: 0,
		updatedAt: 0,
	});

	return { id, connectionId };
}

async function valuationsOf(accountId: string) {
	return temp.db
		.select({ kind: entries.valuationKind, date: entries.date, amount: entries.amount })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")))
		.orderBy(entries.date);
}

const link = (
	accountId: string,
	bankAccountId: string,
	balance: number | null,
	date: string | null = null,
) =>
	linkBankAccount(
		deps(),
		accountId,
		{ bankAccountId, balance: balance === null ? null : { amount: toMinorUnits(balance), date } },
		{ origin: "sync" },
	);

describe("linkBankAccount", () => {
	it("takes today's bank balance and derives every earlier day backward", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(250000) });
		const entriesBefore = await temp.db
			.select()
			.from(entries)
			.where(eq(entries.accountId, account.id));

		await link(account.id, bank.id, 100000);

		const stored = await temp.db.select().from(accounts).where(eq(accounts.id, account.id)).get();
		expect(stored?.bankAccountId).toBe(bank.id);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 100000 },
		]);
		// Nothing the account held changes: only the anchor is added.
		await expect(
			temp.db.select().from(entries).where(eq(entries.accountId, account.id)),
		).resolves.toEqual(expect.arrayContaining(entriesBefore));
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-15")).toBe(100000);
		expect(days.get("2026-09-14")).toBe(-150000);
		expect(days.get("2026-09-10")).toBe(-150000);
		expect(days.get("2026-09-09")).toBe(-145710);
		// The opening amount is ignored: its day is derived like any other.
		expect(days.get("2026-09-01")).toBe(-145710);
		expect(days.has("2026-08-31")).toBe(false);
		expect(days.size).toBe(21);
	});

	it("resets a reconciled day to its value, and derives the days before it from it", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1000) });
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-11", balance: toMinorUnits(50000) },
			{ origin: "user" },
		);

		await link(account.id, bank.id, 100000);

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-12")).toBe(100000);
		expect(days.get("2026-09-11")).toBe(50000);
		expect(days.get("2026-09-05")).toBe(50000);
		expect(days.get("2026-09-04")).toBe(51000);
		expect(days.get("2026-09-01")).toBe(51000);
	});

	it("dates the anchor on the day the bank's balance describes, never after today", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-21", amount: toMinorUnits(-500) });

		// A closing balance of yesterday: today's line comes after it.
		await link(account.id, bank.id, 100000, "2026-09-20");

		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-20",
			amount: 100000,
		});
		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(100000);
		expect(days.get("2026-09-21")).toBe(99500);

		await link(account.id, bank.id, 100000, "2026-09-30");

		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 100000,
		});
	});

	it("owes a card's bank balance, whichever sign the bank gives it", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});
		const bank = await newBankAccount();

		await link(card.id, bank.id, -30000);

		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toEqual({
			amount: 30000,
			currency: "EUR",
		});
		await expect(valuationsOf(card.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 30000,
		});
	});

	it("links without an anchor when the bank gives no balance, and stays forward", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });

		await link(account.id, bank.id, null);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-09-21")).toBe(119166);
	});

	it("replaces an earlier bank balance rather than adding a second one", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000);
		setToday("2026-09-22T10:00:00Z");

		await link(account.id, bank.id, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-22", amount: 90000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(90000);
		expect(days.get("2026-09-22")).toBe(90000);
	});

	it("drops an earlier anchor when relinked without a balance, and goes forward", async () => {
		const account = await openChecking();
		const first = await newBankAccount();
		await link(account.id, first.id, 100000);
		// The connection goes: the link clears, the anchor stays behind.
		await temp.db.delete(bankConnections).where(eq(bankConnections.id, first.connectionId));
		const second = await newBankAccount();

		await link(account.id, second.id, null);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-09-21")).toBe(119166);
	});

	it("refuses an unknown account and writes nothing", async () => {
		const bank = await newBankAccount();

		await expect(link(crypto.randomUUID(), bank.id, 100000)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("refuses a bank account that already feeds another account", async () => {
		const first = await openChecking();
		const second = await openChecking();
		const bank = await newBankAccount();
		await link(first.id, bank.id, 100000);

		await expect(link(second.id, bank.id, 100000)).rejects.toThrow();
		await expect(valuationsOf(second.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
	});
});

async function linkedAccount(balance = 100000) {
	const account = await openChecking();
	const bank = await newBankAccount();
	await link(account.id, bank.id, balance);

	return { account, bank };
}

describe("a bank-linked account", () => {
	it("recomputes every earlier day when a transaction is added, today staying the bank's", async () => {
		const { account } = await linkedAccount();

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-2000) });

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-05")).toBe(100000);
		expect(days.get("2026-09-04")).toBe(102000);
		expect(days.get("2026-09-01")).toBe(102000);
	});

	it("recomputes every earlier day when a transaction is deleted", async () => {
		const { account } = await linkedAccount();
		const id = await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-2000) });

		await deleteTransaction(deps(), id, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-04")).toBe(100000);
		expect(days.get("2026-09-01")).toBe(100000);
	});

	it("goes forward from the bank balance for a day after it", async () => {
		const { account } = await linkedAccount();

		await add(account.id, { date: "2026-09-25", amount: toMinorUnits(-500) });

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-24")).toBe(100000);
		expect(days.get("2026-09-25")).toBe(99500);
		expect(days.get("2026-09-20")).toBe(100000);
	});

	it("follows an earlier opening date an import moves it to", async () => {
		const { account } = await linkedAccount();

		await ingest(
			deps(),
			account.id,
			{
				transactions: [line({ date: "2026-08-20", amount: toMinorUnits(-1000) })],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user", moveOpeningDate: "2026-08-19" },
		);

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-08-20")).toBe(100000);
		expect(days.get("2026-08-19")).toBe(101000);
		expect(days.has("2026-08-18")).toBe(false);
	});

	it("reads a snapshot's gap against the day after it, derived backward from the bank", async () => {
		const { account } = await linkedAccount();
		await add(account.id, { date: "2026-09-12", amount: toMinorUnits(-2000) });
		await add(account.id, { date: "2026-09-11", amount: toMinorUnits(-700) });
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-11", balance: toMinorUnits(50000) },
			{ origin: "user" },
		);

		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });

		// The 12th ends on the bank's 1 000,00 and spent 20,00: the 11th would
		// have ended on 1 020,00 without the snapshot.
		expect(items).toMatchObject([
			{ date: "2026-09-11", balance: 50000, computed: 102000, gap: -52000 },
		]);
		await expect(findSnapshot(deps(), items[0]?.id ?? "")).resolves.toMatchObject({
			computed: 102000,
			gap: -52000,
		});
	});

	it("reads an earlier snapshot against the day after it, which the later one set", async () => {
		const { account } = await linkedAccount();
		await add(account.id, { date: "2026-09-11", amount: toMinorUnits(-700) });
		const snap = (date: string, balance: number) =>
			recordSnapshot(
				deps(),
				account.id,
				{ date, balance: toMinorUnits(balance) },
				{ origin: "user" },
			);
		await snap("2026-09-11", 50000);
		await snap("2026-09-05", 60000);

		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });

		// Nothing moves on the 6th, which ends on 500,00 + 7,00 carried back from the 11th.
		expect(items.find((item) => item.date === "2026-09-05")).toMatchObject({
			computed: 50700,
			gap: 9300,
		});
	});

	it("reads a snapshot on the bank balance's day forward, as any other account", async () => {
		const { account } = await linkedAccount();
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-21", balance: toMinorUnits(90000) },
			{ origin: "user" },
		);

		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });

		expect(items).toMatchObject([{ date: "2026-09-21", computed: 100000, gap: -10000 }]);
	});

	it("goes forward again once its connection is gone, the anchor left aside", async () => {
		const { account, bank } = await linkedAccount();
		await temp.db.delete(bankConnections).where(eq(bankConnections.id, bank.connectionId));

		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(100000);
		expect(days.get("2026-09-10")).toBe(95710);
		expect(days.get("2026-09-21")).toBe(95710);
	});
});

// Story 10.3: the keyed path of `ingest`, as a bank sync drives it.

/** The bank's 995,00, as it describes the end of `date`. */
const bankBalance = (date: string) => ({ amount: toMinorUnits(99500), currency: "EUR", date });

async function linkedChecking(balance = 100000, overrides: Partial<NewAccountInput> = {}) {
	const account = await openChecking(overrides);
	const bank = await newBankAccount();
	await link(account.id, bank.id, balance);

	return { account, bank };
}

const sync = (
	accountId: string,
	connectionId: string,
	lines: NormalizedTransaction[],
	balance: ParsedStatement["balance"] = null,
) =>
	ingest(
		deps(),
		accountId,
		{ transactions: lines, balance, rejected: [] },
		{ connectionId },
		{ origin: "sync" },
	);

const newBankLine = (overrides: Partial<NormalizedTransaction> = {}) =>
	line({ externalId: "EB1", date: "2026-09-12", label: "CARREFOUR", ...overrides });

async function keyRows(entryId: string) {
	return temp.db
		.select({
			source: entryKeys.source,
			importId: entryKeys.importId,
			connectionId: entryKeys.connectionId,
		})
		.from(entryKeys)
		.where(eq(entryKeys.entryId, entryId));
}

describe("ingest from a bank connection", () => {
	it("keys its lines under the connector and the connection, and rewrites the anchor", async () => {
		const { account, bank } = await linkedChecking();

		const result = await sync(account.id, bank.connectionId, [newBankLine()], {
			amount: toMinorUnits(95710),
			currency: "EUR",
			date: "2026-09-21",
		});

		const [id = ""] = result.created;
		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-21", balance: 95710 });
		await expect(keyRows(id)).resolves.toEqual([
			{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
			{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
		]);
		await expect(entryImport(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual([]);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 95710 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(95710);
		expect(days.get("2026-09-11")).toBe(100000);
		await expect(entryOrigins(deps(), [id])).resolves.toEqual(
			new Map([[id, { kind: "bank", connector: "enable-banking" }]]),
		);
	});

	it("creates nothing the second time, keyed by reference or, without one, by fingerprint", async () => {
		const { account, bank } = await linkedChecking();
		const lines = [newBankLine(), newBankLine({ externalId: null, label: "SANS REFERENCE" })];
		await sync(account.id, bank.connectionId, lines);

		const again = await sync(account.id, bank.connectionId, lines);

		expect(again.created).toEqual([]);
		expect(again.groups.present).toHaveLength(2);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("dates the anchor on the balance's own day, never after today", async () => {
		const { account, bank } = await linkedChecking();

		await sync(
			account.id,
			bank.connectionId,
			[newBankLine({ date: "2026-09-21", amount: toMinorUnits(-500) })],
			bankBalance("2026-09-20"),
		);

		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(99500);
		expect(days.get("2026-09-21")).toBe(99000);

		const later = await sync(account.id, bank.connectionId, [], bankBalance("2026-10-02"));

		expect(later.balance).toMatchObject({ status: "recorded", date: "2026-09-21" });
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 99500,
		});
	});

	it("keeps the anchor when the bank gives no balance, or one in another currency", async () => {
		const { account, bank } = await linkedChecking();

		const none = await sync(account.id, bank.connectionId, [newBankLine()]);
		const foreign = await sync(account.id, bank.connectionId, [], {
			amount: toMinorUnits(1),
			currency: "USD",
			date: "2026-09-21",
		});

		expect(none.balance).toBeNull();
		expect(foreign.balance).toEqual({
			status: "skipped",
			date: "2026-09-21",
			balance: 1,
			reason: "CURRENCY_MISMATCH",
		});
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 100000,
		});
		expect((await history(account.id)).get("2026-09-21")).toBe(100000);
	});

	it("attaches its keys to a file's entry of the same amount within 3 days", async () => {
		const { account, bank } = await linkedChecking();
		const { result } = await importStatement(
			account.id,
			statementOf(line({ label: "CB CARREFOUR" })),
			{
				source: "csv",
			},
		);
		const [csvEntry = ""] = result.created;

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.matched).toEqual([
			expect.objectContaining({ entryId: csvEntry, date: "2026-09-12" }),
		]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		expect((await keyRows(csvEntry)).map(({ source }) => source).toSorted()).toEqual([
			"csv",
			"enable-banking",
			"enable-banking",
		]);
		// The sheet names the bank from then on.
		await expect(entryOrigins(deps(), [csvEntry])).resolves.toEqual(
			new Map([[csvEntry, { kind: "bank", connector: "enable-banking" }]]),
		);
	});

	it("keeps an entry a sync paired with when its file import is reverted", async () => {
		const { account, bank } = await linkedChecking();
		const { importId, result } = await importStatement(
			account.id,
			statementOf(line({ label: "CB CARREFOUR" })),
			{ source: "csv" },
		);
		const [csvEntry = ""] = result.created;
		await sync(account.id, bank.connectionId, [newBankLine()]);

		await expect(removableOf(deps(), [importId])).resolves.toEqual(
			new Map([[importId, { transactions: 0, snapshot: 0 }]]),
		);
		await revert(importId);

		await expect(findTransaction(deps(), csvEntry)).resolves.not.toBeNull();
		expect((await keyRows(csvEntry)).map(({ source }) => source)).toEqual([
			"enable-banking",
			"enable-banking",
		]);
	});

	it("creates a line two file entries are equally near, flagged as a possible duplicate", async () => {
		const { account, bank } = await linkedChecking();
		await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-11" }), line({ date: "2026-09-13" })),
			{ source: "csv" },
		);

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		const [id = ""] = synced.created;
		expect(synced.groups.duplicates).toHaveLength(1);
		await expect(
			temp.db
				.select({ flagged: transactions.possibleDuplicate })
				.from(transactions)
				.where(eq(transactions.entryId, id))
				.get(),
		).resolves.toEqual({ flagged: true });
	});

	it("never pairs with an entry another sync of the same connector wrote", async () => {
		const { account, bank } = await linkedChecking();
		await sync(account.id, bank.connectionId, [newBankLine()]);

		const synced = await sync(account.id, bank.connectionId, [
			newBankLine({ externalId: "EB2", date: "2026-09-13", label: "AUTRE" }),
		]);

		expect(synced.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("refuses lines on or before the opening date, as any source", async () => {
		const { account, bank } = await linkedChecking();

		const synced = await sync(account.id, bank.connectionId, [newBankLine({ date: "2026-09-01" })]);

		expect(synced.rejected).toEqual([{ ref: "0", reason: "BEFORE_OPENING_DATE" }]);
	});

	it("refuses an unknown connection and writes nothing", async () => {
		const { account } = await linkedChecking();

		await expect(sync(account.id, crypto.randomUUID(), [newBankLine()])).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});
});

// Story 10.4: pending lines, their booked version and their disappearance.

// Amounts of their own: step 6 would link them to another test's rows.
const pendingLine = (amount: number, overrides: Partial<NormalizedTransaction> = {}) =>
	line({
		externalId: "ref-1",
		date: "2026-09-19",
		amount: toMinorUnits(amount),
		label: "BOULANGERIE EN ATTENTE",
		pending: true,
		...overrides,
	});

async function rowOf(entryId: string) {
	return temp.db
		.select({
			date: entries.date,
			amount: entries.amount,
			label: transactions.label,
			notes: transactions.notes,
			pending: transactions.pending,
			missed: transactions.pendingMissedSyncs,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();
}

async function valuationsIds(accountId: string) {
	const rows = await temp.db
		.select({ id: entries.id })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")));

	return rows.map(({ id }) => id);
}

const bookedLine = (amount: number, overrides: Partial<NormalizedTransaction> = {}) =>
	pendingLine(amount, { label: "BOULANGERIE", pending: false, ...overrides });

async function createdBySync(
	accountId: string,
	connectionId: string,
	lines: NormalizedTransaction[],
) {
	const result = await sync(accountId, connectionId, lines);

	return result.created;
}

describe("pending transactions", () => {
	it("stores a pending line, counts it in the balance and leaves it out of cash flow", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();

		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-21" }),
		]);

		await expect(rowOf(id)).resolves.toMatchObject({ amount, pending: true, missed: 0 });
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000 + amount);
		expect(days.get("2026-09-20")).toBe(100000);
		await expect(
			cashFlowByCategory(deps(), {
				from: "2026-09-01",
				to: "2026-09-30",
				accountIds: [account.id],
			}),
		).resolves.toEqual([]);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ pending: true });
	});

	it("adds the pending entries on or before the bank balance's day on top of it", async () => {
		const { account, bank } = await linkedChecking();
		const [before, on, after] = [-transferAmount(), -transferAmount(), -transferAmount()];

		await sync(
			account.id,
			bank.connectionId,
			[
				pendingLine(before, { externalId: "p-1", date: "2026-09-18" }),
				pendingLine(on, { externalId: "p-2", date: "2026-09-20" }),
				pendingLine(after, { externalId: "p-3", date: "2026-09-21" }),
			],
			{ amount: toMinorUnits(100000), currency: "EUR", date: "2026-09-20" },
		);

		const days = await history(account.id);
		expect(days.get("2026-09-17")).toBe(100000);
		expect(days.get("2026-09-18")).toBe(100000 + before);
		expect(days.get("2026-09-20")).toBe(100000 + before + on);
		expect(days.get("2026-09-21")).toBe(100000 + before + on + after);
		// The stored anchor stays the bank's own figure.
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-20",
			amount: 100000,
		});
	});

	it("adds a card's pending payment to what it owes", async () => {
		const { account, bank } = await linkedChecking(-50000, {
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});
		const amount = -transferAmount();

		await sync(account.id, bank.connectionId, [pendingLine(amount, { date: "2026-09-21" })]);

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(50000 - amount);
		expect(days.get("2026-09-20")).toBe(50000);
	});

	it("books a pending entry in place by its reference, keeping what the user set", async () => {
		const { account, bank } = await linkedChecking();
		const other = await openChecking({ name: "Livret" });
		const amount = transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(-amount)]);
		const category = await newCategory("Courses");
		const tag = await newTag("Vacances");
		await updateTransaction(deps(), id, { categoryId: category, tagIds: [tag] }, asUser);
		const counterpart = await addStandard(other.id, {
			amount: toMinorUnits(amount),
			label: "counterpart",
		});
		await insertTransfer(id, counterpart, "internal_move");

		const booked = await sync(account.id, bank.connectionId, [
			bookedLine(-amount - 50, { date: "2026-09-20" }),
		]);

		expect(booked.created).toEqual([]);
		await expect(rowOf(id)).resolves.toEqual({
			date: "2026-09-20",
			amount: -amount - 50,
			label: "BOULANGERIE",
			notes: null,
			pending: false,
			missed: 0,
		});
		await expect(categoryOf(id)).resolves.toBe(category);
		await expect(tagsOf(id)).resolves.toEqual([tag]);
		await expect(transferRows(id)).resolves.toHaveLength(1);
		await expect(lockedFields(id)).resolves.toEqual(["category", "tags"]);
		// Both fingerprints and the reference: the old pending line finds it again.
		await expect(keysOf(id)).resolves.toHaveLength(3);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(100000);
		expect(days.get("2026-09-19")).toBe(100000 + amount + 50);
	});

	it("changes nothing when the bank sends the old pending line again", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await sync(account.id, bank.connectionId, [bookedLine(amount, { date: "2026-09-20" })]);

		const again = await sync(account.id, bank.connectionId, [pendingLine(amount)]);

		expect(again.created).toEqual([]);
		expect(again.groups.present).toEqual([expect.objectContaining({ entryId: id })]);
		await expect(rowOf(id)).resolves.toMatchObject({ date: "2026-09-20", pending: false });
	});

	it("books once when one statement holds the booked line, then the pending one", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);

		await sync(account.id, bank.connectionId, [
			bookedLine(amount, { date: "2026-09-20" }),
			pendingLine(amount, { date: "2026-09-21" }),
		]);

		await expect(rowOf(id)).resolves.toMatchObject({ date: "2026-09-20", pending: false });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("refreshes a pending entry from its pending line, and starts its missed syncs over", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await sync(account.id, bank.connectionId, []);
		await expect(rowOf(id)).resolves.toMatchObject({ missed: 1 });

		await sync(account.id, bank.connectionId, [
			pendingLine(amount - 100, { label: "BOULANGERIE CB", notes: "CB 19/09" }),
		]);

		await expect(rowOf(id)).resolves.toEqual({
			date: "2026-09-19",
			amount: amount - 100,
			label: "BOULANGERIE CB",
			notes: "CB 19/09",
			pending: true,
			missed: 0,
		});
	});

	it("books a pending entry without reference by amount within 5 days", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: null, date: "2026-09-16" }),
		]);

		const booked = await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: null, date: "2026-09-21", label: "CB BOULANGERIE 16/09" }),
		]);

		expect(booked.created).toEqual([]);
		await expect(rowOf(id)).resolves.toMatchObject({
			date: "2026-09-21",
			label: "CB BOULANGERIE 16/09",
			pending: false,
		});
		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(100000 - amount);
		expect(days.get("2026-09-15")).toBe(100000 - amount);
	});

	it("keeps a label the user locked, and takes the booked amount and date", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await updateTransaction(deps(), id, { label: "Pain du dimanche" }, asUser);

		await sync(account.id, bank.connectionId, [bookedLine(amount - 30, { date: "2026-09-20" })]);

		await expect(rowOf(id)).resolves.toMatchObject({
			date: "2026-09-20",
			amount: amount - 30,
			label: "Pain du dimanche",
			pending: false,
		});
	});

	it("creates a booked line more than 5 days from the pending entry, which counts a miss", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [pendingId = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: null, date: "2026-09-10" }),
		]);

		const booked = await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: null, date: "2026-09-20" }),
		]);

		expect(booked.created).toHaveLength(1);
		await expect(rowOf(pendingId)).resolves.toMatchObject({ pending: true, missed: 1 });
	});

	it("gives a booked line to the pending entry at the nearest date", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [far = "", near = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: null, date: "2026-09-18" }),
			pendingLine(amount, { externalId: null, date: "2026-09-20" }),
		]);

		await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: null, date: "2026-09-20", label: "AUTRE" }),
		]);

		await expect(rowOf(near)).resolves.toMatchObject({ pending: false, label: "AUTRE" });
		await expect(rowOf(far)).resolves.toMatchObject({ pending: true, missed: 1 });
	});

	it("never takes a pending entry of another connection by amount", async () => {
		const { account, bank } = await linkedChecking();
		const other = await newBankAccount();
		const amount = -transferAmount();
		const [pendingId = ""] = await createdBySync(account.id, other.connectionId, [
			pendingLine(amount, { externalId: null }),
		]);

		const booked = await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: null, date: "2026-09-20" }),
		]);

		expect(booked.created).toHaveLength(1);
		// Nor counts a miss for it: this statement does not speak for it.
		await expect(rowOf(pendingId)).resolves.toMatchObject({ pending: true, missed: 0 });
	});

	it("never pairs a pending line with a file's entry by amount and date", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const { result } = await importStatement(
			account.id,
			statementOf(line({ amount: toMinorUnits(amount), date: "2026-09-19" })),
			{ source: "csv" },
		);

		const synced = await sync(account.id, bank.connectionId, [pendingLine(amount)]);

		expect(synced.groups.matched).toEqual([]);
		expect(synced.created).toHaveLength(1);
		expect(synced.created).not.toContain(result.created[0]);
	});

	it("deletes a pending entry missing from two syncs in a row, with its keys and tags", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-21" }),
		]);
		await updateTransaction(deps(), id, { tagIds: [await newTag("Hôtel")] }, asUser);

		await sync(account.id, bank.connectionId, []);
		await expect(rowOf(id)).resolves.toMatchObject({ missed: 1 });
		await sync(account.id, bank.connectionId, []);

		await expect(rowOf(id)).resolves.toBeUndefined();
		await expect(keysOf(id)).resolves.toEqual([]);
		await expect(tagsOf(id)).resolves.toEqual([]);
		expect((await history(account.id)).get("2026-09-21")).toBe(100000);
	});

	it("names the date of the oldest pending entry, none once booked", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();

		await expect(oldestPendingDate(deps(), account.id, bank.connectionId)).resolves.toBeNull();
		await sync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "p-1", date: "2026-09-18" }),
			pendingLine(amount - 1, { externalId: "p-2", date: "2026-09-12" }),
		]);
		await expect(oldestPendingDate(deps(), account.id, bank.connectionId)).resolves.toBe(
			"2026-09-12",
		);
		await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: "p-1", date: "2026-09-18" }),
			bookedLine(amount - 1, { externalId: "p-2", date: "2026-09-12" }),
		]);
		await expect(oldestPendingDate(deps(), account.id, bank.connectionId)).resolves.toBeNull();
	});

	it("names no date for another connection's pending entry, which never moves the window", async () => {
		const { account, bank } = await linkedChecking();
		const other = await newBankAccount();
		await sync(account.id, other.connectionId, [
			pendingLine(-transferAmount(), { date: "2026-09-05" }),
		]);

		await expect(oldestPendingDate(deps(), account.id, bank.connectionId)).resolves.toBeNull();
		await expect(oldestPendingDate(deps(), account.id, other.connectionId)).resolves.toBe(
			"2026-09-05",
		);
	});

	it("creates a booked line beside a pending entry its own pending line refreshes", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);

		const synced = await sync(account.id, bank.connectionId, [
			pendingLine(amount),
			bookedLine(amount, { externalId: null, date: "2026-09-20", label: "AUTRE" }),
		]);

		expect(synced.created).toHaveLength(1);
		await expect(rowOf(id)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("runs no rule again on the entry a booked line absorbs", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		const category = await newCategory("Boulangerie");
		const rule = await createRule(deps(), {
			effectiveDate: null,
			conditions: [labelLike("boulangerie")],
			actions: [{ actionType: "set_transaction_category", value: category }],
		});

		try {
			const synced = await sync(account.id, bank.connectionId, [
				bookedLine(amount, { date: "2026-09-20" }),
				bookedLine(-transferAmount(), { externalId: "ref-2", date: "2026-09-20" }),
			]);

			await expect(rowOf(id)).resolves.toMatchObject({ pending: false, label: "BOULANGERIE" });
			await expect(categoryOf(id)).resolves.toBeNull();
			// The rule is live: the new row beside it gets its category.
			await expect(categoryOf(synced.created[0] ?? "")).resolves.toBe(category);
			await expect(lockedFields(id)).resolves.toEqual([]);
		} finally {
			await temp.db.delete(rules).where(eq(rules.id, rule.id));
		}
	});

	it("keeps an amount the user locked, and takes the booked date", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await updateTransaction(deps(), id, { amount: toMinorUnits(amount - 7) }, asUser);

		await sync(account.id, bank.connectionId, [bookedLine(amount - 40, { date: "2026-09-20" })]);

		await expect(rowOf(id)).resolves.toMatchObject({
			date: "2026-09-20",
			amount: amount - 7,
			label: "BOULANGERIE",
			pending: false,
		});
	});

	it("still refuses a created row whose key an entry of the account already holds", async () => {
		const { account, bank } = await linkedChecking();
		const booked = bookedLine(-transferAmount(), { externalId: null });
		const [keyed] = lineKeys([booked]);
		const [anchor] = await valuationsIds(account.id);
		// A key on a valuation escapes the lookup, which reads transactions only.
		await temp.db.insert(entryKeys).values({
			entryId: anchor ?? "",
			accountId: account.id,
			source: "enable-banking",
			key: keyed?.keys.fingerprint ?? "",
			importId: null,
			connectionId: bank.connectionId,
		});

		await expect(sync(account.id, bank.connectionId, [booked])).rejects.toThrow();
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("puts a pending row at the top of its day", async () => {
		const { account, bank } = await linkedChecking();
		const [pendingId = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(-transferAmount(), { date: "2026-09-12" }),
		]);
		setToday("2026-09-21T10:00:01Z");
		const later = await add(account.id, { date: "2026-09-12", amount: toMinorUnits(-1) });

		const page = await listTransactions(deps(), { accountIds: [account.id] }, firstPage);

		expect(page.items.map(({ id }) => id)).toEqual([pendingId, later]);
	});
});

// Story 10.5: a disconnected bank's accounts carry on as manual ones.

const unlink = (accountId: string) => unlinkBankAccount(deps(), accountId, { origin: "sync" });

async function linkedAt(balance: number, overrides: Partial<NewAccountInput> = {}) {
	const account = await openChecking(overrides);
	const bank = await newBankAccount();

	return { account, bank, link: () => link(account.id, bank.id, balance) };
}

async function bankAccountOf(accountId: string) {
	const row = await temp.db.select().from(accounts).where(eq(accounts.id, accountId)).get();

	return row?.bankAccountId;
}

describe("unlinkBankAccount", () => {
	it("keeps every balance while the bank's figure becomes a reconciliation", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-transferAmount()) });
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(transferAmount()) });
		await linkIt();
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(bankAccountOf(account.id)).resolves.toBe(null);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: before.get("2026-09-01") },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
		]);
	});

	it("goes forward afterwards, a new line moving the days after it only", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await linkIt();
		await unlink(account.id);

		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4291) });

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(100000);
		expect(days.get("2026-09-10")).toBe(95709);
		// The bank's day stays the bank's figure, as a reconciliation does.
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("keeps the pending lines on and before the bank's day in the balance", async () => {
		const { account, bank, link: linkIt } = await linkedAt(100000);
		await linkIt();
		const amount = -transferAmount();
		await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({
						externalId: "p-1",
						date: "2026-09-18",
						amount: toMinorUnits(amount),
						pending: true,
					}),
					line({
						externalId: "p-2",
						date: "2026-09-21",
						amount: toMinorUnits(amount),
						pending: true,
					}),
					line({ externalId: "b-1", date: "2026-09-12", amount: toMinorUnits(amount) }),
				],
				balance: null,
				rejected: [],
			},
			{ connectionId: bank.connectionId },
			{ origin: "sync" },
		);
		const before = await history(account.id);
		expect(before.get("2026-09-21")).toBe(100000 + 2 * amount);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "reconciliation",
			date: "2026-09-21",
			amount: 100000 + 2 * amount,
		});
		const pending = await temp.db
			.select({ pending: transactions.pending })
			.from(transactions)
			.innerJoin(entries, eq(entries.id, transactions.entryId))
			.where(and(eq(entries.accountId, account.id), eq(transactions.pending, true)));
		expect(pending).toHaveLength(2);
	});

	it("replaces a reconciliation on the bank's day with the stored balance, keeping its id", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		const recorded = await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-21", balance: toMinorUnits(90000) },
			{ origin: "user" },
		);
		await linkIt();
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		const snapshots = await temp.db
			.select({ id: entries.id, amount: entries.amount })
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "reconciliation")));
		expect(snapshots).toEqual([
			{ id: recorded.status === "recorded" ? recorded.id : "", amount: 100000 },
		]);
	});

	it("keeps an earlier reconciliation and the days after it, even when it left a gap", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1003) });
		await add(account.id, { date: "2026-09-12", amount: toMinorUnits(-2003) });
		await add(account.id, { date: "2026-09-16", amount: toMinorUnits(-3003) });
		const snap = (date: string, balance: number) =>
			recordSnapshot(
				deps(),
				account.id,
				{ date, balance: toMinorUnits(balance) },
				{ origin: "user" },
			);
		// A gap: the 12th derives from the bank, not from the 11th's 500,00.
		await snap("2026-09-11", 50000);
		// No gap: the 15th already ends where the bank's side puts it.
		await snap("2026-09-15", 103003);
		// Two days in a row: the second fixes the first's next day itself.
		await snap("2026-09-07", 70000);
		await snap("2026-09-08", 80000);
		await linkIt();
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: before.get("2026-09-01") },
			{ kind: "reconciliation", date: "2026-09-07", amount: 70000 },
			{ kind: "reconciliation", date: "2026-09-08", amount: 80000 },
			{ kind: "reconciliation", date: "2026-09-09", amount: before.get("2026-09-09") },
			{ kind: "reconciliation", date: "2026-09-11", amount: 50000 },
			{ kind: "reconciliation", date: "2026-09-12", amount: before.get("2026-09-12") },
			{ kind: "reconciliation", date: "2026-09-15", amount: 103003 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
		]);
	});

	it("keeps a card's amount owed, day by day", async () => {
		const { account, link: linkIt } = await linkedAt(-30000, {
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-transferAmount()) });
		await add(account.id, { date: "2026-09-14", amount: toMinorUnits(-transferAmount()) });
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-12", balance: toMinorUnits(1000) },
			{ origin: "user" },
		);
		await linkIt();
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		expect(before.get("2026-09-21")).toBe(30000);
	});

	it("keeps every day when the bank's balance describes a day before the opening", async () => {
		const account = await openChecking({ openingDate: "2026-09-21" });
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000, "2026-09-20");
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-21", amount: 100000 },
		]);
	});

	it("only clears the link of an account the bank gave no balance for", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });
		await link(account.id, bank.id, null);
		const before = await history(account.id);

		await unlink(account.id);

		await expect(bankAccountOf(account.id)).resolves.toBe(null);
		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
	});

	it("refuses an unknown account", async () => {
		await expect(unlink(crypto.randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// Story 10.6: merging or dismissing a possible duplicate.

/** The other side's amount, for a transfer or a rejected pair. */
const opposite = (amount: number) => toMinorUnits(-amount);

async function flagOf(entryId: string) {
	const row = await temp.db
		.select({ flagged: transactions.possibleDuplicate })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.flagged;
}

/**
 * Two manual entries two days apart, then an OFX line between them: a tie,
 * created flagged. Amounts are unique, so no transfer links any of them.
 */
async function fileTie(
	dates: [string, string, string] = ["2026-09-04", "2026-09-05", "2026-09-06"],
) {
	const account = await openChecking();
	const amount = toMinorUnits(-transferAmount());
	const [before, on, after] = dates;
	const first = await add(account.id, { date: before, amount, label: "PEAGE A" });
	// A second later, so the older entry comes first among equally near ones.
	vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
	const second = await add(account.id, { date: after, amount, label: "PEAGE B" });
	const { importId, result } = await importStatement(
		account.id,
		statementOf(line({ externalId: "P1", date: on, amount, label: "PEAGE" })),
	);
	const [flagged = ""] = result.created;

	return { account, amount, first, second, flagged, importId };
}

/** Two CSV lines two days apart, then a bank line between them: a tie from a sync. */
async function bankTie(sign = -1) {
	const account = await openChecking();
	const bank = await newBankAccount();
	await link(account.id, bank.id, 100000);
	const amount = toMinorUnits(sign * transferAmount());
	const { result } = await importStatement(
		account.id,
		statementOf(
			line({ date: "2026-09-11", amount, label: "CB CARREFOUR" }),
			line({ date: "2026-09-13", amount, label: "CB CARREFOUR" }),
		),
		{ source: "csv" },
	);
	const [fileLine = "", other = ""] = result.created;
	const bankLine = line({ externalId: "EB1", date: "2026-09-12", amount, label: "CARREFOUR" });
	const synced = await sync(account.id, bank.connectionId, [bankLine]);
	const [flagged = ""] = synced.created;

	return { account, bank, amount, fileLine, other, flagged, bankLine };
}

describe("possible duplicates", () => {
	describe("duplicateCandidates", () => {
		it("lists the same account's entries of the same amount within 3 days, nearest first", async () => {
			const { account, amount, first, second, flagged } = await fileTie();
			const elsewhere = await openChecking({ name: "Autre" });
			const sameDay = await add(account.id, { date: "2026-09-05", amount, label: "PEAGE C" });
			const dayThree = await add(account.id, { date: "2026-09-08", amount });
			const otherSource = await add(account.id, { date: "2026-09-07", amount });
			await add(account.id, { date: "2026-09-09", amount });
			await add(account.id, { date: "2026-09-05", amount: toMinorUnits(amount - 1) });
			await add(elsewhere.id, { date: "2026-09-05", amount });
			const keyed = await add(account.id, { date: "2026-09-05", amount });
			await temp.db.insert(entryKeys).values([
				{ entryId: keyed, accountId: account.id, source: "ofx", key: `fp:${keyed}` },
				{ entryId: otherSource, accountId: account.id, source: "csv", key: `fp:${otherSource}` },
			]);
			// A valuation of that very amount is no transaction.
			await recordSnapshot(
				deps(),
				account.id,
				{ date: "2026-09-05", balance: toMinorUnits(amount) },
				asUser,
			);

			const found = await duplicateCandidates(deps(), flagged);

			expect(found.map(({ id }) => id)).toEqual([sameDay, first, second, otherSource, dayThree]);
			expect(found[1]).toEqual({
				id: first,
				date: "2026-09-04",
				label: "PEAGE A",
				amount,
				currency: "EUR",
				accountId: account.id,
				accountName: "Compte joint",
			});
		});

		it("lists none for a transaction no longer flagged, and refuses an unknown one", async () => {
			const { first, flagged } = await fileTie();

			await expect(duplicateCandidates(deps(), first)).resolves.toEqual([]);
			await dismissDuplicate(deps(), flagged);
			await expect(duplicateCandidates(deps(), flagged)).resolves.toEqual([]);
			await expect(duplicateCandidates(deps(), crypto.randomUUID())).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});
	});

	it("shows the flag on the record, in the list too", async () => {
		const { account, first, flagged } = await fileTie();

		await expect(findTransaction(deps(), flagged)).resolves.toMatchObject({
			possibleDuplicate: true,
		});
		await expect(findTransaction(deps(), first)).resolves.toMatchObject({
			possibleDuplicate: false,
		});
		const { items } = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 1, pageSize: 50 },
		);
		expect(items.filter((item) => item.possibleDuplicate).map(({ id }) => id)).toEqual([flagged]);
	});

	describe("mergeDuplicate", () => {
		it("keeps the survivor's own fields and gives it the flagged one's keys and tags", async () => {
			const { account, bank, fileLine, flagged } = await bankTie();
			const holidays = await newTag("Vacances");
			const groceries = await newCategory("Courses");
			await updateTransaction(deps(), flagged, { tagIds: [holidays], notes: "note" }, asUser);
			await updateTransaction(
				deps(),
				fileLine,
				{ label: "Courses du samedi", categoryId: groceries },
				asUser,
			);
			// The survivor's own flag is its own business.
			await temp.db
				.update(transactions)
				.set({ possibleDuplicate: true })
				.where(eq(transactions.entryId, fileLine));
			const before = await findTransaction(deps(), fileLine);
			const locks = await lockedFields(fileLine);
			const count = await transactionCount(account.id);

			await mergeDuplicate(deps(), flagged, fileLine);

			await expect(findTransaction(deps(), flagged)).resolves.toBeNull();
			await expect(transactionCount(account.id)).resolves.toBe(count - 1);
			await expect(findTransaction(deps(), fileLine)).resolves.toEqual({
				...before,
				tagIds: [holidays],
			});
			await expect(lockedFields(fileLine)).resolves.toEqual(locks);
			await expect(categoryOf(fileLine)).resolves.toBe(groceries);
			expect(
				(await keyRows(fileLine)).toSorted((a, b) => a.source.localeCompare(b.source)),
			).toEqual([
				expect.objectContaining({ source: "csv", connectionId: null }),
				{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
				{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
			]);
			await expect(entryOrigins(deps(), [fileLine])).resolves.toEqual(
				new Map([[fileLine, { kind: "bank", connector: "enable-banking" }]]),
			);
		});

		it("lands the merged line in `present` on the survivor when the bank sends it again", async () => {
			const { account, bank, fileLine, flagged, bankLine } = await bankTie();
			await mergeDuplicate(deps(), flagged, fileLine);
			const before = await findTransaction(deps(), fileLine);
			const days = await history(account.id);

			const again = await sync(account.id, bank.connectionId, [bankLine]);

			expect(again.created).toEqual([]);
			expect(again.groups.present).toEqual([expect.objectContaining({ entryId: fileLine })]);
			await expect(findTransaction(deps(), fileLine)).resolves.toEqual(before);
			await expect(history(account.id)).resolves.toEqual(days);
		});

		it("keeps the survivor when the import that brought the merged line is reverted", async () => {
			const { first, flagged, importId } = await fileTie();
			await mergeDuplicate(deps(), flagged, first);

			await expect(removableOf(deps(), [importId])).resolves.toEqual(
				new Map([[importId, { transactions: 0, snapshot: 0 }]]),
			);
			await revert(importId);

			await expect(findTransaction(deps(), first)).resolves.not.toBeNull();
			await expect(keysOf(first)).resolves.toEqual([]);
		});

		it.each([
			["the outflow of an expense", -1],
			["the inflow of an income", 1],
		])("moves the flagged one's transfer onto a survivor in none, as %s", async (_, sign) => {
			const { fileLine, flagged, amount } = await bankTie(sign);
			const livret = await openChecking({ name: "Livret A", subtype: "savings" });
			const other = await addStandard(livret.id, {
				date: "2026-09-12",
				amount: opposite(amount),
			});
			const [outflow, inflow] = sign < 0 ? [flagged, other] : [other, flagged];
			await insertTransfer(outflow, inflow, "internal_move");

			await mergeDuplicate(deps(), flagged, fileLine);

			await expect(transferRows(fileLine)).resolves.toMatchObject([
				sign < 0
					? { outflowTransactionId: fileLine, inflowTransactionId: other }
					: { outflowTransactionId: other, inflowTransactionId: fileLine },
			]);
		});

		it("keeps the survivor's transfer and drops the flagged one's, its other side standard again", async () => {
			const { first, flagged, amount } = await fileTie();
			const livret = await openChecking({ name: "Livret A", subtype: "savings" });
			const theirs = await addStandard(livret.id, {
				date: "2026-09-05",
				amount: opposite(amount),
			});
			const ours = await addStandard(livret.id, {
				date: "2026-09-04",
				amount: opposite(amount),
			});
			await insertTransfer(flagged, theirs, "internal_move");
			await insertTransfer(first, ours, "internal_move");

			await mergeDuplicate(deps(), flagged, first);

			await expect(transferRows(first)).resolves.toMatchObject([
				{ outflowTransactionId: first, inflowTransactionId: ours },
			]);
			await expect(transferRows(theirs)).resolves.toEqual([]);
			await expect(findTransaction(deps(), theirs)).resolves.toMatchObject({ transfer: null });
		});

		it("keeps one tagging of a tag both carry", async () => {
			const { first, flagged } = await fileTie();
			const holidays = await newTag("Vacances");
			const work = await newTag("Travail");
			await updateTransaction(deps(), flagged, { tagIds: [holidays, work] }, asUser);
			await updateTransaction(deps(), first, { tagIds: [holidays] }, asUser);

			await mergeDuplicate(deps(), flagged, first);

			await expect(tagsOf(first)).resolves.toEqual([holidays, work].toSorted());
		});

		it("gives the survivor past the tag limit rather than drop one", async () => {
			const { first, flagged } = await fileTie();
			const many = await Promise.all(
				Array.from({ length: MAX_TAGS_PER_TRANSACTION }, (_, index) => newTag(`T${index}`)),
			);
			const extra = await newTag("Extra");
			await updateTransaction(deps(), flagged, { tagIds: [extra] }, asUser);
			await updateTransaction(deps(), first, { tagIds: many }, asUser);

			await mergeDuplicate(deps(), flagged, first);

			await expect(tagsOf(first)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION + 1);
		});

		it.each([
			["an expense, the outflow of its pairs", -1],
			["an income, the inflow of its pairs", 1],
		])("moves the rejected pairs of %s, but those the survivor holds", async (_, sign) => {
			const { account, fileLine, flagged, amount } = await bankTie(sign);
			const livret = await openChecking({ name: "Livret A", subtype: "savings" });
			const moved = await addStandard(livret.id, {
				date: "2026-09-12",
				amount: opposite(amount),
			});
			const shared = await addStandard(livret.id, {
				date: "2026-09-13",
				amount: opposite(amount),
			});
			const pair = (id: string, other: string) =>
				sign < 0
					? { outflowTransactionId: id, inflowTransactionId: other }
					: { outflowTransactionId: other, inflowTransactionId: id };
			await temp.db.insert(rejectedTransfers).values([
				{ id: crypto.randomUUID(), ...pair(flagged, moved), createdAt: 0 },
				{ id: crypto.randomUUID(), ...pair(flagged, shared), createdAt: 0 },
				{ id: crypto.randomUUID(), ...pair(fileLine, shared), createdAt: 0 },
			]);

			await mergeDuplicate(deps(), flagged, fileLine);

			const expected = [moved, shared].map((other) => {
				const { outflowTransactionId, inflowTransactionId } = pair(fileLine, other);

				return { outflow: outflowTransactionId, inflow: inflowTransactionId };
			});
			expect(
				(await rejectedRows(fileLine)).toSorted(
					(a, b) => a.outflow.localeCompare(b.outflow) || a.inflow.localeCompare(b.inflow),
				),
			).toEqual(
				expected.toSorted(
					(a, b) => a.outflow.localeCompare(b.outflow) || a.inflow.localeCompare(b.inflow),
				),
			);
			await expect(rejectedRows(flagged)).resolves.toEqual([]);
			await expect(transactionCount(account.id)).resolves.toBe(2);
		});

		it("takes the flagged one's amount out of the balances once, from its date", async () => {
			const { account, amount, flagged, second } = await fileTie([
				"2026-09-18",
				"2026-09-20",
				"2026-09-22",
			]);

			await mergeDuplicate(deps(), flagged, second);

			const days = await history(account.id);
			expect(days.get("2026-09-17")).toBe(123456);
			expect(days.get("2026-09-19")).toBe(123456 + amount);
			expect(days.get("2026-09-21")).toBe(123456 + amount);
			expect(days.get("2026-09-22")).toBe(123456 + 2 * amount);
			expect([...days.keys()].at(-1)).toBe("2026-09-22");
		});

		it("refuses a transaction that is no candidate, and writes nothing", async () => {
			const { account, amount, flagged } = await fileTie();
			const elsewhere = await openChecking({ name: "Autre" });
			const otherAccount = await add(elsewhere.id, { date: "2026-09-05", amount });
			const otherAmount = await add(account.id, {
				date: "2026-09-05",
				amount: toMinorUnits(amount - 1),
			});
			const days = await history(account.id);

			// One after the other: each is an `immediate` ledger write.
			await [otherAccount, otherAmount, flagged, crypto.randomUUID()].reduce(
				async (previous, into) => {
					await previous;
					await expect(mergeDuplicate(deps(), flagged, into)).rejects.toMatchObject({
						code: "VALIDATION_ERROR",
						fields: [{ path: "into", code: "not_a_candidate" }],
					});
				},
				Promise.resolve(),
			);

			await expect(flagOf(flagged)).resolves.toBe(true);
			await expect(history(account.id)).resolves.toEqual(days);
		});

		it("refuses a duplicate dismissed or merged meanwhile, and an unknown one", async () => {
			const { first, second, flagged } = await fileTie();
			await dismissDuplicate(deps(), flagged);

			await expect(mergeDuplicate(deps(), flagged, first)).rejects.toMatchObject({
				code: "DUPLICATE_RESOLVED",
			});
			await expect(findTransaction(deps(), flagged)).resolves.not.toBeNull();

			const other = await fileTie();
			await mergeDuplicate(deps(), other.flagged, other.first);
			await expect(mergeDuplicate(deps(), other.flagged, other.second)).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			await expect(findTransaction(deps(), second)).resolves.not.toBeNull();
		});
	});

	describe("dismissDuplicate", () => {
		it("clears the flag for good: the bank sending the line again never raises it", async () => {
			const { account, bank, flagged, bankLine } = await bankTie();

			await dismissDuplicate(deps(), flagged);
			await dismissDuplicate(deps(), flagged);
			const again = await sync(account.id, bank.connectionId, [bankLine]);

			await expect(flagOf(flagged)).resolves.toBe(false);
			expect(again.groups.present).toEqual([expect.objectContaining({ entryId: flagged })]);
			expect(again.created).toEqual([]);
		});

		it("refuses an unknown transaction", async () => {
			await expect(dismissDuplicate(deps(), crypto.randomUUID())).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});
	});
});
