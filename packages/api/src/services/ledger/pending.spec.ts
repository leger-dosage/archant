import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rules } from "@archant/data/schema/rules";

import { lineKeys } from "../../domain/keys.ts";
import {
	add,
	addStandard,
	asUser,
	bookedLine,
	categoryOf,
	createdBySync,
	deps,
	firstPage,
	history,
	importStatement,
	insertTransfer,
	keysOf,
	labelLike,
	line,
	link,
	linkedChecking,
	lockedFields,
	newBankAccount,
	newCategory,
	newTag,
	openChecking,
	pendingLine,
	rowOf,
	setToday,
	settled,
	statementOf,
	sync,
	tagsOf,
	temp,
	transactionCount,
	transferAmount,
	transferRows,
	twin,
	unlink,
	valuationsOf,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createRule } from "../rules.ts";
import { deleteTransaction, updateTransaction } from "./edits.ts";
import { cashFlowByCategory, findTransaction, listTransactions } from "./queries.ts";
import { oldestPendingDate } from "./snapshots.ts";

useLedgerDatabase();

async function valuationsIds(accountId: string) {
	const rows = await temp.db
		.select({ id: entries.id })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")));

	return rows.map(({ id }) => id);
}

describe("pending transactions", () => {
	it("stores a pending line, and leaves it out of the balance and of cash flow", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();

		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-21" }),
		]);

		await expect(rowOf(id)).resolves.toMatchObject({ amount, pending: true, missed: 0 });
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(100000);
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

	it("leaves every pending entry out, before, on or after the bank balance's day", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000, "2026-09-20");
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
		expect(days.get("2026-09-18")).toBe(100000);
		expect(days.get("2026-09-20")).toBe(100000);
		expect(days.get("2026-09-21")).toBe(100000);
		await expect(transactionCount(account.id)).resolves.toBe(3);
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-20",
			amount: 100000,
		});
	});

	it("leaves a card's pending payment out of what it owes", async () => {
		const { account, bank } = await linkedChecking(-50000, {
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});
		const amount = -transferAmount();

		await sync(account.id, bank.connectionId, [pendingLine(amount, { date: "2026-09-21" })]);

		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(50000);
		expect(days.get("2026-09-20")).toBe(50000);
	});

	it("leaves a pending entry out of a manual account's balances, computed forward", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-15" }),
		]);
		await unlink(account.id);

		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-4292) });

		const days = await history(account.id);
		expect(days.get("2026-09-14")).toBe(100000 - 4292);
		expect(days.get("2026-09-15")).toBe(100000 - 4292);
		await expect(rowOf(id)).resolves.toMatchObject({ date: "2026-09-15", pending: true });
	});

	it("never moves the days up to a bank figure when a pending line on that day books later", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000, "2026-09-15");
		const amount = -transferAmount();
		await sync(
			account.id,
			bank.connectionId,
			[pendingLine(amount, { externalId: "p-across", date: "2026-09-15" })],
			{ amount: toMinorUnits(100000), currency: "EUR", date: "2026-09-15" },
		);
		const before = await history(account.id);

		await sync(
			account.id,
			bank.connectionId,
			[bookedLine(amount, { externalId: "p-across", date: "2026-09-18" })],
			{ amount: toMinorUnits(100000 + amount), currency: "EUR", date: "2026-09-20" },
		);

		const days = await history(account.id);
		for (const [date, balance] of before) {
			if (date <= "2026-09-15") {
				expect(days.get(date)).toBe(balance);
			}
		}
		expect(days.get("2026-09-17")).toBe(100000);
		expect(days.get("2026-09-18")).toBe(100000 + amount);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "reconciliation", date: "2026-09-15", amount: 100000 },
			{ kind: "current_anchor", date: "2026-09-20", amount: 100000 + amount },
		]);
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
			missedOn: null,
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

	it("books once when one statement holds the pending line, then the booked one", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);

		const synced = await sync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-21" }),
			bookedLine(amount, { date: "2026-09-20" }),
		]);

		expect(synced.created).toEqual([]);
		await expect(rowOf(id)).resolves.toMatchObject({ date: "2026-09-20", pending: false });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("refreshes a pending entry from its pending line, and starts its missed syncs over", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		setToday("2026-09-22T10:00:00Z");
		await sync(account.id, bank.connectionId, []);
		await expect(rowOf(id)).resolves.toMatchObject({ missed: 1, missedOn: "2026-09-22" });

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
			missedOn: null,
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

	it("deletes a pending entry missing from syncs on two days, with its keys and tags", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-09-21" }),
		]);
		await updateTransaction(deps(), id, { tagIds: [await newTag("Hôtel")] }, asUser);

		setToday("2026-09-22T21:00:00Z");
		await sync(account.id, bank.connectionId, []);
		await expect(rowOf(id)).resolves.toMatchObject({ missed: 1, missedOn: "2026-09-22" });
		// Past midnight in Paris, still the 22nd in UTC: the app's day has turned.
		setToday("2026-09-22T22:30:00Z");
		await sync(account.id, bank.connectionId, []);

		await expect(rowOf(id)).resolves.toBeUndefined();
		await expect(keysOf(id)).resolves.toEqual([]);
		await expect(tagsOf(id)).resolves.toEqual([]);
		expect((await history(account.id)).get("2026-09-21")).toBe(100000);
	});

	it("counts one miss for two syncs an hour apart without the line", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(-transferAmount(), { date: "2026-09-21" }),
		]);

		setToday("2026-09-22T10:00:00Z");
		await sync(account.id, bank.connectionId, []);
		setToday("2026-09-22T11:00:00Z");
		await sync(account.id, bank.connectionId, []);

		await expect(rowOf(id)).resolves.toMatchObject({
			pending: true,
			missed: 1,
			missedOn: "2026-09-22",
		});
	});

	it("counts no miss on a pending entry a refused line still names", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);

		const synced = await sync(account.id, bank.connectionId, [
			pendingLine(amount, { date: "2026-08-31" }),
		]);

		expect(synced.rejected).toEqual([{ ref: "0", reason: "BEFORE_OPENING_DATE" }]);
		await expect(rowOf(id)).resolves.toMatchObject({ pending: true, missed: 0 });
	});

	it("counts no miss on a pending entry a refused line names by its fingerprint", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: null }),
		]);

		const synced = await sync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: null, currency: "USD" }),
		]);

		expect(synced.rejected).toEqual([{ ref: "0", reason: "CURRENCY_MISMATCH" }]);
		await expect(rowOf(id)).resolves.toMatchObject({ pending: true, missed: 0 });
	});

	it("counts no miss for a read that stopped part way", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(-transferAmount(), { date: "2026-09-21" }),
		]);

		await sync(account.id, bank.connectionId, [], null, null);
		await sync(account.id, bank.connectionId, [], null, null);

		await expect(rowOf(id)).resolves.toMatchObject({ pending: true, missed: 0 });
	});

	it("counts a miss only on a pending entry dated from the read's first day", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [before = "", onFirstDay = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "p-1", date: "2026-09-10" }),
			pendingLine(amount - 1, { externalId: "p-2", date: "2026-09-11" }),
		]);

		await sync(account.id, bank.connectionId, [], null, "2026-09-11");

		await expect(rowOf(before)).resolves.toMatchObject({ date: "2026-09-10", missed: 0 });
		await expect(rowOf(onFirstDay)).resolves.toMatchObject({ date: "2026-09-11", missed: 1 });
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

