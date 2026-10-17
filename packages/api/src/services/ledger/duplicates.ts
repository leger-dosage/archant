import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import {
	and,
	between,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import {
	recurringAllocations,
	recurringMatchRejections,
} from "@archant/data/schema/recurring-occurrences";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { addDays, daysBetween, minDate } from "../../domain/dates.ts";
import { MATCH_WINDOW_DAYS } from "../../domain/keys.ts";
import { AppError } from "../../lib/errors.ts";
import { NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { refreshCloseState } from "../recurring/payments.ts";
import { moveAttachments } from "./attachments.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { stampedLocks, transactionRow } from "./patch.ts";
import {
	deleteTransactionRows,
	inSplit,
	invalidField,
	notSplitParent,
	oneByOne,
	refuseSplit,
	rejectedOf,
	transferOf,
} from "./shared.ts";

const heldAllocation = alias(recurringAllocations, "held_allocation");
const heldRejection = alias(recurringMatchRejections, "held_rejection");

/**
 * Moves the absorbed entry's recurring payments and rejections onto the
 * survivor (AD-17), so a merge never unpays an occurrence nor suggests a
 * refused transaction again; Sure's orphan repair has no port. Where both
 * pay one occurrence, a confirmed payment wins over a suggestion, else the
 * survivor's stays; a rejection the survivor holds for the series stays.
 * Each occurrence whose payments changed has its close state refreshed.
 */
async function moveRecurringPayments(
	tx: Transaction,
	survivorId: string,
	absorbedId: string,
): Promise<void> {
	const touched = await tx
		.selectDistinct({ id: recurringAllocations.recurringOccurrenceId })
		.from(recurringAllocations)
		.where(eq(recurringAllocations.entryId, absorbedId));

	// The survivor's suggestion gives way to the absorbed one's confirmed payment.
	await tx.delete(recurringAllocations).where(
		and(
			eq(recurringAllocations.entryId, survivorId),
			eq(recurringAllocations.state, "suggested"),
			inArray(
				recurringAllocations.recurringOccurrenceId,
				tx
					.select({ id: heldAllocation.recurringOccurrenceId })
					.from(heldAllocation)
					.where(
						and(eq(heldAllocation.entryId, absorbedId), eq(heldAllocation.state, "confirmed")),
					),
			),
		),
	);
	await tx
		.update(recurringAllocations)
		.set({ entryId: survivorId })
		.where(
			and(
				eq(recurringAllocations.entryId, absorbedId),
				notExists(
					tx
						.select({ id: heldAllocation.id })
						.from(heldAllocation)
						.where(
							and(
								eq(heldAllocation.entryId, survivorId),
								eq(
									heldAllocation.recurringOccurrenceId,
									recurringAllocations.recurringOccurrenceId,
								),
							),
						),
				),
			),
		);
	await tx.delete(recurringAllocations).where(eq(recurringAllocations.entryId, absorbedId));
	await oneByOne(touched, ({ id }) => refreshCloseState(tx, id, Date.now()));
	await tx
		.update(recurringMatchRejections)
		.set({ entryId: survivorId })
		.where(
			and(
				eq(recurringMatchRejections.entryId, absorbedId),
				notExists(
					tx
						.select({ id: heldRejection.id })
						.from(heldRejection)
						.where(
							and(
								eq(heldRejection.entryId, survivorId),
								eq(
									heldRejection.recurringTransactionId,
									recurringMatchRejections.recurringTransactionId,
								),
							),
						),
				),
			),
		);
}

/**
 * `absorb` with an entry as its source (AD-17): a possible duplicate merged
 * by hand into the transaction it repeats. The survivor keeps every column
 * of its own, as an automatic pairing leaves a matched entry; only what
 * points at the absorbed one moves. Its keys move as they are, import and
 * connection included, so a later sync or re-import of its line finds the
 * survivor, and reverting that import or disconnecting treats it as a
 * matched entry. Its tags join the survivor's, past the input limit if need
 * be, and so do its attachments, past their cap: a merge never loses a
 * receipt. Its recurring payments and rejections move, but for those the
 * survivor already holds. Its transfer moves only onto a survivor in none; otherwise it goes,
 * and the other side is a standard transaction again. Its rejected pairs
 * move, but for those the survivor already holds. Returns the absorbed
 * one's date, where balances move; the caller recomputes them.
 */
async function absorbEntry(
	tx: Transaction,
	survivorId: string,
	absorbedId: string,
): Promise<IsoDate> {
	const absorbed = await transactionRow(tx, absorbedId);

	await tx.update(entryKeys).set({ entryId: survivorId }).where(eq(entryKeys.entryId, absorbedId));
	// A pending entry suggested to repeat the absorbed line now repeats the
	// survivor; set null on delete would drop the suggestion.
	await tx
		.update(transactions)
		.set({ postedMatchId: survivorId })
		.where(and(eq(transactions.postedMatchId, absorbedId), ne(transactions.entryId, survivorId)));

	if (absorbed.tagIds.length > 0) {
		await tx
			.insert(taggings)
			.values(absorbed.tagIds.map((tagId) => ({ transactionId: survivorId, tagId })))
			.onConflictDoNothing();
	}

	await moveAttachments(tx, absorbedId, survivorId);
	await moveRecurringPayments(tx, survivorId, absorbedId);

	const survivorInTransfer = await tx
		.select({ id: transfers.id })
		.from(transfers)
		.where(transferOf([survivorId]))
		.get();

	if (survivorInTransfer === undefined) {
		await tx
			.update(transfers)
			.set({ outflowTransactionId: survivorId })
			.where(eq(transfers.outflowTransactionId, absorbedId));
		await tx
			.update(transfers)
			.set({ inflowTransactionId: survivorId })
			.where(eq(transfers.inflowTransactionId, absorbedId));
	}

	const rejected = await tx
		.select({
			id: rejectedTransfers.id,
			outflow: rejectedTransfers.outflowTransactionId,
			inflow: rejectedTransfers.inflowTransactionId,
		})
		.from(rejectedTransfers)
		.where(rejectedOf([absorbedId]));

	await oneByOne(rejected, async (row) => {
		const outflow = row.outflow === absorbedId ? survivorId : row.outflow;
		const inflow = row.inflow === absorbedId ? survivorId : row.inflow;
		const held = await tx
			.select({ id: rejectedTransfers.id })
			.from(rejectedTransfers)
			.where(
				or(
					and(
						eq(rejectedTransfers.outflowTransactionId, outflow),
						eq(rejectedTransfers.inflowTransactionId, inflow),
					),
					and(
						eq(rejectedTransfers.outflowTransactionId, inflow),
						eq(rejectedTransfers.inflowTransactionId, outflow),
					),
				),
			)
			.get();

		// A held pair stays with the survivor; the absorbed one's copy goes with it.
		if (held === undefined) {
			await tx
				.update(rejectedTransfers)
				.set({ outflowTransactionId: outflow, inflowTransactionId: inflow })
				.where(eq(rejectedTransfers.id, row.id));
		}
	});

	await deleteTransactionRows(tx, [absorbedId]);

	return absorbed.date;
}

/** A transaction a possible duplicate may repeat, as the merge dialog lists it. */
export type DuplicateCandidate = {
	id: string;
	date: IsoDate;
	label: string;
	amount: MinorUnits;
	currency: string;
	accountId: string;
	accountName: string;
};

/**
 * `entryId` with its candidates: `pairCandidates`' rule applied to it alone
 * (AD-7). The same account and amount, dated within `MATCH_WINDOW_DAYS`
 * either side, not itself, no part of a split, and carrying no key from a
 * source that keyed it: the entries its import or sync would have paired it
 * with, had there been one, a split parent aside, which a merge would leave
 * with lines summing to another entry (AD-20). Nearest date first, then the
 * older entry. A transaction no longer flagged has none. Throws `NOT_FOUND`
 * for an unknown transaction.
 */
async function duplicateCandidatesOf(
	db: Pick<Transaction, "select" | "selectDistinct">,
	entryId: string,
) {
	const source = await db
		.select({
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			flagged: transactions.possibleDuplicate,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (source === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	if (!source.flagged) {
		return { source, candidates: [] };
	}

	const sources = await db
		.selectDistinct({ source: entryKeys.source })
		.from(entryKeys)
		.where(eq(entryKeys.entryId, entryId));
	const rows = await db
		.select({
			id: entries.id,
			date: entries.date,
			label: transactions.label,
			amount: entries.amount,
			currency: entries.currency,
			accountId: entries.accountId,
			accountName: accounts.name,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(
			and(
				eq(entries.accountId, source.accountId),
				eq(entries.kind, "transaction"),
				eq(entries.amount, source.amount),
				between(
					entries.date,
					addDays(source.date, -MATCH_WINDOW_DAYS),
					addDays(source.date, MATCH_WINDOW_DAYS),
				),
				ne(entries.id, entryId),
				isNull(entries.parentEntryId),
				notSplitParent,
				notExists(
					db
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(
							and(
								eq(entryKeys.entryId, entries.id),
								inArray(
									entryKeys.source,
									sources.map((row) => row.source),
								),
							),
						),
				),
			),
		)
		.orderBy(entries.createdAt, entries.id);

	return {
		source,
		candidates: rows
			.map((row) => ({ row, distance: Math.abs(daysBetween(source.date, row.date)) }))
			// Stable, so rows equally far keep the query's order.
			.toSorted((a, b) => a.distance - b.distance)
			.map(({ row }): DuplicateCandidate => ({ ...row, amount: toMinorUnits(row.amount) })),
	};
}

/**
 * The transactions a possible duplicate may be merged into, nearest date
 * first; none once it is no longer flagged. Throws `NOT_FOUND` for an
 * unknown transaction.
 */
export async function duplicateCandidates(
	deps: ServiceDeps,
	entryId: string,
): Promise<DuplicateCandidate[]> {
	return (await duplicateCandidatesOf(deps.db, entryId)).candidates;
}

/**
 * Merges the possible duplicate `entryId` into `intoId`, one of its
 * candidates, through `absorbEntry`, and recomputes balances from the
 * deleted one's date. There is no way back, as in Sure. The flag and the
 * candidates are read again inside the write, so a merge or a dismissal in
 * another tab cannot slip between them. Throws `NOT_FOUND` for an unknown
 * `entryId`, `TRANSACTION_SPLIT` when either side is a split's parent or
 * child (AD-20), `DUPLICATE_RESOLVED` when it is no longer flagged, and
 * `VALIDATION_ERROR` on `into` when `intoId` is no candidate.
 */
export async function mergeDuplicate(
	deps: ServiceDeps,
	entryId: string,
	intoId: string,
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const { source, candidates } = await duplicateCandidatesOf(tx, entryId);

			await refuseSplit(tx, [entryId, intoId]);

			if (!source.flagged) {
				throw new AppError("DUPLICATE_RESOLVED", "This transaction is no longer flagged.");
			}

			if (!candidates.some(({ id }) => id === intoId)) {
				throw invalidField("into", "not_a_candidate");
			}

			const account = await accountWithOpeningDate(tx, source.accountId);
			const from = await absorbEntry(tx, intoId, entryId);

			await recomputeBalances(tx, account, from, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Clears the possible-duplicate flag, whether set or not. The flag is only
 * ever raised on insert, and a line sent again finds its own row by key, so
 * it never comes back. Throws `NOT_FOUND` for an unknown transaction.
 */
export async function dismissDuplicate(deps: ServiceDeps, entryId: string): Promise<void> {
	const updated = await deps.db
		.update(transactions)
		.set({ possibleDuplicate: false })
		.where(eq(transactions.entryId, entryId))
		.returning({ entryId: transactions.entryId });

	if (updated.length === 0) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}
}

/** How many booked lines « Ouvrir la fusion » lists at a time, as Sure's `@limit = 10`. */
const PENDING_MERGE_PAGE_SIZE = 10;

/** A transaction as `DuplicateCandidate` names it, read in one join. */
function candidateSelect(db: Pick<Transaction, "select">) {
	return db
		.select({
			id: entries.id,
			date: entries.date,
			label: transactions.label,
			amount: entries.amount,
			currency: entries.currency,
			accountId: entries.accountId,
			accountName: accounts.name,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.$dynamic();
}

const asCandidate = (row: Omit<DuplicateCandidate, "amount"> & { amount: number }) => ({
	...row,
	amount: toMinorUnits(row.amount),
});

/** The pending side of a merge, `NOT_FOUND` for an unknown transaction. */
async function pendingSource(db: Pick<Transaction, "select">, entryId: string) {
	const source = await db
		.select({
			accountId: entries.accountId,
			currency: entries.currency,
			date: entries.date,
			notes: transactions.notes,
			categoryId: transactions.categoryId,
			categoryOrigin: transactions.categoryOrigin,
			pending: transactions.pending,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (source === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return source;
}

/**
 * The booked lines a pending entry may be merged into, as Sure's
 * `pending_duplicate_candidates`: its account's, in its currency, not itself,
 * and no part of a split, which the merge refuses (AD-20).
 */
function pendingMergeCondition(
	entryId: string,
	source: { accountId: string; currency: string },
): SQL | undefined {
	return and(
		eq(entries.accountId, source.accountId),
		eq(entries.currency, source.currency),
		eq(transactions.pending, false),
		ne(entries.id, entryId),
		sql`not ${inSplit}`,
	);
}

/**
 * « Ouvrir la fusion »'s list: the booked lines a pending entry may be merged
 * into, the latest date then the latest created first, ten from `offset`, as
 * Sure's `PendingDuplicateMergesController#new`, with whether more follow.
 * None for an entry no longer pending. Throws `NOT_FOUND` for an unknown
 * transaction.
 */
export async function pendingMergeCandidates(
	deps: ServiceDeps,
	entryId: string,
	offset: number,
): Promise<{ candidates: DuplicateCandidate[]; hasMore: boolean }> {
	const source = await pendingSource(deps.db, entryId);

	if (!source.pending) {
		return { candidates: [], hasMore: false };
	}

	// One more than a page, as Sure's, to tell whether another follows.
	const rows = await candidateSelect(deps.db)
		.where(pendingMergeCondition(entryId, source))
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(PENDING_MERGE_PAGE_SIZE + 1)
		.offset(offset);

	return {
		candidates: rows.slice(0, PENDING_MERGE_PAGE_SIZE).map(asCandidate),
		hasMore: rows.length > PENDING_MERGE_PAGE_SIZE,
	};
}

/**
 * The booked line a sync suggests a pending entry repeats, as Sure's
 * `potential_duplicate_entry`: `null` once the entry is booked, the
 * suggestion dismissed, its line deleted, or split since, which the merge
 * refuses. Throws `NOT_FOUND` for an
 * unknown transaction.
 */
export async function postedMatchOf(
	deps: ServiceDeps,
	entryId: string,
): Promise<DuplicateCandidate | null> {
	const source = await pendingSource(deps.db, entryId);

	// Only a line the merge takes: one split since is no candidate (AD-20).
	const rows = await candidateSelect(deps.db).where(
		and(
			eq(
				entries.id,
				deps.db
					.select({ id: transactions.postedMatchId })
					.from(transactions)
					.where(
						and(
							eq(transactions.entryId, entryId),
							eq(transactions.pending, true),
							eq(transactions.postedMatchDismissed, false),
						),
					),
			),
			pendingMergeCondition(entryId, source),
		),
	);

	return rows.map(asCandidate).at(0) ?? null;
}

/**
 * Merges the pending entry `entryId` into the booked line `intoId`, as Sure's
 * `merge_with_duplicate!`: `absorbEntry` moves what points at it and deletes
 * it. The survivor keeps its label and merchant, the bank's booked ones; unless
 * it is excluded, as Sure's `protected_from_sync?`, it takes the pending
 * category with its origin and the pending date, the moment of the purchase,
 * each unless locked. The pending notes join its own after a blank line, a fix
 * over Sure's loss (we-promise/sure#4220). Its date and amount are locked as a
 * user's write, as Sure's `mark_user_modified!`. Balances recompute from the
 * earliest date touched. Throws `NOT_FOUND` for an unknown `entryId`,
 * `TRANSACTION_SPLIT` when either side is in a split (AD-20),
 * `DUPLICATE_RESOLVED` when it is no longer pending, as Sure's
 * `pending_only`, and `VALIDATION_ERROR` on `into` when `intoId` is none of
 * its candidates.
 */
export async function mergePending(
	deps: ServiceDeps,
	entryId: string,
	intoId: string,
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const source = await pendingSource(tx, entryId);

			await refuseSplit(tx, [entryId, intoId]);

			if (!source.pending) {
				throw new AppError("DUPLICATE_RESOLVED", "This transaction is no longer pending.");
			}

			const eligible = await tx
				.select({ id: entries.id })
				.from(entries)
				.innerJoin(transactions, eq(transactions.entryId, entries.id))
				.where(and(eq(entries.id, intoId), pendingMergeCondition(entryId, source)))
				.get();

			if (eligible === undefined) {
				throw invalidField("into", "not_a_candidate");
			}

			const survivor = await transactionRow(tx, intoId);
			const account = await accountWithOpeningDate(tx, source.accountId);
			const absorbedOn = await absorbEntry(tx, intoId, entryId);
			const now = Date.now();
			const locked = new Set(Object.keys(survivor.lockedFields));
			const date = !survivor.excluded && !locked.has("date") ? source.date : survivor.date;
			const category =
				!survivor.excluded && source.categoryId !== null && !locked.has("category")
					? { categoryId: source.categoryId, categoryOrigin: source.categoryOrigin }
					: {};
			const notes = joinedNotes(survivor.notes, source.notes);

			await tx.update(entries).set({ date, updatedAt: now }).where(eq(entries.id, intoId));
			await tx
				.update(transactions)
				.set({
					...category,
					...(notes === survivor.notes ? {} : { notes }),
					lockedFields: stampedLocks(["date", "amount"], now),
				})
				.where(eq(transactions.entryId, intoId));
			await recomputeBalances(
				tx,
				account,
				minDate(absorbedOn, minDate(survivor.date, date)),
				deps.timeZone,
			);
		},
		{ behavior: "immediate" },
	);
}

/**
 * The survivor's notes once the pending ones join them: after a blank line
 * when both differ, cut to `NOTES_MAX_LENGTH`, alone when the survivor has none.
 */
function joinedNotes(own: string | null, absorbed: string | null): string | null {
	if (absorbed === null || absorbed === own) {
		return own;
	}

	if (own === null) {
		return absorbed;
	}

	// Within the sheet's limit, the survivor's text first, or every later save
	// of its notes would fail; by code points, never cutting an emoji in half,
	// counted in UTF-16 units as the schema's `max` counts.
	let length = 0;

	return Array.from(`${own}\n\n${absorbed}`)
		.filter((character) => (length += character.length) <= NOTES_MAX_LENGTH)
		.join("");
}

/**
 * « Non, gardez les deux »: the suggestion never shows again on this entry,
 * and no later sync stores another, as Sure's `dismiss_duplicate_suggestion!`.
 * Idempotent. Throws `NOT_FOUND` for an unknown transaction.
 */
export async function dismissPostedMatch(deps: ServiceDeps, entryId: string): Promise<void> {
	await pendingSource(deps.db, entryId);
	// Without a suggestion, nothing, as Sure's `return false unless
	// potential_posted_match_data.present?`: a later one may still come.
	await deps.db
		.update(transactions)
		.set({ postedMatchDismissed: true })
		.where(and(eq(transactions.entryId, entryId), isNotNull(transactions.postedMatchId)));
}
