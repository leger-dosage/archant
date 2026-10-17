import type { NewAccountInput } from "./accounts.ts";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import {
	add,
	closingOn,
	deps,
	history,
	importStatement,
	line,
	link,
	linkedAccount,
	newBankAccount,
	newBankLine,
	openChecking,
	pendingLine,
	setToday,
	snapshotsOf,
	sync,
	temp,
	transferAmount,
	unlink,
	valuationsOf,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { accountWithOpeningDate, balanceOn, recomputeBalances } from "./balances.ts";
import { deleteTransaction } from "./edits.ts";
import { ingest } from "./ingest.ts";
import { findSnapshot, listSnapshots, recordSnapshot } from "./snapshots.ts";

useLedgerDatabase();

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
		expect(days.get("2026-09-02")).toBe(-145710);
		// The opening amount ends its day, as Sure's; the gap to the next day is
		// Sure's cash adjustment.
		expect(days.get("2026-09-01")).toBe(123456);
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
		expect(days.get("2026-09-02")).toBe(51000);
		expect(days.get("2026-09-01")).toBe(123456);
	});

	it("dates the anchor today, a line of today counted below it", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-21", amount: toMinorUnits(-500) });

		// Sure's `set_current_balance` dates the bank's figure today, whatever
		// day its closing balance describes.
		await link(account.id, bank.id, 100000);

		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 100000,
		});
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-20")).toBe(100500);
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