/** Two identical pending entries, then the first one booked beside the second's line. */
async function firstBooked() {
	const { account, bank } = await linkedChecking();
	const amount = -transferAmount();
	const [first = "", second = ""] = await createdBySync(account.id, bank.connectionId, [
		twin(amount),
		twin(amount),
	]);
	const synced = await sync(account.id, bank.connectionId, [settled(amount), twin(amount)]);

	return { account, bank, amount, first, second, synced };
}

describe("identical pending lines", () => {
	it("refreshes the second entry and books the first when the first is booked", async () => {
		const { account, first, second, synced } = await firstBooked();

		expect(synced.created).toEqual([]);
		await expect(rowOf(first)).resolves.toMatchObject({
			pending: false,
			label: "CB BOULANGERIE 19/09",
			missed: 0,
		});
		await expect(rowOf(second)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("keeps the second entry when the next statement lists its line first", async () => {
		const { account, bank, amount, first, second } = await firstBooked();

		const synced = await sync(account.id, bank.connectionId, [twin(amount), settled(amount)]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.present).toEqual([expect.objectContaining({ entryId: first })]);
		await expect(rowOf(second)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("books the second entry in place in its turn", async () => {
		const { account, bank, amount, first, second } = await firstBooked();

		const synced = await sync(account.id, bank.connectionId, [settled(amount), settled(amount)]);

		expect(synced.created).toEqual([]);
		await expect(rowOf(first)).resolves.toMatchObject({ pending: false });
		await expect(rowOf(second)).resolves.toMatchObject({ pending: false });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("finds the booked entry again for a pending line listed beside its booked version", async () => {
		const { account, bank, amount, first, second } = await firstBooked();

		const synced = await sync(account.id, bank.connectionId, [
			twin(amount),
			twin(amount),
			settled(amount),
		]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.present).toEqual([
			expect.objectContaining({ ref: "0", entryId: first }),
			expect.objectContaining({ ref: "2", entryId: first }),
		]);
		await expect(rowOf(second)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("gives each of several twins its own entry, in the order they were created", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const ids = await createdBySync(account.id, bank.connectionId, [
			twin(amount),
			twin(amount),
			twin(amount),
		]);

		const synced = await sync(account.id, bank.connectionId, [
			twin(amount),
			twin(amount),
			twin(amount),
		]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.present).toEqual([]);
		const rows = await Promise.all(ids.map(async (id) => rowOf(id)));
		expect(rows.map((row) => [row?.pending, row?.missed])).toEqual([
			[true, 0],
			[true, 0],
			[true, 0],
		]);
	});

	it("keeps one fingerprint per group once an index shifted, so a twin bought since goes in", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [first = "", second = ""] = await createdBySync(account.id, bank.connectionId, [
			twin(amount),
			twin(amount),
		]);
		await deleteTransaction(deps(), first, { origin: "user" });
		// The second entry's line now carries the first one's index.
		await sync(account.id, bank.connectionId, [twin(amount)]);
		await expect(keysOf(second)).resolves.toHaveLength(1);

		// The deleted twin's line stays out (Story 11.6); a third one is new.
		const synced = await sync(account.id, bank.connectionId, [
			twin(amount),
			twin(amount),
			twin(amount),
		]);

		expect(synced.created).toHaveLength(1);
		await expect(rowOf(second)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("still recognises the third of three twins once the first two are deleted", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [first = "", second = "", third = ""] = await createdBySync(
			account.id,
			bank.connectionId,
			[twin(amount), twin(amount), twin(amount)],
		);
		await deleteTransaction(deps(), first, { origin: "user" });
		await deleteTransaction(deps(), second, { origin: "user" });

		const synced = await sync(account.id, bank.connectionId, [twin(amount)]);

		expect(synced.created).toEqual([]);
		await expect(rowOf(third)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("never gives a new reference the pending entry of another one", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [earlier = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "r2" }),
		]);

		const [later = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "r3" }),
		]);
		await sync(account.id, bank.connectionId, [
			bookedLine(amount, { externalId: "r2", date: "2026-09-20" }),
			pendingLine(amount, { externalId: "r3" }),
		]);

		expect(later).not.toBe(earlier);
		await expect(rowOf(earlier)).resolves.toMatchObject({ pending: false });
		await expect(rowOf(later)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("never creates a line whose fingerprint an entry found by its reference holds", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);

		const synced = await sync(account.id, bank.connectionId, [twin(amount), pendingLine(amount)]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.present).toEqual([expect.objectContaining({ ref: "0", entryId: id })]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("creates a twin bought since, and recognises both lines next time", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		await createdBySync(account.id, bank.connectionId, [twin(amount)]);

		const synced = await sync(account.id, bank.connectionId, [twin(amount), twin(amount)]);
		const again = await sync(account.id, bank.connectionId, [twin(amount), twin(amount)]);

		expect(synced.created).toHaveLength(1);
		expect(again.created).toHaveLength(0);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("creates a pending line beside a pending entry of another group", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [twin(amount)]);

		const synced = await sync(account.id, bank.connectionId, [twin(amount - 1), twin(amount)]);

		expect(synced.created).toHaveLength(1);
		await expect(rowOf(id)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});
});
