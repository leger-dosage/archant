import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import { and, count, eq, inArray, isNull, lt, lte, ne, notExists, or } from "drizzle-orm";

import { classificationOf } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { Entry } from "@archant/data/types";

import { addDays, maxDate } from "../../domain/dates.ts";
import { AppError } from "../../lib/errors.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { ROWS_PER_INSERT, inSequence, rejectedOf, transferOf } from "./shared.ts";

/** What reverting an import deletes now: its created transactions, and its snapshot (0 or 1). */
export type Removable = { transactions: number; snapshot: number };

/**
 * An entry no key holds but those of `owner`, the import that created it: a
 * key from another import, or from no import at all (a bank connection, Epic
 * 10), keeps the entry. A later import of the same source never keys an entry
 * this one created, since an exact key match writes nothing and matching skips
 * entries the source keyed already; so any other key is another source's (AD-7).
 */
function unclaimedBeyond(
	db: Pick<Transaction, "select">,
	owner: string | typeof entries.importId,
): SQL {
	return notExists(
		db
			.select({ key: entryKeys.key })
			.from(entryKeys)
			.where(
				and(
					eq(entryKeys.entryId, entries.id),
					or(isNull(entryKeys.importId), ne(entryKeys.importId, owner)),
				),
			),
	);
}

/**
 * What reverting each of `importIds` would delete now, for the history list.
 * Two grouped queries whatever the number of imports.
 */
export async function removableOf(
	deps: ServiceDeps,
	importIds: readonly string[],
): Promise<Map<string, Removable>> {
	if (importIds.length === 0) {
		return new Map();
	}

	const created = await deps.db
		.select({ importId: entries.importId, count: count() })
		.from(entries)
		.where(
			and(
				inArray(entries.importId, [...importIds]),
				eq(entries.kind, "transaction"),
				unclaimedBeyond(deps.db, entries.importId),
			),
		)
		.groupBy(entries.importId);
	const snapshots = await deps.db
		.select({ importId: entries.importId, count: count() })
		.from(entries)
		.where(
			and(inArray(entries.importId, [...importIds]), eq(entries.valuationKind, "reconciliation")),
		)
		.groupBy(entries.importId);
	const createdBy = new Map(created.map((row) => [row.importId, row.count]));
	const snapshotBy = new Map(snapshots.map((row) => [row.importId, row.count]));

	return new Map(
		importIds.map((id) => [
			id,
			{ transactions: createdBy.get(id) ?? 0, snapshot: snapshotBy.get(id) ?? 0 },
		]),
	);
}

/**
 * Puts back the opening anchor an import moved, and returns its date.
 * `ingest` shifted its amount by the lines dated on or before
 * `previousDate` so that day kept its balance; the deleted ones give their
 * share back, the kept ones and a later import's keep theirs. Its date moves
 * back to `previousDate`, or the day before the earliest entry still dated on
 * or before it, whatever its kind, and never earlier than it stands now: it
 * crosses only empty days, so every balance from the restored date on stays.
 */
async function restoreOpening(
	tx: Transaction,
	account: Awaited<ReturnType<typeof accountWithOpeningDate>>,
	previousDate: IsoDate,
	deleted: Pick<Entry, "date" | "amount">[],
	now: number,
): Promise<IsoDate> {
	const [kept] = await tx
		.select({ date: entries.date })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				ne(entries.id, account.openingId),
				lte(entries.date, previousDate),
			),
		)
		.orderBy(entries.date)
		.limit(1);
	const date = maxDate(
		kept === undefined ? previousDate : addDays(kept.date, -1),
		account.openingDate,
	);
	const shift = deleted
		.filter((entry) => entry.date <= previousDate)
		.reduce((total, entry) => total + entry.amount, 0);

	await tx
		.update(entries)
		.set({
			date,
			amount: toMinorUnits(
				classificationOf(account.type) === "asset"
					? account.openingBalance + shift
					: account.openingBalance - shift,
			),
			updatedAt: now,
		})
		.where(eq(entries.id, account.openingId));
	// A forward recompute rewrites only from the day it is given, and would
	// leave the rows before the restored opening date.
	await tx.delete(balances).where(and(eq(balances.accountId, account.id), lt(balances.date, date)));

	return date;
}

