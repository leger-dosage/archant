import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { MAX_ATTACHMENTS_PER_TRANSACTION } from "@archant/data/attachments";
import { toMinorUnits } from "@archant/data/money";
import { transactionAttachments } from "@archant/data/schema/transaction-attachments";

import {
	add,
	asUser,
	cafe,
	createdBySync,
	deps,
	importStatement,
	line,
	linkedChecking,
	openChecking,
	pendingLine,
	revert,
	rowOf,
	setToday,
	splitInTwo,
	statementOf,
	sync,
	temp,
	transferAmount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { deleteAccount } from "./accounts.ts";
import { addAttachment, deleteAttachment, listAttachments, readAttachment } from "./attachments.ts";
import { duplicateCandidates, mergeDuplicate } from "./duplicates.ts";
import { bulkDeleteTransactions, deleteTransaction } from "./edits.ts";
import { editSplit, unsplitTransaction } from "./splits.ts";

useLedgerDatabase();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

const attach = async (transactionId: string, filename = "ticket.png") =>
	addAttachment(deps(), transactionId, { filename, contentType: "image/png", bytes: PNG }, asUser);

/**
 * Attaches `filename` to each of `ids`, one after the other: each is an
 * immediate ledger write, and the synchronous driver holds the thread while
 * a second one waits on the lock the first keeps.
 */
async function attachEach(ids: readonly string[], filename = "ticket.png") {
	await ids.reduce<Promise<unknown>>(async (previous, id) => {
		await previous;
		await attach(id, filename);
	}, Promise.resolve());
}

/** Every attachment row of `transactionId`, read past the ledger. */
async function rowsOf(transactionId: string) {
	return temp.db
		.select({ id: transactionAttachments.id, filename: transactionAttachments.filename })
		.from(transactionAttachments)
		.where(eq(transactionAttachments.transactionId, transactionId))
		.orderBy(asc(transactionAttachments.createdAt), asc(transactionAttachments.id));
}

const notFound = { code: "NOT_FOUND" };

describe("addAttachment and listAttachments", () => {
	it("attaches a file and lists it with its size, oldest first", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		const first = await attach(id, "ticket.png");
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		const second = await attach(id, "facture.png");

		expect(first).toMatchObject({
			transactionId: id,
			filename: "ticket.png",
			contentType: "image/png",
			byteSize: PNG.byteLength,
			createdAt: Date.parse("2026-09-21T10:00:00Z"),
		});
		await expect(listAttachments(deps(), id)).resolves.toEqual([first, second]);
	});

	it("lists nothing for a transaction without attachments", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await expect(listAttachments(deps(), id)).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(attach("nope")).rejects.toMatchObject(notFound);
		await expect(listAttachments(deps(), "nope")).rejects.toMatchObject(notFound);
	});

	it("refuses an eleventh file on `file` with attachment_limit", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await attachEach(Array.from({ length: MAX_ATTACHMENTS_PER_TRANSACTION }, () => id));

		await expect(attach(id)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "file", code: "attachment_limit" }],
		});
		await expect(rowsOf(id)).resolves.toHaveLength(MAX_ATTACHMENTS_PER_TRANSACTION);
	});

	it("gives a split's line and its parent attachments of their own", async () => {
		const account = await openChecking();
		const { parent, food, home } = await splitInTwo(account.id);

		await attach(parent, "parent.png");
		await attach(food, "courses.png");

		await expect(listAttachments(deps(), food)).resolves.toMatchObject([
			{ filename: "courses.png" },
		]);
		await expect(listAttachments(deps(), parent)).resolves.toMatchObject([
			{ filename: "parent.png" },
		]);
		await expect(listAttachments(deps(), home)).resolves.toEqual([]);
	});
});

describe("readAttachment", () => {
	it("gives the bytes with the stored type and name", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const { id: attachmentId } = await attach(id);

		const file = await readAttachment(deps(), id, attachmentId);

		expect(file).toMatchObject({
			filename: "ticket.png",
			contentType: "image/png",
			byteSize: PNG.byteLength,
		});
		expect(new Uint8Array(file.content)).toEqual(PNG);
	});

	it("answers NOT_FOUND for an unknown attachment, or one of another transaction", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const other = await add(account.id, { label: "Pharmacie" });
		const { id: attachmentId } = await attach(other);

		await expect(readAttachment(deps(), id, "nope")).rejects.toMatchObject(notFound);
		await expect(readAttachment(deps(), id, attachmentId)).rejects.toMatchObject(notFound);
	});
});

describe("deleteAttachment", () => {
	it("deletes one attachment and keeps the others", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const { id: gone } = await attach(id, "a.png");
		const { id: kept } = await attach(id, "b.png");

		await deleteAttachment(deps(), id, gone, asUser);

		await expect(rowsOf(id)).resolves.toEqual([{ id: kept, filename: "b.png" }]);
	});

	it("answers NOT_FOUND for an unknown attachment, or one of another transaction", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const other = await add(account.id, { label: "Pharmacie" });
		const { id: attachmentId } = await attach(other);

		await expect(deleteAttachment(deps(), id, "nope", asUser)).rejects.toMatchObject(notFound);
		await expect(deleteAttachment(deps(), id, attachmentId, asUser)).rejects.toMatchObject(
			notFound,
		);
		await expect(rowsOf(other)).resolves.toHaveLength(1);
	});
});

