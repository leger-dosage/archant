import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { deletedEntryKeys, entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";

import { lineKeys } from "../../domain/keys.ts";
import {
	add,
	asUser,
	bookedLine,
	cafe,
	counts,
	createdBySync,
	deps,
	importStatement,
	keysOf,
	line,
	linkedChecking,
	newBankLine,
	openChecking,
	pendingLine,
	preview,
	previewRow,
	rowOf,
	setToday,
	settled,
	splitInTwo,
	statementOf,
	sync,
	temp,
	transactionCount,
	transferAmount,
	twin,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { deleteAccount } from "./accounts.ts";
import { bulkDeleteTransactions, deleteTransaction } from "./edits.ts";

useLedgerDatabase();

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

// Story 11.6: a transaction the user deleted stays deleted, whatever a sync rereads.

async function tombstonesOf(accountId: string) {
	const rows = await temp.db
		.select({ source: deletedEntryKeys.source, key: deletedEntryKeys.key })
		.from(deletedEntryKeys)
		.where(eq(deletedEntryKeys.accountId, accountId));

	return rows.map(({ source, key }) => `${source} ${key.slice(0, 3)}`).toSorted();
}

describe("a deleted transaction and the next sync", () => {
	it("creates nothing for a booked line the user deleted, tombstoned by both keys", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);

		await deleteTransaction(deps(), id, asUser);
		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		await expect(tombstonesOf(account.id)).resolves.toEqual([
			"enable-banking ext",
			"enable-banking fp:",
		]);
		expect(counts(synced)).toMatchObject({ created: 0, present: 0, matched: 0, duplicates: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("creates nothing for a deleted line without a reference", async () => {
		const { account, bank } = await linkedChecking();
		const unreferenced = newBankLine({ externalId: null });
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [unreferenced]);

		await deleteTransaction(deps(), id, asUser);
		const synced = await sync(account.id, bank.connectionId, [unreferenced]);

		expect(synced.created).toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("brings back neither of two lines deleted in bulk", async () => {
		const { account, bank } = await linkedChecking();
		const lines = [newBankLine(), newBankLine({ externalId: "EB2", label: "AUTRE" })];
		const ids = await createdBySync(account.id, bank.connectionId, lines);

		await expect(bulkDeleteTransactions(deps(), { ids }, asUser)).resolves.toBe(2);
		const synced = await sync(account.id, bank.connectionId, lines);

		await expect(tombstonesOf(account.id)).resolves.toHaveLength(4);
		expect(synced.created).toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("keeps no tombstone for a manual entry", async () => {
		const { account } = await linkedChecking();
		const id = await add(account.id);

		await deleteTransaction(deps(), id, asUser);

		await expect(tombstonesOf(account.id)).resolves.toEqual([]);
	});

	it("tombstones the bank keys only, so re-importing the file brings the entry back", async () => {
		const { account, bank } = await linkedChecking();
		const file = statementOf(line({ label: "CB CARREFOUR" }));
		const { result } = await importStatement(account.id, file, { source: "csv" });
		const [paired = ""] = result.created;
		await sync(account.id, bank.connectionId, [newBankLine()]);

		await deleteTransaction(deps(), paired, asUser);

		await expect(tombstonesOf(account.id)).resolves.toEqual([
			"enable-banking ext",
			"enable-banking fp:",
		]);
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.accountId, account.id)),
		).resolves.toEqual([]);
		const again = await importStatement(account.id, file, { source: "csv" });
		expect(again.result.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("never gives a deleted line's keys to a manual entry of the same amount nearby", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);
		await deleteTransaction(deps(), id, asUser);
		const manual = await add(account.id, { date: "2026-09-13" });

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		expect(counts(synced)).toMatchObject({ created: 0, matched: 0, duplicates: 0 });
		await expect(keysOf(manual)).resolves.toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("creates nothing when a deleted pending line is listed again, pending or booked under its reference", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await deleteTransaction(deps(), id, asUser);

		const pending = await sync(account.id, bank.connectionId, [pendingLine(amount)]);
		const booked = await sync(account.id, bank.connectionId, [
			bookedLine(amount, { date: "2026-09-20" }),
		]);

		expect(pending.created).toEqual([]);
		expect(booked.created).toEqual([]);
		expect(booked.groups.matched).toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("creates nothing for a deleted pending line whose reference is tombstoned and whose fingerprint names another live entry", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [kept = ""] = await createdBySync(account.id, bank.connectionId, [twin(amount)]);
		const [deleted = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "r9", label: "AUTRE BOULANGERIE" }),
		]);
		await deleteTransaction(deps(), deleted, asUser);

		// Its fingerprint names the kept entry, so only its tombstoned reference drops it.
		const synced = await sync(account.id, bank.connectionId, [
			twin(amount),
			pendingLine(amount, { externalId: "r9" }),
		]);

		expect(synced.created).toEqual([]);
		await expect(rowOf(kept)).resolves.toMatchObject({ pending: true, missed: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("creates a new booked line whose reference is unknown, though its fingerprint is tombstoned", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);
		await deleteTransaction(deps(), id, asUser);

		// Alone in its statement, the new line takes the deleted one's occurrence index.
		const synced = await sync(account.id, bank.connectionId, [newBankLine({ externalId: "EB2" })]);

		expect(synced.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("never recognises a deleted referenced pending line onto a live twin without a reference", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [kept = "", deleted = ""] = await createdBySync(account.id, bank.connectionId, [
			twin(amount),
			pendingLine(amount),
		]);
		await deleteTransaction(deps(), deleted, asUser);

		// Alone in its statement, the deleted line takes the live twin's fingerprint.
		const synced = await sync(account.id, bank.connectionId, [pendingLine(amount)]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.present).toEqual([]);
		await expect(keysOf(kept)).resolves.toHaveLength(1);
		await expect(keysOf(kept)).resolves.not.toContainEqual(expect.stringMatching(/^ext:/u));
	});

	it("never lets a deleted booked line absorb a live pending entry of the same amount", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const deletedLine = bookedLine(amount, { externalId: "b1", date: "2026-09-20" });
		const [deleted = ""] = await createdBySync(account.id, bank.connectionId, [deletedLine]);
		await deleteTransaction(deps(), deleted, asUser);
		const [pending = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(amount, { externalId: "p1", label: "AUTRE ATTENTE" }),
		]);

		const synced = await sync(account.id, bank.connectionId, [deletedLine]);

		expect(synced.groups.present).toEqual([]);
		expect(synced.created).toEqual([]);
		await expect(rowOf(pending)).resolves.toMatchObject({ pending: true });
		await expect(keysOf(pending)).resolves.not.toContain(lineKeys([deletedLine])[0]?.keys.external);
		await expect(keysOf(pending)).resolves.toHaveLength(2);
	});

	it("creates the booked version of a deleted pending line without a reference, a known limit", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [twin(amount)]);
		await deleteTransaction(deps(), id, asUser);

		const synced = await sync(account.id, bank.connectionId, [settled(amount)]);

		expect(synced.created).toHaveLength(1);
	});

	it("keeps no tombstone for a pending entry deleted after two misses, so its line comes back", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const listed = pendingLine(amount, { date: "2026-09-21" });
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [listed]);
		setToday("2026-09-22T10:00:00Z");
		await sync(account.id, bank.connectionId, []);
		setToday("2026-09-23T10:00:00Z");
		await sync(account.id, bank.connectionId, []);
		await expect(rowOf(id)).resolves.toBeUndefined();

		const synced = await sync(account.id, bank.connectionId, [listed]);

		await expect(tombstonesOf(account.id)).resolves.toEqual([]);
		expect(synced.created).toHaveLength(1);
	});

	it("goes with its account", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);
		await deleteTransaction(deps(), id, asUser);

		await deleteAccount(deps(), account.id, asUser);

		await expect(tombstonesOf(account.id)).resolves.toEqual([]);
		await expect(
			temp.db.select().from(accounts).where(eq(accounts.id, account.id)),
		).resolves.toEqual([]);
	});
});

describe("pairing and a split", () => {
	it("never pairs a line with a split's child, and pairs one with the parent the bank knows", async () => {
		const account = await openChecking();
		const { parent, food, amount } = await splitInTwo(account.id, { date: "2026-09-10" });
		const childLine = line({
			externalId: "F-CHILD",
			date: "2026-09-11",
			amount: toMinorUnits(-6_000),
		});
		const parentLine = line({
			externalId: "F-PARENT",
			date: "2026-09-11",
			amount: toMinorUnits(amount),
		});

		const { result } = await importStatement(account.id, statementOf(childLine, parentLine));

		expect(counts(result)).toMatchObject({ created: 1, matched: 1, duplicates: 0 });
		expect(result.groups.matched).toMatchObject([{ entryId: parent }]);
		await expect(keysOf(food)).resolves.toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(4);
	});
});