export type RevertResult = { accountId: string; removed: Removable };

/**
 * Undoes a confirmed import, in one transaction (AD-7): deletes the keys it
 * wrote, the transactions it created that no other source holds, edited ones
 * included as Sure deletes every entry of an import, and the snapshot it still
 * owns. When the import moved the opening anchor, its amount gets back what
 * the deleted lines had shifted it by, and its date moves back toward where
 * it stood, across days no remaining entry holds. Sure keeps the moved date,
 * but it accepts lines before the opening date: Archant refuses them, so a
 * kept date would read the same file differently next time. Then marks the
 * import `reverted` and recomputes. The `imports` row stays, for the history.
 */
export async function revertImport(
	deps: ServiceDeps,
	importId: string,
	_options: { origin: Origin },
): Promise<RevertResult> {
	return deps.db.transaction(
		async (tx): Promise<RevertResult> => {
			const row = await tx
				.select({
					accountId: imports.accountId,
					status: imports.status,
					previousOpeningDate: imports.previousOpeningDate,
				})
				.from(imports)
				.where(eq(imports.id, importId))
				.get();

			if (row === undefined) {
				throw new AppError("NOT_FOUND", "No import has this id.");
			}

			// A preview wrote nothing and is purged; a reverted import has nothing
			// left to undo, and a revert is never undone.
			if (row.status !== "confirmed") {
				throw new AppError("IMPORT_NOT_REVERTABLE", "Only a confirmed import can be reverted.");
			}

			const account = await accountWithOpeningDate(tx, row.accountId);
			const now = Date.now();

			// 1. Every key it wrote, on the entries it created and matched alike.
			await tx.delete(entryKeys).where(eq(entryKeys.importId, importId));

			// 2. What it created and nothing else holds; the detail rows first,
			// since their foreign key restricts deleting the entry.
			const created = await tx
				.select({ id: entries.id, date: entries.date, amount: entries.amount })
				.from(entries)
				.where(
					and(
						eq(entries.importId, importId),
						eq(entries.kind, "transaction"),
						unclaimedBeyond(tx, importId),
					),
				);
			const ids = created.map((entry) => entry.id);

			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(taggings).where(inArray(taggings.transactionId, chunk)),
			);
			// The other side, maybe on another account, becomes a standard transaction.
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(transfers).where(transferOf(chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(rejectedTransfers).where(rejectedOf(chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(transactions).where(inArray(transactions.entryId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(entries).where(inArray(entries.id, chunk)),
			);
			// Another source confirmed these: they stay, and are no longer this
			// import's to delete.
			await tx
				.update(entries)
				.set({ importId: null })
				.where(and(eq(entries.importId, importId), eq(entries.kind, "transaction")));

			// 3. Its snapshot, if it still owns one: an edit hands it to the user,
			// and a newer file's value on that date hands it to the newer import.
			const snapshots = await tx
				.delete(entries)
				.where(and(eq(entries.importId, importId), eq(entries.valuationKind, "reconciliation")))
				.returning({ date: entries.date });

			// 4. The opening anchor, when this import moved it.
			const previousDate = row.previousOpeningDate;
			const openingDate =
				previousDate === null
					? account.openingDate
					: await restoreOpening(tx, account, previousDate, created, now);

			// 5.
			await tx
				.update(imports)
				.set({ status: "reverted", revertedAt: now })
				.where(eq(imports.id, importId));

			// 6. From the earliest date touched, the anchor's when it moved, and
			// never before the opening date: no balance exists before it.
			const [earliest] = [
				...[...created, ...snapshots].map((entry) => entry.date),
				...(previousDate === null ? [] : [openingDate]),
			].toSorted();

			if (earliest !== undefined) {
				await recomputeBalances(tx, account, maxDate(earliest, openingDate), deps.timeZone);
			}

			return {
				accountId: account.id,
				removed: { transactions: created.length, snapshot: snapshots.length },
			};
		},
		{ behavior: "immediate" },
	);
}
