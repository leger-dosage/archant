import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { transactions } from "@archant/data/schema/transactions";

import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import {
	add,
	addStandard,
	asUser,
	categoryOf,
	deps,
	history,
	importStatement,
	insertTransfer,
	keyRows,
	keysOf,
	line,
	link,
	lockedFields,
	newBankAccount,
	newCategory,
	newTag,
	openChecking,
	rejectedRows,
	revert,
	statementOf,
	sync,
	tagsOf,
	temp,
	transactionCount,
	transferAmount,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { dismissDuplicate, duplicateCandidates, mergeDuplicate } from "./duplicates.ts";
import { updateTransaction } from "./edits.ts";
import { removableOf } from "./import-revert.ts";
import { entryOrigins, findTransaction, listTransactions } from "./queries.ts";
import { recordSnapshot } from "./snapshots.ts";
import { splitTransaction } from "./splits.ts";

useLedgerDatabase();

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

	describe("and a split", () => {
		it("never offers a split's parent or child, and refuses merging into either", async () => {
			const { account, amount, first, second, flagged } = await fileTie();
			const parent = await add(account.id, { date: "2026-09-05", amount, label: "PEAGE D" });
			const split = await splitTransaction(
				deps(),
				parent,
				[
					{ label: "Péage", amount, categoryId: null },
					{ label: "Rien", amount: toMinorUnits(0), categoryId: null },
				],
				asUser,
			);
			const [child = ""] = split.childIds;

			await expect(duplicateCandidates(deps(), flagged)).resolves.toMatchObject([
				{ id: first },
				{ id: second },
			]);
			await expect(mergeDuplicate(deps(), flagged, parent)).rejects.toMatchObject({
				code: "TRANSACTION_SPLIT",
			});
			await expect(mergeDuplicate(deps(), flagged, child)).rejects.toMatchObject({
				code: "TRANSACTION_SPLIT",
			});
			await expect(flagOf(flagged)).resolves.toBe(true);
		});
	});
});
