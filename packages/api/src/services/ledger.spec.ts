import type { NormalizedTransaction } from "../domain/statement.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput, Origin } from "./ledger.ts";

import { and, eq, gt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import * as forward from "../domain/balances/forward.ts";
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
		{ transactions: [line(overrides)] },
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
			},
			{ manual: true },
			{ origin: "user" },
		);

		expect(result).toEqual({
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
			{ transactions: [line({ date: "2026-09-01" }), line({ date: "2026-09-15" })] },
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
			ingest(deps(), "nope", { transactions: [line()] }, { manual: true }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves no row behind when the recompute fails", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(
			ingest(deps(), account.id, { transactions: [line()] }, { manual: true }, { origin: "user" }),
		).rejects.toThrow();

		const stored = await temp.db
			.select()
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.kind, "transaction")));
		expect(stored).toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
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