describe("a bank-linked account", () => {
	it("recomputes every earlier day when a transaction is added, today staying the bank's", async () => {
		const { account } = await linkedAccount();

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-2000) });

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-05")).toBe(100000);
		expect(days.get("2026-09-04")).toBe(102000);
		expect(days.get("2026-09-02")).toBe(102000);
		expect(days.get("2026-09-01")).toBe(123456);
	});

	it("recomputes every earlier day when a transaction is deleted", async () => {
		const { account } = await linkedAccount();
		const id = await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-2000) });

		await deleteTransaction(deps(), id, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-04")).toBe(100000);
		expect(days.get("2026-09-02")).toBe(100000);
		expect(days.get("2026-09-01")).toBe(123456);
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

	it("goes on backward past the opening date down to an older line", async () => {
		const { account } = await linkedAccount();

		await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({ date: "2026-08-20", amount: toMinorUnits(-1000) }),
					line({ date: "2026-08-25", amount: toMinorUnits(-500), label: "Pain" }),
				],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-02")).toBe(100000);
		// From the opening amount, the day before the opening date starting there.
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-08-25")).toBe(123456);
		expect(days.get("2026-08-24")).toBe(123956);
		expect(days.get("2026-08-20")).toBe(123956);
		expect(days.has("2026-08-19")).toBe(false);
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

	it("reads the gap of a snapshot the day before the opening date against the opening amount", async () => {
		const { account } = await linkedAccount();
		await add(account.id, { date: "2026-09-01", amount: toMinorUnits(-700) });
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-08-31", balance: toMinorUnits(120000) },
			{ origin: "user" },
		);

		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });

		// The opening day's line is undone for nothing, as the backward pass does.
		expect(items).toMatchObject([{ date: "2026-08-31", computed: 123456, gap: 120000 - 123456 }]);
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
	it("keeps the bank's balance as a reconciliation on its own row, and writes no other", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4291) });
		await linkIt();
		const kept = await valuationIds(account.id);

		await unlink(account.id);

		await expect(bankAccountOf(account.id)).resolves.toBe(null);
		// The same rows, the bank's figure turned `reconciliation` as Sure's
		// `preserve_anchor_as_reconciliation_if_stale` turns it.
		await expect(valuationIds(account.id)).resolves.toEqual(
			kept.map((row) => (row.kind === "current_anchor" ? { ...row, kind: "reconciliation" } : row)),
		);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
		]);
	});

	it("computes the account forward, a past day taking its forward value", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4291) });
		await linkIt();
		const before = await history(account.id);
		expect(before.get("2026-09-09")).toBe(104291);

		await unlink(account.id);

		// Sure's `Account::Syncer` computes an account no longer `linked?`
		// forward, each valuation setting its own day.
		const days = await history(account.id);
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119165);
		expect(days.get("2026-09-20")).toBe(119165);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.size).toBe(before.size);
	});

	it("keeps the forward balances when the account is computed again", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4291) });
		await linkIt();
		await unlink(account.id);

		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(-1000) });

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119165);
		expect(days.get("2026-09-15")).toBe(118165);
		expect(days.get("2026-09-20")).toBe(118165);
		// The bank's day stays the bank's figure.
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("leaves the pending lines out, as before", async () => {
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

		await unlink(account.id);

		const days = await history(account.id);
		expect(days.get("2026-09-11")).toBe(123456);
		expect(days.get("2026-09-12")).toBe(123456 + amount);
		expect(days.get("2026-09-20")).toBe(123456 + amount);
		expect(days.get("2026-09-21")).toBe(100000);
		const pending = await temp.db
			.select({ pending: transactions.pending })
			.from(transactions)
			.innerJoin(entries, eq(entries.id, transactions.entryId))
			.where(and(eq(entries.accountId, account.id), eq(transactions.pending, true)));
		expect(pending).toHaveLength(2);
	});

	it("keeps the user's snapshots, each setting its own day", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1003) });
		await add(account.id, { date: "2026-09-12", amount: toMinorUnits(-2003) });
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-11", balance: toMinorUnits(50000) },
			{ origin: "user" },
		);
		await linkIt();

		await unlink(account.id);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-11", amount: 50000 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(122453);
		expect(days.get("2026-09-10")).toBe(122453);
		expect(days.get("2026-09-11")).toBe(50000);
		expect(days.get("2026-09-12")).toBe(47997);
		expect(days.get("2026-09-20")).toBe(47997);
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("lets a snapshot recorded on the bank's day afterwards take the bank's row", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await linkIt();
		await unlink(account.id);
		const [, bankRow] = await valuationIds(account.id);

		const recorded = await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-21", balance: toMinorUnits(90000) },
			{ origin: "user" },
		);

		// Sure keeps one valuation per day, which its `ReconciliationManager`
		// updates in place.
		expect(recorded).toMatchObject({ status: "recorded", id: bankRow?.id, replaced: true });
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 90000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(123456);
		expect(days.get("2026-09-21")).toBe(90000);
	});

	it("keeps a snapshot already on the bank's day, the bank's figure dropped", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		const recorded = await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-21", balance: toMinorUnits(90000) },
			{ origin: "user" },
		);
		await linkIt();

		await unlink(account.id);

		await expect(valuationIds(account.id)).resolves.toEqual([
			expect.objectContaining({ kind: "opening_anchor" }),
			{
				id: recorded.status === "recorded" ? recorded.id : "",
				kind: "reconciliation",
				date: "2026-09-21",
			},
		]);
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "reconciliation",
			date: "2026-09-21",
			amount: 90000,
		});
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(90000);
	});

	it("keeps the opening amount on an opening day the bank's anchor shares", async () => {
		const { account, link: linkIt } = await linkedAt(100000, { openingDate: "2026-09-21" });
		await linkIt();

		await unlink(account.id);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-21", amount: 123456 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(123456);
		expect(days.size).toBe(1);
	});

	it("computes the days before the opening forward, from zero before the oldest line", async () => {
		const { account, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-08-20", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-08-25", amount: toMinorUnits(-500) });
		await linkIt();
		const before = await history(account.id);
		expect(before.get("2026-08-20")).toBe(123956);

		await unlink(account.id);

		// Sure's `opening_starting_balances` seeds zero when the history starts
		// before the opening anchor, which then resets its own day.
		const days = await history(account.id);
		expect(days.get("2026-08-20")).toBe(-1000);
		expect(days.get("2026-08-25")).toBe(-1500);
		expect(days.get("2026-08-31")).toBe(-1500);
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("starts at an anchor stored before Story 28.18 the day before the opening", async () => {
		const account = await openChecking({ openingDate: "2026-09-21" });
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000);
		await anchorStoredOn(account.id, "2026-09-20");
		await temp.db.transaction(async (tx) =>
			recomputeBalances(
				tx,
				await accountWithOpeningDate(tx, account.id),
				"2026-09-20",
				deps().timeZone,
			),
		);

		await unlink(account.id);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "reconciliation", date: "2026-09-20", amount: 100000 },
			{ kind: "opening_anchor", date: "2026-09-21", amount: 123456 },
		]);
		const days = await history(account.id);
		expect([...days.entries()]).toEqual([
			["2026-09-20", 100000],
			["2026-09-21", 123456],
		]);
	});

	it("computes a card forward with the liability sign, owing the bank's figure", async () => {
		const { account, link: linkIt } = await linkedAt(-30000, {
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});
		const first = transferAmount();
		const second = transferAmount();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-first) });
		await add(account.id, { date: "2026-09-14", amount: toMinorUnits(-second) });
		await linkIt();

		await unlink(account.id);

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(0);
		expect(days.get("2026-09-10")).toBe(first);
		expect(days.get("2026-09-14")).toBe(first + second);
		expect(days.get("2026-09-20")).toBe(first + second);
		expect(days.get("2026-09-21")).toBe(30000);
		// The bank's figure stays a stored balance, owed as a positive amount.
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "reconciliation",
			date: "2026-09-21",
			amount: 30000,
		});
	});

	it("keeps the bank's former balance when the account is linked again", async () => {
		const { account, bank, link: linkIt } = await linkedAt(100000);
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4291) });
		await linkIt();
		await unlink(account.id);
		setToday("2026-09-25T10:00:00Z");

		await link(account.id, bank.id, 90000);

		// The bank's earlier figure still fixes its day, as Sure's next sync
		// would leave it once superseded.
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
			{ kind: "current_anchor", date: "2026-09-25", amount: 90000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-25")).toBe(90000);
	});

	it("leaves an account no bank feeds as it is, a stray anchor included", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4290) });
		await temp.db.insert(entries).values({
			id: crypto.randomUUID(),
			accountId: account.id,
			kind: "valuation",
			valuationKind: "current_anchor",
			date: "2026-09-21",
			amount: 100000,
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		});
		const kept = await valuationIds(account.id);
		const before = await history(account.id);

		await unlink(account.id);

		await expect(valuationIds(account.id)).resolves.toEqual(kept);
		await expect(history(account.id)).resolves.toEqual(before);
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

