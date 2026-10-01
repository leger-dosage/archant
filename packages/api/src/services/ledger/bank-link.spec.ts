import type { NewAccountInput } from "./accounts.ts";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import {
	EVERY_DAY,
	add,
	deps,
	history,
	line,
	link,
	linkedAccount,
	newBankAccount,
	newBankLine,
	openChecking,
	pendingLine,
	setToday,
	sync,
	temp,
	transferAmount,
	unlink,
	valuationsOf,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { balanceOn } from "./balances.ts";
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

	it("keeps the bank's booked figure, the pending lines left out as before", async () => {
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
			{ connectionId: bank.connectionId, missesFrom: EVERY_DAY },
			{ origin: "sync" },
		);
		const before = await history(account.id);
		expect(before.get("2026-09-21")).toBe(100000);
		expect(before.get("2026-09-11")).toBe(100000 - amount);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "reconciliation",
			date: "2026-09-21",
			amount: 100000,
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

// Story 11.7: each bank balance a sync received stays, as a reconciliation.

/** A bank balance in euros, describing the end of `date`. */
const figure = (amount: number, date: string) => ({
	amount: toMinorUnits(amount),
	currency: "EUR",
	date,
});

/** A checking account linked to a bank that said `balance` at the end of `date`. */
async function linkedOn(
	date: string | null,
	balance = 100000,
	overrides: Partial<NewAccountInput> = {},
) {
	const account = await openChecking(overrides);
	const bank = await newBankAccount();
	await link(account.id, bank.id, balance, date);

	return { account, bank };
}

async function valuationIds(accountId: string) {
	return temp.db
		.select({ id: entries.id, kind: entries.valuationKind, date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")))
		.orderBy(entries.date);
}

describe("a sync's earlier bank balances", () => {
	it("turns the anchor into a reconciliation on its day, keeping its id, for a later balance", async () => {
		const { account, bank } = await linkedOn("2026-09-19");
		const [, previous] = await valuationIds(account.id);

		const result = await sync(account.id, bank.connectionId, [], figure(90000, "2026-09-20"));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-20", balance: 90000 });
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-19", amount: 100000 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
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
		expect(days.get("2026-09-19")).toBe(100000);
		expect(days.get("2026-09-20")).toBe(90000);
		await expect(
			listSnapshots(deps(), account.id, { page: 1, pageSize: 50 }),
		).resolves.toMatchObject({
			items: [{ id: previous?.id, date: "2026-09-19", balance: 100000 }],
			total: 1,
		});
	});

	it("only updates the anchor for a balance of the same day", async () => {
		const { account, bank } = await linkedOn("2026-09-19");
		const [, previous] = await valuationIds(account.id);

		await sync(account.id, bank.connectionId, [], figure(95000, "2026-09-19"));

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-19", amount: 95000 },
		]);
		const [, updated] = await valuationIds(account.id);
		expect(updated?.id).toBe(previous?.id);
	});

	it("moves only the days between two bank balances for a line the bank never sent", async () => {
		const { account, bank } = await linkedOn("2026-09-15");
		const before = await history(account.id);

		// The bank went from 1 000,00 to 900,00; the lines it sent make 50,00.
		await sync(
			account.id,
			bank.connectionId,
			[
				newBankLine({ externalId: "m-1", date: "2026-09-17", amount: toMinorUnits(-3001) }),
				newBankLine({ externalId: "m-2", date: "2026-09-19", amount: toMinorUnits(-1999) }),
			],
			figure(90000, "2026-09-20"),
		);

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

	it("moves an anchor dated after the new balance's day back to it, no reconciliation written", async () => {
		// The bank gave no date at link: the anchor sits on today.
		const { account, bank } = await linkedOn(null);
		const [, previous] = await valuationIds(account.id);

		await sync(account.id, bank.connectionId, [], figure(99000, "2026-09-20"));

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 99000 },
		]);
		const [, moved] = await valuationIds(account.id);
		expect(moved?.id).toBe(previous?.id);
		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(99000);
		expect(days.get("2026-09-21")).toBe(99000);
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

	it("leaves a pending line out of the reconciliations an unlink writes", async () => {
		const { account, bank } = await linkedOn("2026-09-15");
		await sync(
			account.id,
			bank.connectionId,
			[pendingLine(-transferAmount(), { externalId: "u-1", date: "2026-09-16" })],
			figure(100000, "2026-09-18"),
		);
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 100000 },
			{ kind: "reconciliation", date: "2026-09-15", amount: 100000 },
			{ kind: "reconciliation", date: "2026-09-18", amount: 100000 },
		]);
	});

	it("deletes the anchor when a snapshot already holds its day, the snapshot kept", async () => {
		const { account, bank } = await linkedOn("2026-09-19");
		const recorded = await recordSnapshot(
			deps(),
			account.id,
			{ date: "2026-09-19", balance: toMinorUnits(98000) },
			{ origin: "user" },
		);

		await sync(account.id, bank.connectionId, [], figure(90000, "2026-09-20"));

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

		await sync(account.id, bank.connectionId, [], figure(90000, "2026-09-20"));

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-10", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
	});

	it("writes the first bank balance of an account linked without one", async () => {
		const { account, bank } = await linkedOn(null, 0);
		await link(account.id, bank.id, null);

		await sync(account.id, bank.connectionId, [], figure(90000, "2026-09-20"));

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 90000 },
		]);
		expect((await history(account.id)).get("2026-09-01")).toBe(90000);
	});

	it("keeps every balance of a chain of bank figures when unlinked", async () => {
		const { account, bank } = await linkedOn("2026-09-15");
		await sync(
			account.id,
			bank.connectionId,
			[newBankLine({ externalId: "c-1", date: "2026-09-16", amount: toMinorUnits(-3003) })],
			figure(95000, "2026-09-17"),
		);
		await sync(
			account.id,
			bank.connectionId,
			[newBankLine({ externalId: "c-2", date: "2026-09-18", amount: toMinorUnits(-2003) })],
			figure(92000, "2026-09-19"),
		);
		const before = await history(account.id);

		await unlink(account.id);

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(valuationsOf(account.id)).resolves.toEqual(
			expect.arrayContaining([
				{ kind: "reconciliation", date: "2026-09-15", amount: 100000 },
				{ kind: "reconciliation", date: "2026-09-17", amount: 95000 },
				{ kind: "reconciliation", date: "2026-09-19", amount: 92000 },
			]),
		);
	});
});
