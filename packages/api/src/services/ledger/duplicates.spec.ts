import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entryKeys } from "@archant/data/schema/entry-keys";
import {
	recurringAllocations,
	recurringMatchRejections,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { transactions } from "@archant/data/schema/transactions";

import { MAX_TAGS_PER_TRANSACTION, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import {
	add,
	addStandard,
	asUser,
	categoryOf,
	categoryOriginOf,
	deps,
	history,
	importStatement,
	insertTransfer,
	keyRows,
	keysOf,
	line,
	link,
	linkedChecking,
	lockedFields,
	newBankAccount,
	newCategory,
	newTag,
	openChecking,
	pendingLine,
	rejectedRows,
	rowOf,
	revert,
	statementOf,
	sync,
	tagsOf,
	temp,
	transactionCount,
	transferAmount,
	transferRows,
	unpair,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { addAttachment, listAttachments } from "./attachments.ts";
import {
	dismissDuplicate,
	dismissPostedMatch,
	duplicateCandidates,
	mergeDuplicate,
	mergePending,
	pendingMergeCandidates,
	postedMatchOf,
} from "./duplicates.ts";
import { deleteTransaction, updateTransaction } from "./edits.ts";
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
			await unpair(flagged, first, theirs, ours);
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

		it("moves the flagged one's recurring payments and rejections, but for those the survivor holds", async () => {
			const { account, first, flagged } = await fileTie();
			const now = Date.now();
			const series = (id: string) => ({
				id,
				accountId: account.id,
				labelKey: id,
				label: id,
				amount: -1000,
				currency: "EUR",
				expectedDayOfMonth: 5,
				lastOccurrenceDate: "2026-09-05",
				nextExpectedDate: "2026-10-05",
				occurrenceCount: 1,
				createdAt: now,
				updatedAt: now,
			});
			await temp.db
				.insert(recurringTransactions)
				.values([series("toll"), series("fuel"), series("rent")]);
			const occurrence = (id: string, seriesId: string) => ({
				id,
				recurringTransactionId: seriesId,
				originalDueOn: "2026-09-05",
				dueOn: "2026-09-05",
				currency: "EUR",
				createdAt: now,
				updatedAt: now,
			});
			await temp.db
				.insert(recurringOccurrences)
				.values([
					occurrence("toll-sep", "toll"),
					occurrence("fuel-sep", "fuel"),
					occurrence("rent-sep", "rent"),
				]);
			const payment = (
				id: string,
				occurrenceId: string,
				entryId: string,
				state: "suggested" | "confirmed" = "confirmed",
				allocatedAmount = 500,
			) => ({
				id,
				recurringOccurrenceId: occurrenceId,
				entryId,
				allocatedAmount,
				state,
				source: "user_confirmed" as const,
				paidOn: "2026-09-05",
				createdAt: now,
				updatedAt: now,
			});
			await temp.db.insert(recurringAllocations).values([
				payment("moved", "toll-sep", flagged),
				payment("held", "fuel-sep", first),
				payment("dropped", "fuel-sep", flagged),
				// A confirmed payment wins over the survivor's suggestion, and pays the rent.
				payment("suggestion", "rent-sep", first, "suggested", 1000),
				payment("upgraded", "rent-sep", flagged, "confirmed", 1000),
			]);
			const rejection = (id: string, seriesId: string, entryId: string) => ({
				id,
				recurringTransactionId: seriesId,
				entryId,
				createdAt: now,
				updatedAt: now,
			});
			await temp.db
				.insert(recurringMatchRejections)
				.values([
					rejection("refused", "toll", flagged),
					rejection("kept", "fuel", first),
					rejection("twin", "fuel", flagged),
				]);

			await mergeDuplicate(deps(), flagged, first);

			await expect(
				temp.db
					.select({ id: recurringAllocations.id, entryId: recurringAllocations.entryId })
					.from(recurringAllocations)
					.orderBy(recurringAllocations.id),
			).resolves.toEqual([
				{ id: "held", entryId: first },
				{ id: "moved", entryId: first },
				{ id: "upgraded", entryId: first },
			]);
			await expect(
				temp.db
					.select({ id: recurringOccurrences.id, status: recurringOccurrences.status })
					.from(recurringOccurrences)
					.orderBy(recurringOccurrences.id),
			).resolves.toEqual([
				{ id: "fuel-sep", status: "scheduled" },
				{ id: "rent-sep", status: "paid" },
				{ id: "toll-sep", status: "scheduled" },
			]);
			await expect(
				temp.db
					.select({ id: recurringMatchRejections.id, entryId: recurringMatchRejections.entryId })
					.from(recurringMatchRejections)
					.orderBy(recurringMatchRejections.id),
			).resolves.toEqual([
				{ id: "kept", entryId: first },
				{ id: "refused", entryId: first },
			]);
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

// Story 29.7: a pending line booked at another amount, suggested and merged as Sure.

let lastOwn = 0;

/**
 * An expense of its own, a hundred times `amount` in minor units: step 6
 * never pairs it with another test's rows, and its ratio to another stays.
 */
const own = (amount: number) => amount * 100 - (lastOwn += 1);

/** A bank line of « Le Bistrot », pending or booked, on a day of September. */
const bistrot = (
	amount: number,
	day: number,
	overrides: Partial<Parameters<typeof line>[0]> = {},
) =>
	pendingLine(amount, {
		externalId: crypto.randomUUID(),
		date: `2026-09-${String(day).padStart(2, "0")}`,
		label: "LE BISTROT PARIS CB",
		merchant: "Le Bistrot",
		...overrides,
	});

const booked = (amount: number, day: number, overrides: Partial<Parameters<typeof line>[0]> = {}) =>
	bistrot(amount, day, { label: "LE BISTROT PARIS", pending: false, ...overrides });

/** A linked account with one pending line, and the entry it made. */
async function pendingOf(
	amount: number,
	day = 18,
	overrides: Partial<Parameters<typeof line>[0]> = {},
) {
	const { account, bank } = await linkedChecking();
	const pendingLineOf = bistrot(amount, day, overrides);
	const {
		created: [pendingId = ""],
	} = await sync(account.id, bank.connectionId, [pendingLineOf]);

	return { account, bank, pendingId, pendingLineOf };
}

async function suggestionOf(entryId: string) {
	return (await findTransaction(deps(), entryId))?.postedMatch;
}

describe("pending duplicates", () => {
	describe("suggestions", () => {
		it("suggests a tip's pending entry with medium confidence, and names the booked line", async () => {
			const tip = own(-2000);
			const { account, bank, pendingId } = await pendingOf(tip);

			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(tip - 30000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toEqual({
				id: bookedId,
				confidence: "medium",
			});
			await expect(postedMatchOf(deps(), pendingId)).resolves.toEqual({
				id: bookedId,
				date: "2026-09-19",
				label: "LE BISTROT PARIS",
				amount: tip - 30000,
				currency: "EUR",
				accountId: account.id,
				accountName: account.name,
			});
			await expect(suggestionOf(bookedId)).resolves.toBeNull();
			const { items } = await listTransactions(
				deps(),
				{ accountIds: [account.id] },
				{ page: 1, pageSize: 50 },
			);
			expect(items.find(({ id }) => id === pendingId)?.postedMatch).toEqual({
				id: bookedId,
				confidence: "medium",
			});
		});

		it.each([
			["3 days before", 16, "medium"],
			["4 days before", 15, null],
			["after", 20, null],
		])("keeps to pending entries 0 to 3 days before: %s", async (_, day, confidence) => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount, day);

			await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			expect((await suggestionOf(pendingId))?.confidence ?? null).toBe(confidence);
		});

		it("suggests with low confidence on a large gap, merchant and words alike", async () => {
			const amount = own(-1200);
			const { account, bank, pendingId } = await pendingOf(amount);

			await sync(account.id, bank.connectionId, [booked(amount - 80000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ confidence: "low" });
		});

		it("suggests nothing on a large gap with another merchant, nor under half", async () => {
			const gap = own(-1200);
			const { account, bank, pendingId } = await pendingOf(gap);
			const half = own(-900);
			const under = await pendingOf(half);

			await sync(account.id, bank.connectionId, [
				booked(gap - 80000, 19, { merchant: "Autre Bistrot" }),
			]);
			await sync(under.account.id, under.bank.connectionId, [booked(half - 110000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toBeNull();
			await expect(suggestionOf(under.pendingId)).resolves.toBeNull();
		});

		it("lets the label words decide between two pending entries of the merchant", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [other = ""],
			} = await sync(account.id, bank.connectionId, [
				bistrot(amount - 10000, 18, { label: "BISTROT TERRASSE" }),
			]);

			await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ confidence: "medium" });
			await expect(suggestionOf(other)).resolves.toBeNull();
		});

		it("suggests none when the words leave two pending entries", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [other = ""],
			} = await sync(account.id, bank.connectionId, [bistrot(amount - 10000, 17)]);

			await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toBeNull();
			await expect(suggestionOf(other)).resolves.toBeNull();
		});

		it("keeps the first suggestion, and never suggests again once dismissed", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [first = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			await sync(account.id, bank.connectionId, [booked(amount - 20000, 20)]);
			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: first });

			await dismissPostedMatch(deps(), pendingId);
			await dismissPostedMatch(deps(), pendingId);
			await expect(suggestionOf(pendingId)).resolves.toBeNull();
			await expect(postedMatchOf(deps(), pendingId)).resolves.toBeNull();

			await deleteTransaction(deps(), first, asUser);
			await sync(account.id, bank.connectionId, [booked(amount - 10000, 20)]);
			await expect(suggestionOf(pendingId)).resolves.toBeNull();
		});

		it("drops the suggestion with its booked line, and takes a new one then", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [first = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			await deleteTransaction(deps(), first, asUser);
			await expect(suggestionOf(pendingId)).resolves.toBeNull();

			const {
				created: [second = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 20000, 20)]);
			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: second });
		});

		it("keeps an entry holding a suggestion among the candidates, so two fit entries stay ambiguous", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [first = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 20000, 19)]);
			const {
				created: [second = ""],
			} = await sync(account.id, bank.connectionId, [bistrot(amount - 10000, 18)]);

			await sync(account.id, bank.connectionId, [booked(amount - 30000, 20)]);

			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: first });
			await expect(suggestionOf(second)).resolves.toBeNull();
		});

		it("answers no line once the suggested one is split, which the merge refuses", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);

			await splitTransaction(
				deps(),
				bookedId,
				[
					{ label: "Repas", amount: toMinorUnits(amount - 29000), categoryId: null },
					{ label: "Pourboire", amount: toMinorUnits(-1000), categoryId: null },
				],
				asUser,
			);

			await expect(postedMatchOf(deps(), pendingId)).resolves.toBeNull();
		});

		it("moves the suggestion onto the line its booked line is merged into", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const repeated = toMinorUnits(amount - 30000);
			const kept = await add(account.id, { date: "2026-09-18", amount: repeated });
			await add(account.id, { date: "2026-09-20", amount: repeated });
			const {
				created: [flagged = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);
			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: flagged });

			await mergeDuplicate(deps(), flagged, kept);

			await expect(suggestionOf(pendingId)).resolves.toEqual({ id: kept, confidence: "medium" });
			await expect(postedMatchOf(deps(), pendingId)).resolves.toMatchObject({ id: kept });
		});

		it("suggests the first of two booked lines of one statement that fit", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);

			const {
				created: [first = ""],
			} = await sync(account.id, bank.connectionId, [
				booked(amount - 30000, 20),
				booked(amount - 20000, 19),
			]);

			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: first });
		});

		it("dismisses nothing on an entry without a suggestion, so a later one still comes", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);

			await dismissPostedMatch(deps(), pendingId);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);
			await dismissPostedMatch(deps(), bookedId);

			await expect(suggestionOf(pendingId)).resolves.toMatchObject({ id: bookedId });
			const dismissed = await temp.db
				.select({ dismissed: transactions.postedMatchDismissed })
				.from(transactions)
				.where(eq(transactions.entryId, bookedId))
				.get();
			expect(dismissed).toEqual({ dismissed: false });
		});

		it("suggests nothing from a file import, a manual line or a pending line", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);

			await importStatement(
				account.id,
				statementOf(
					line({
						date: "2026-09-19",
						amount: toMinorUnits(amount - 30000),
						label: "LE BISTROT PARIS",
					}),
				),
			);
			await add(account.id, {
				date: "2026-09-19",
				amount: toMinorUnits(amount - 20000),
				label: "LE BISTROT PARIS",
			});
			await sync(account.id, bank.connectionId, [bistrot(amount - 10000, 19)]);

			await expect(suggestionOf(pendingId)).resolves.toBeNull();
		});

		it("refuses to dismiss an unknown transaction", async () => {
			await expect(dismissPostedMatch(deps(), crypto.randomUUID())).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			await expect(postedMatchOf(deps(), crypto.randomUUID())).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});
	});

	describe("mergePending", () => {
		it("leaves the booked line, with the pending category, date, tags, attachment and notes", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId, pendingLineOf } = await pendingOf(amount);
			const category = await newCategory("Restaurants");
			const tag = await newTag("Sorties");
			await updateTransaction(
				deps(),
				pendingId,
				{ categoryId: category, tagIds: [tag], notes: "Avec Paul" },
				asUser,
			);
			await addAttachment(
				deps(),
				pendingId,
				{
					filename: "ticket.png",
					contentType: "image/png",
					bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
				},
				asUser,
			);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [
				booked(amount - 30000, 20, { notes: "CB 18/09" }),
			]);
			const merchant = (await findTransaction(deps(), bookedId))?.merchantId;

			await mergePending(deps(), pendingId, bookedId);

			await expect(findTransaction(deps(), pendingId)).resolves.toBeNull();
			await expect(findTransaction(deps(), bookedId)).resolves.toMatchObject({
				date: "2026-09-18",
				amount: amount - 30000,
				label: "LE BISTROT PARIS",
				merchantId: merchant,
				categoryId: category,
				notes: "CB 18/09\n\nAvec Paul",
				tagIds: [tag],
				pending: false,
			});
			await expect(categoryOriginOf(bookedId)).resolves.toBe("user");
			await expect(lockedFields(bookedId)).resolves.toEqual(["date", "amount"]);
			await expect(listAttachments(deps(), bookedId)).resolves.toHaveLength(1);
			const days = await history(account.id);
			expect(days.get("2026-09-17")).toBe(100000 - (amount - 30000));
			expect(days.get("2026-09-18")).toBe(100000);

			// The bank sending the pending line again finds the survivor.
			const again = await sync(account.id, bank.connectionId, [pendingLineOf]);
			expect(again.created).toEqual([]);
			await expect(transactionCount(account.id)).resolves.toBe(1);
		});

		it("cuts the joined notes to the sheet's limit, the booked line's own first", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			await updateTransaction(deps(), pendingId, { notes: "p".repeat(1500) }, asUser);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [
				booked(amount - 30000, 19, { notes: "b".repeat(1000) }),
			]);

			await mergePending(deps(), pendingId, bookedId);

			const notes = (await rowOf(bookedId))?.notes ?? "";
			expect(notes).toHaveLength(NOTES_MAX_LENGTH);
			expect(notes).toBe(`${"b".repeat(1000)}\n\n${"p".repeat(NOTES_MAX_LENGTH - 1002)}`);
		});

		it("refuses a split's parent or line and writes nothing", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 19)]);
			const {
				childIds: [child = ""],
			} = await splitTransaction(
				deps(),
				bookedId,
				[
					{ label: "Repas", amount: toMinorUnits(amount - 29000), categoryId: null },
					{ label: "Pourboire", amount: toMinorUnits(-1000), categoryId: null },
				],
				asUser,
			);

			await expect(mergePending(deps(), pendingId, bookedId)).rejects.toMatchObject({
				code: "TRANSACTION_SPLIT",
			});
			await expect(mergePending(deps(), pendingId, child)).rejects.toMatchObject({
				code: "TRANSACTION_SPLIT",
			});
			await expect(rowOf(pendingId)).resolves.toMatchObject({ pending: true });
			await expect(transactionCount(account.id)).resolves.toBe(4);
		});

		it("keeps a locked date and category, and an excluded line's own", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const category = await newCategory("Restaurants");
			const kept = await newCategory("Gardée");
			await updateTransaction(
				deps(),
				pendingId,
				{ categoryId: category, notes: "Avec Paul" },
				asUser,
			);
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(amount - 30000, 20)]);
			await updateTransaction(deps(), bookedId, { date: "2026-09-21", categoryId: kept }, asUser);

			await mergePending(deps(), pendingId, bookedId);

			await expect(rowOf(bookedId)).resolves.toMatchObject({
				date: "2026-09-21",
				notes: "Avec Paul",
			});
			await expect(categoryOf(bookedId)).resolves.toBe(kept);

			const other = await pendingOf(own(-2000));
			await updateTransaction(
				deps(),
				other.pendingId,
				{ categoryId: category, notes: "CB" },
				asUser,
			);
			const {
				created: [excluded = ""],
			} = await sync(other.account.id, other.bank.connectionId, [
				booked(own(-50), 20, { notes: "CB" }),
			]);
			await updateTransaction(deps(), excluded, { excluded: true }, asUser);

			await mergePending(deps(), other.pendingId, excluded);

			await expect(rowOf(excluded)).resolves.toMatchObject({ date: "2026-09-20", notes: "CB" });
			await expect(categoryOf(excluded)).resolves.toBeNull();
			await expect(lockedFields(excluded)).resolves.toEqual(["excluded", "date", "amount"]);
		});

		it("refuses an entry already booked, another account's line, a pending one and an unknown id", async () => {
			const amount = own(-2000);
			const { account, bank, pendingId } = await pendingOf(amount);
			const {
				created: [secondPending = ""],
			} = await sync(account.id, bank.connectionId, [bistrot(own(-3000), 18)]);
			const elsewhere = await pendingOf(own(-2000));
			const {
				created: [foreign = ""],
			} = await sync(elsewhere.account.id, elsewhere.bank.connectionId, [booked(own(-70), 19)]);

			await expect(mergePending(deps(), pendingId, foreign)).rejects.toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "into", code: "not_a_candidate" }],
			});
			await expect(mergePending(deps(), pendingId, secondPending)).rejects.toMatchObject({
				code: "VALIDATION_ERROR",
			});
			await expect(mergePending(deps(), pendingId, pendingId)).rejects.toMatchObject({
				code: "VALIDATION_ERROR",
			});
			await expect(mergePending(deps(), crypto.randomUUID(), foreign)).rejects.toMatchObject({
				code: "NOT_FOUND",
			});

			// Booked at its own amount, the entry is pending no more.
			const {
				created: [bookedId = ""],
			} = await sync(account.id, bank.connectionId, [booked(own(-80), 19)]);
			await sync(account.id, bank.connectionId, [booked(amount, 19)]);

			await expect(mergePending(deps(), pendingId, bookedId)).rejects.toMatchObject({
				code: "DUPLICATE_RESOLVED",
			});
			await expect(transactionCount(account.id)).resolves.toBe(3);
			await expect(pendingMergeCandidates(deps(), pendingId, 0)).resolves.toEqual({
				candidates: [],
				hasMore: false,
			});
		});
	});

	describe("pendingMergeCandidates", () => {
		it("lists the account's booked lines ten at a time, the latest first", async () => {
			const { account, bank, pendingId } = await pendingOf(own(-2000));
			const lines = Array.from({ length: 11 }, (_, index) =>
				booked(own(-100), 1 + index, { label: `LIGNE ${index}` }),
			);
			const { created } = await sync(account.id, bank.connectionId, lines);
			await sync(account.id, bank.connectionId, [bistrot(own(-3000), 18)]);
			const other = await openChecking({ name: "Autre" });
			await add(other.id, { date: "2026-09-12" });

			const first = await pendingMergeCandidates(deps(), pendingId, 0);
			const second = await pendingMergeCandidates(deps(), pendingId, 10);

			expect(first.hasMore).toBe(true);
			expect(first.candidates.map(({ id }) => id)).toEqual(created.toReversed().slice(0, 10));
			expect(second).toEqual({
				candidates: [expect.objectContaining({ id: created[0], label: "LIGNE 0" })],
				hasMore: false,
			});
		});
	});
});