// Story 11.7: each bank balance a sync received stays, as a reconciliation.
// Story 28.18: the bank's balance is dated the day the sync runs.

/** A checking account linked on `day`, the bank then saying `balance`; today when `null`. */
async function linkedOn(
	day: string | null,
	balance = 100000,
	overrides: Partial<NewAccountInput> = {},
) {
	const account = await openChecking(overrides);
	const bank = await newBankAccount();

	if (day !== null) {
		setToday(`${day}T10:00:00Z`);
	}

	await link(account.id, bank.id, balance);

	return { account, bank };
}

/** A sync on `day`, the bank saying `amount` euros. */
function syncOn(
	day: string,
	account: { id: string },
	bank: { connectionId: string },
	amount: number,
	lines: Parameters<typeof sync>[2] = [],
) {
	setToday(`${day}T10:00:00Z`);

	return sync(account.id, bank.connectionId, lines, {
		amount: toMinorUnits(amount),
		currency: "EUR",
		date: day,
	});
}

/** Moves the anchor to `date`, as one stored before Story 28.18 on a `reference_date`. */
async function anchorStoredOn(accountId: string, date: string) {
	await temp.db
		.update(entries)
		.set({ date })
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "current_anchor")));
}

async function valuationIds(accountId: string) {
	return temp.db
		.select({ id: entries.id, kind: entries.valuationKind, date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")))
		.orderBy(entries.date);
}

describe("a sync's earlier bank balances", () => {
	it("turns the anchor into a reconciliation on its day, keeping its id, at the next day's sync", async () => {
		const { account, bank } = await linkedOn(null);
		const [, previous] = await valuationIds(account.id);

		const result = await syncOn("2026-09-22", account, bank, 90000);

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-22", balance: 90000 });
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-21", amount: 100000 },
			{ kind: "current_anchor", date: "2026-09-22", amount: 90000 },
		]);
		const [, converted] = await valuationIds(account.id);
		expect(converted?.id).toBe(previous?.id);
		const row = await temp.db
			.select({ importId: entries.importId })
			.from(entries)
			.where(eq(entries.id, converted?.id ?? ""))
			.get();
		expect(row?.importId).toBeNull();
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-22")).toBe(90000);
		await expect(
			listSnapshots(deps(), account.id, { page: 1, pageSize: 50 }),
		).resolves.toMatchObject({
			items: [{ id: previous?.id, date: "2026-09-21", balance: 100000 }],
			total: 1,
		});
	});

	it("dates the anchor today whatever day the statement's balance describes", async () => {
		const { account, bank } = await linkedOn(null);

		const result = await sync(account.id, bank.connectionId, [], {
			amount: toMinorUnits(95000),
			currency: "EUR",
			date: "2026-09-20",
		});

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-21", balance: 95000 });
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 95000 },
		]);
	});

	it("only updates the anchor's amount at a sync the same day", async () => {
		const { account, bank } = await linkedOn(null);
		const [, previous] = await valuationIds(account.id);

		await syncOn("2026-09-21", account, bank, 95000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 95000 },
		]);
		const [, updated] = await valuationIds(account.id);
		expect(updated?.id).toBe(previous?.id);
	});

	it("turns an anchor stored on an earlier reference date into a reconciliation on that day", async () => {
		const { account, bank } = await linkedOn(null);
		await anchorStoredOn(account.id, "2026-09-19");

		await syncOn("2026-09-21", account, bank, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-19", amount: 100000 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 90000 },
		]);
	});

	it("moves only the days between two bank balances for a line the bank never sent", async () => {
		const { account, bank } = await linkedOn("2026-09-15");
		const before = await history(account.id);

		// The bank went from 1 000,00 to 900,00; the lines it sent make 50,00.
		await syncOn("2026-09-20", account, bank, 90000, [
			newBankLine({ externalId: "m-1", date: "2026-09-17", amount: toMinorUnits(-3001) }),
			newBankLine({ externalId: "m-2", date: "2026-09-19", amount: toMinorUnits(-1999) }),
		]);

		const days = await history(account.id);
		for (const [date, balance] of before) {
			if (date <= "2026-09-15") {
				expect(days.get(date)).toBe(balance);
			}
		}
		// The missing 50,00 falls on the days after the older figure; the days
		// up to it are unchanged.
		expect(days.get("2026-09-16")).toBe(95000);
		expect(days.get("2026-09-17")).toBe(91999);
		expect(days.get("2026-09-18")).toBe(91999);
		expect(days.get("2026-09-19")).toBe(90000);
		expect(days.get("2026-09-20")).toBe(90000);
	});

	it("keeps a later anchor, the older figure becoming a reconciliation on its own day", async () => {
		// After an `APP_TIMEZONE` change, a sync's today can fall before the anchor's.
		const { account, bank } = await linkedOn("2026-09-22");
		const [, anchor] = await valuationIds(account.id);

		const result = await syncOn("2026-09-20", account, bank, 99000);

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-20", balance: 99000 });
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-20", amount: 99000 },
			{ kind: "current_anchor", date: "2026-09-22", amount: 100000 },
		]);
		const [, , kept] = await valuationIds(account.id);
		expect(kept?.id).toBe(anchor?.id);
		const days = await history(account.id);
		expect(days.get("2026-09-19")).toBe(99000);
		expect(days.get("2026-09-20")).toBe(99000);
		expect(days.get("2026-09-21")).toBe(100000);
		expect(days.get("2026-09-22")).toBe(100000);
	});

	it("sets the older figure on a snapshot of its day, keeping its id and dropping its import", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(98000, "2026-09-20", "EUR", []));
		const [imported] = await snapshotsOf(account.id);
		expect(imported?.importId).not.toBeNull();
		const bank = await newBankAccount();
		setToday("2026-09-22T10:00:00Z");
		await link(account.id, bank.id, 100000);

		await syncOn("2026-09-20", account, bank, 99000);

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({
				id: imported?.id,
				date: "2026-09-20",
				balance: 99000,
				importId: null,
			}),
		]);
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-22",
			amount: 100000,
		});
	});

	it("sets the older figure on the opening anchor when it falls on the opening date", async () => {
		const { account, bank } = await linkedOn("2026-09-22", 100000, { openingDate: "2026-09-20" });
		const [opening] = await valuationIds(account.id);

		await syncOn("2026-09-20", account, bank, 99000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-20", amount: 99000 },
			{ kind: "current_anchor", date: "2026-09-22", amount: 100000 },
		]);
		const [kept] = await valuationIds(account.id);
		expect(kept?.id).toBe(opening?.id);
	});

	it("reads a snapshot's gap without the pending line on the day after it", async () => {
		const { account, bank } = await linkedOn(null);
		await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-10", balance: toMinorUnits(98000) },
			{ origin: "user" },
		);

		await sync(account.id, bank.connectionId, [
			newBankLine({ externalId: "g-1", date: "2026-09-11", amount: toMinorUnits(-500) }),
			pendingLine(-transferAmount(), { externalId: "g-2", date: "2026-09-11" }),
		]);

		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });
		expect(items).toMatchObject([
			{ date: "2026-09-10", balance: 98000, computed: 100500, gap: -2500 },
		]);
	});

	it("leaves a pending line out once unlinked, the bank's figures kept", async () => {
		const { account, bank } = await linkedOn("2026-09-15", 100000, {
			openingBalance: toMinorUnits(100000),
		});
		await syncOn("2026-09-18", account, bank, 100000, [
			pendingLine(-transferAmount(), { externalId: "u-1", date: "2026-09-16" }),
		]);

		await unlink(account.id);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 100000 },
			{ kind: "reconciliation", date: "2026-09-15", amount: 100000 },
			{ kind: "reconciliation", date: "2026-09-18", amount: 100000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-16")).toBe(100000);
		expect(days.get("2026-09-18")).toBe(100000);
	});

	it("deletes the anchor when a snapshot already holds its day, the snapshot kept", async () => {
		const { account, bank } = await linkedOn("2026-09-19");
		const recorded = await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-19", balance: toMinorUnits(98000) },
			{ origin: "user" },
		);

		await syncOn("2026-09-20", account, bank, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-19", amount: 98000 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
		const [, kept] = await valuationIds(account.id);
		expect(kept?.id).toBe(recorded.status === "recorded" ? recorded.id : "");
	});

	it("deletes an anchor dated on the opening date, where no snapshot may sit", async () => {
		const { account, bank } = await linkedOn("2026-09-10", 100000, { openingDate: "2026-09-10" });

		await syncOn("2026-09-20", account, bank, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-10", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
	});

	it("keeps an anchor dated before the opening date as a reconciliation, the balances starting there", async () => {
		const { account, bank } = await linkedOn(null, 100000, { openingDate: "2026-09-10" });
		await anchorStoredOn(account.id, "2026-08-25");

		await syncOn("2026-09-20", account, bank, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "reconciliation", date: "2026-08-25", amount: 100000 },
			{ kind: "opening_anchor", date: "2026-09-10", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
		const days = await history(account.id);
		expect([...days.keys()][0]).toBe("2026-08-25");
		expect(days.get("2026-08-25")).toBe(100000);
	});

	it("writes the first bank balance of an account linked without one", async () => {
		const { account, bank } = await linkedOn(null, 0);
		await link(account.id, bank.id, null);

		await syncOn("2026-09-20", account, bank, 90000);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-02")).toBe(90000);
		expect(days.get("2026-09-01")).toBe(123456);
	});

	it("lets each bank figure set its own day once unlinked", async () => {
		const { account, bank } = await linkedOn("2026-09-15");
		await syncOn("2026-09-17", account, bank, 95000, [
			newBankLine({ externalId: "c-1", date: "2026-09-16", amount: toMinorUnits(-3003) }),
		]);
		await syncOn("2026-09-19", account, bank, 92000, [
			newBankLine({ externalId: "c-2", date: "2026-09-18", amount: toMinorUnits(-2003) }),
		]);

		await unlink(account.id);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-15", amount: 100000 },
			{ kind: "reconciliation", date: "2026-09-17", amount: 95000 },
			{ kind: "reconciliation", date: "2026-09-19", amount: 92000 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-14")).toBe(123456);
		expect(days.get("2026-09-15")).toBe(100000);
		expect(days.get("2026-09-16")).toBe(96997);
		expect(days.get("2026-09-17")).toBe(95000);
		expect(days.get("2026-09-18")).toBe(92997);
		expect(days.get("2026-09-19")).toBe(92000);
	});
});
