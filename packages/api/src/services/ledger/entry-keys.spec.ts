import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";

import {
	add,
	asUser,
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
	splitInTwo,
	statementOf,
	sync,
	temp,
	transactionCount,
	transferAmount,
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

// As in Sure, whose importer finds a line by its reference or creates it: a
// bank line the user deleted comes back when a sync lists it again.

describe("a deleted transaction and the next sync", () => {
	it("brings back a booked line the user deleted", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);

		await deleteTransaction(deps(), id, asUser);
		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		expect(counts(synced)).toMatchObject({ created: 1, present: 0, matched: 0, duplicates: 0 });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("brings back a deleted line without a reference", async () => {
		const { account, bank } = await linkedChecking();
		const unreferenced = newBankLine({ externalId: null });
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [unreferenced]);

		await deleteTransaction(deps(), id, asUser);
		const synced = await sync(account.id, bank.connectionId, [unreferenced]);

		expect(synced.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("brings back both lines deleted in bulk", async () => {
		const { account, bank } = await linkedChecking();
		const lines = [newBankLine(), newBankLine({ externalId: "EB2", label: "AUTRE" })];
		const ids = await createdBySync(account.id, bank.connectionId, lines);

		await expect(bulkDeleteTransactions(deps(), { ids }, asUser)).resolves.toBe(2);
		const synced = await sync(account.id, bank.connectionId, lines);

		expect(synced.created).toHaveLength(2);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("deletes the bank keys with the file keys, so the sync brings the line back once", async () => {
		const { account, bank } = await linkedChecking();
		const file = statementOf(line({ label: "CB CARREFOUR" }));
		const { result } = await importStatement(account.id, file, { source: "csv" });
		const [paired = ""] = result.created;
		await sync(account.id, bank.connectionId, [newBankLine()]);

		await deleteTransaction(deps(), paired, asUser);

		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.accountId, account.id)),
		).resolves.toEqual([]);
		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);
		const again = await importStatement(account.id, file, { source: "csv" });

		expect(synced.created).toHaveLength(1);
		expect(counts(again.result)).toMatchObject({ created: 0, matched: 1 });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("pairs a deleted line listed again with a manual entry of the same amount nearby, as Sure claims it", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [newBankLine()]);
		await deleteTransaction(deps(), id, asUser);
		const manual = await add(account.id, { date: "2026-09-13" });

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		expect(counts(synced)).toMatchObject({ created: 0, matched: 1 });
		await expect(keysOf(manual)).resolves.toHaveLength(2);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("brings back a deleted pending line listed again", async () => {
		const { account, bank } = await linkedChecking();
		const amount = -transferAmount();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [pendingLine(amount)]);
		await deleteTransaction(deps(), id, asUser);

		const synced = await sync(account.id, bank.connectionId, [pendingLine(amount)]);

		expect(synced.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("brings back a pending entry deleted after two misses when the bank lists it again", async () => {
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

		expect(synced.created).toHaveLength(1);
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
