import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "./shared.ts";

import { and, between, eq, inArray, ne, notExists, or } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { addDays, daysBetween } from "../../domain/dates.ts";
import { MATCH_WINDOW_DAYS } from "../../domain/keys.ts";
import { AppError } from "../../lib/errors.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { transactionRow } from "./patch.ts";
import { deleteTransactionRows, invalidField, oneByOne, rejectedOf, transferOf } from "./shared.ts";

/**
 * `absorb` with an entry as its source (AD-17): a possible duplicate merged
 * by hand into the transaction it repeats. The survivor keeps every column
 * of its own, as an automatic pairing leaves a matched entry; only what
 * points at the absorbed one moves. Its keys move as they are, import and
 * connection included, so a later sync or re-import of its line finds the
 * survivor, and reverting that import or disconnecting treats it as a
 * matched entry. Its tags join the survivor's, past the input limit if need
 * be. Its transfer moves only onto a survivor in none; otherwise it goes,
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

	if (absorbed.tagIds.length > 0) {
		await tx
			.insert(taggings)
			.values(absorbed.tagIds.map((tagId) => ({ transactionId: survivorId, tagId })))
			.onConflictDoNothing();
	}

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
 * either side, not itself, and carrying no key from a source that keyed it:
 * the entries its import or sync would have paired it with, had there been
 * one. Nearest date first, then the older entry. A transaction no longer
 * flagged has none. Throws `NOT_FOUND` for an unknown transaction.
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
 * `entryId`, `DUPLICATE_RESOLVED` when it is no longer flagged, and
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