describe("every ledger delete", () => {
	it("deletes a transaction's attachments with it", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await attach(id);

		await deleteTransaction(deps(), id, asUser);

		await expect(rowsOf(id)).resolves.toEqual([]);
	});

	it("deletes a split parent's attachments and its lines' with it", async () => {
		const account = await openChecking();
		const { parent, food } = await splitInTwo(account.id);
		await attach(parent);
		await attach(food);

		await deleteTransaction(deps(), parent, asUser);

		await expect(rowsOf(parent)).resolves.toEqual([]);
		await expect(rowsOf(food)).resolves.toEqual([]);
	});

	it("deletes the attachments of a bulk delete's rows", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const { parent, food } = await splitInTwo(account.id);
		const kept = await add(account.id, { label: "Pharmacie" });
		await attachEach([id, parent, food, kept]);

		await expect(bulkDeleteTransactions(deps(), { ids: [id, parent] }, asUser)).resolves.toBe(2);

		await expect(rowsOf(id)).resolves.toEqual([]);
		await expect(rowsOf(parent)).resolves.toEqual([]);
		await expect(rowsOf(food)).resolves.toEqual([]);
		await expect(rowsOf(kept)).resolves.toHaveLength(1);
	});

	it("deletes the attachments of what an import revert deletes", async () => {
		const account = await openChecking();
		const { importId, result } = await importStatement(account.id, statementOf(cafe));
		const [cafeId = ""] = result.created;
		await attach(cafeId);

		await revert(importId);

		await expect(rowOf(cafeId)).resolves.toBeUndefined();
		await expect(rowsOf(cafeId)).resolves.toEqual([]);
	});

	it("deletes the attachments of an account's transactions with it", async () => {
		const account = await openChecking();
		const other = await openChecking({ name: "Livret" });
		const id = await add(account.id);
		const { food } = await splitInTwo(account.id);
		const elsewhere = await add(other.id, { label: "Pharmacie" });
		await attachEach([id, food, elsewhere]);

		await deleteAccount(deps(), account.id, asUser);

		await expect(rowsOf(id)).resolves.toEqual([]);
		await expect(rowsOf(food)).resolves.toEqual([]);
		await expect(rowsOf(elsewhere)).resolves.toHaveLength(1);
	});

	it("deletes the attachments of a line a split's edit drops, and keeps the others", async () => {
		const account = await openChecking();
		const { parent, food, home, amount } = await splitInTwo(account.id);
		await attachEach([parent, food, home]);

		await editSplit(
			deps(),
			parent,
			[{ id: food, label: "Tout", amount: toMinorUnits(amount), categoryId: null }],
			asUser,
		);

		await expect(rowsOf(home)).resolves.toEqual([]);
		await expect(rowsOf(food)).resolves.toHaveLength(1);
		await expect(rowsOf(parent)).resolves.toHaveLength(1);
	});

	it("deletes the lines' attachments on unsplit, and leaves the parent's where they are", async () => {
		const account = await openChecking();
		const { parent, food } = await splitInTwo(account.id);
		await attach(parent);
		await attach(food);

		await unsplitTransaction(deps(), parent, asUser);

		await expect(rowsOf(food)).resolves.toEqual([]);
		await expect(rowsOf(parent)).resolves.toHaveLength(1);
	});

	it("deletes the attachments of a pending line missing from syncs on two days", async () => {
		const { account, bank } = await linkedChecking();
		const [id = ""] = await createdBySync(account.id, bank.connectionId, [
			pendingLine(-transferAmount(), { date: "2026-09-21" }),
		]);
		await attach(id);

		setToday("2026-09-22T10:00:00Z");
		await sync(account.id, bank.connectionId, []);
		setToday("2026-09-23T10:00:00Z");
		await sync(account.id, bank.connectionId, []);

		await expect(rowOf(id)).resolves.toBeUndefined();
		await expect(rowsOf(id)).resolves.toEqual([]);
	});
});

describe("mergeDuplicate", () => {
	it("moves the absorbed duplicate's receipt onto the survivor, past the cap", async () => {
		const account = await openChecking();
		const amount = toMinorUnits(-transferAmount());
		const first = await add(account.id, { date: "2026-09-04", amount, label: "PEAGE A" });
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		const second = await add(account.id, { date: "2026-09-06", amount, label: "PEAGE B" });
		const { result } = await importStatement(
			account.id,
			statementOf(line({ externalId: "P1", date: "2026-09-05", amount, label: "PEAGE" })),
		);
		const [flagged = ""] = result.created;
		await expect(duplicateCandidates(deps(), flagged)).resolves.toMatchObject([
			{ id: first },
			{ id: second },
		]);
		await attachEach(
			Array.from({ length: MAX_ATTACHMENTS_PER_TRANSACTION }, () => first),
			"survivor.png",
		);
		await attach(flagged, "receipt.png");

		await mergeDuplicate(deps(), flagged, first);

		const rows = await rowsOf(first);
		expect(rows).toHaveLength(MAX_ATTACHMENTS_PER_TRANSACTION + 1);
		expect(rows.map((row) => row.filename)).toContain("receipt.png");
		await expect(rowsOf(flagged)).resolves.toEqual([]);
	});
});
