import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { QueryBuilder, alias } from "drizzle-orm/sqlite-core";

import type { MinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";

import { AppError } from "../../lib/errors.ts";
import { MAX_SPLIT_LINES } from "../../schemas/transactions.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { categoryExists, categoryOriginOf } from "./patch.ts";
import {
	deleteTransactionRows,
	inAnyTransfer,
	invalidField,
	isSplitParent,
	lockedBy,
	oneByOne,
} from "./shared.ts";
import { matchTransfers } from "./transfers.ts";

const convertedTrade = alias(entries, "converted_trade");

/** The ids of every transaction converted into a trade, its only child (AD-22). */
const convertedIds = new QueryBuilder()
	.select({ id: convertedTrade.parentEntryId })
	.from(convertedTrade)
	.where(and(isNotNull(convertedTrade.parentEntryId), eq(convertedTrade.kind, "trade")));

/** One line of a split, as Sure's `split_params`: a name, an amount and a category. */
export type SplitLine = {
	label: string;
	amount: MinorUnits;
	/** `null` leaves the line « Sans catégorie ». */
	categoryId: string | null;
};

/** A split: its parent and its children, oldest first. */
export type Split = { parentId: string; childIds: string[] };

/**
 * What a split, or a conversion into a trade, reads of the transaction it
 * starts from. `isParent` holds for a converted transaction too, whose only
 * child is its trade; `converted` tells it apart.
 */
export async function splitRow(db: Pick<Transaction, "select">, id: string) {
	const row = await db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			parentEntryId: entries.parentEntryId,
			isParent: isSplitParent(entries.id).mapWith(Boolean),
			converted: inArray(entries.id, convertedIds).mapWith(Boolean),
			inTransfer: inAnyTransfer.mapWith(Boolean),
			pending: transactions.pending,
			excluded: transactions.excluded,
			oneTime: transactions.oneTime,
			possibleDuplicate: transactions.possibleDuplicate,
			merchantId: transactions.merchantId,
			lockedFields: transactions.lockedFields,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, id))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return row;
}

type SplitRow = Awaited<ReturnType<typeof splitRow>>;

/**
 * The parent of the split `id` belongs to, from the parent or a child, as
 * Sure's `resolve_to_parent!`. Throws `NOT_FOUND` for an unknown or an
 * unsplit transaction, a converted one included: its child is a trade.
 */
async function parentOf(db: Pick<Transaction, "select">, id: string): Promise<SplitRow> {
	const row = await splitRow(db, id);

	if (row.parentEntryId !== null) {
		return splitRow(db, row.parentEntryId);
	}

	if (!row.isParent || row.converted) {
		throw new AppError("NOT_FOUND", "This transaction is not split.");
	}

	return row;
}

/** The ids of `parentId`'s children, in the order they were created. */
async function childIdsOf(db: Pick<Transaction, "select">, parentId: string): Promise<string[]> {
	const rows = await db
		.select({ id: entries.id })
		.from(entries)
		.where(eq(entries.parentEntryId, parentId))
		.orderBy(asc(entries.createdAt), asc(entries.id));

	return rows.map((row) => row.id);
}

/**
 * Refuses `lines` for `parent`, before any write: 1 to `MAX_SPLIT_LINES`
 * lines summing exactly to the parent's amount, each category known. Zero
 * and mixed signs pass, as Sure.
 */
async function checkLines(
	tx: Transaction,
	parent: SplitRow,
	lines: readonly SplitLine[],
): Promise<void> {
	if (lines.length === 0) {
		throw invalidField("lines", "too_small");
	}

	if (lines.length > MAX_SPLIT_LINES) {
		throw invalidField("lines", "too_big");
	}

	if (lines.reduce((total, line) => total + line.amount, 0) !== parent.amount) {
		throw invalidField("lines", "split_sum_mismatch");
	}

	await oneByOne([...lines.entries()], async ([index, line]) => {
		if (line.categoryId !== null && !(await categoryExists(tx, line.categoryId))) {
			throw invalidField(`lines.${index}.categoryId`);
		}
	});
}

/**
 * Inserts `lines` as children of `parent`: its account, date, currency and
 * merchant, never pending, excluded, flagged, imported or keyed, so no
 * import, sync or revert ever takes one for a bank line (AD-20). A user's
 * line locks what a manual entry locks: its date, amount and label, and its
 * category when set; and its exclusion, which only the split
 * changes, so a rule never excludes a line the user could not include again.
 * One millisecond apart, so they keep the order they came in, as Sure orders
 * them by creation.
 */
async function insertChildren(
	tx: Transaction,
	parent: SplitRow,
	lines: readonly SplitLine[],
	origin: Origin,
	now: number,
): Promise<void> {
	await oneByOne([...lines.entries()], async ([index, line]) => {
		const id = crypto.randomUUID();
		const filled: LockableField[] = [
			"date",
			"amount",
			"label",
			"excluded",
			...(line.categoryId === null ? [] : ["category" as const]),
		];

		await tx.insert(entries).values({
			id,
			accountId: parent.accountId,
			kind: "transaction",
			date: parent.date,
			amount: line.amount,
			currency: parent.currency,
			parentEntryId: parent.id,
			createdAt: now + index,
			updatedAt: now + index,
		});
		await tx.insert(transactions).values({
			entryId: id,
			label: line.label,
			// Sure's `Entry#split!` gives each child the parent's kind, `one_time` included.
			oneTime: parent.oneTime,
			merchantId: parent.merchantId,
			categoryId: line.categoryId,
			categoryOrigin: line.categoryId === null ? null : categoryOriginOf(origin),
			lockedFields: lockedBy(origin, {}, filled, now),
		});
	});
}

/** Recomputes the parent's account from its date, as every ledger write does (AD-2). */
async function recompute(deps: ServiceDeps, tx: Transaction, parent: SplitRow): Promise<void> {
	const account = await accountWithOpeningDate(tx, parent.accountId);

	await recomputeBalances(tx, account, parent.date, deps.timeZone);
}

/**
 * The split `id` belongs to, from its parent or one of its children. Throws
 * `NOT_FOUND` for an unknown or an unsplit transaction.
 */
export async function splitOf(deps: ServiceDeps, id: string): Promise<Split> {
	const parent = await parentOf(deps.db, id);

	return { parentId: parent.id, childIds: await childIdsOf(deps.db, parent.id) };
}

/**
 * Splits the transaction `id` into `lines`, as Sure's `Entry#split!` (AD-20):
 * the parent keeps its figures and its keys, is excluded, and a user's split
 * locks that exclusion; each line becomes a child. Throws `NOT_FOUND` for an
 * unknown transaction, `NOT_SPLITTABLE` for a transfer side, a pending,
 * excluded or possibly duplicated transaction, or a split's parent or child,
 * and `VALIDATION_ERROR` on `lines` as `checkLines` says. Balances are
 * recomputed from the parent's date, and do not move; the matcher then
 * weighs the lines, as Sure's `sync_account_later` runs
 * `auto_match_transfers!`.
 */
export async function splitTransaction(
	deps: ServiceDeps,
	id: string,
	lines: readonly SplitLine[],
	options: { origin: Origin },
): Promise<Split> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await splitRow(tx, id);

			if (
				parent.inTransfer ||
				parent.pending ||
				parent.excluded ||
				parent.possibleDuplicate ||
				parent.parentEntryId !== null ||
				parent.isParent
			) {
				throw new AppError("NOT_SPLITTABLE", "This transaction cannot be split.");
			}

			await checkLines(tx, parent, lines);
			const now = Date.now();

			await insertChildren(tx, parent, lines, options.origin, now);
			await tx
				.update(transactions)
				.set({
					excluded: true,
					lockedFields: lockedBy(options.origin, parent.lockedFields, ["excluded"], now),
				})
				.where(eq(transactions.entryId, parent.id));
			await recompute(deps, tx, parent);
			await matchTransfers(tx, now);

			return { parentId: parent.id, childIds: await childIdsOf(tx, parent.id) };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Replaces the lines of the split `id` belongs to, from its parent or a
 * child, as Sure's `splits_controller.rb#update` runs `unsplit!` then
 * `split!` in one transaction (AD-20): every child is deleted, its tags,
 * notes, attachments, locks and transfer with it, and `lines` become new
 * children, as `splitTransaction` makes them. The parent stays excluded and
 * locked, as it is. Throws `NOT_FOUND` for an unknown or an unsplit
 * transaction, and `VALIDATION_ERROR` on `lines` as `checkLines` says,
 * before any write. The matcher then weighs the new lines, as after a split.
 */
export async function editSplit(
	deps: ServiceDeps,
	id: string,
	lines: readonly SplitLine[],
	options: { origin: Origin },
): Promise<Split> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await parentOf(tx, id);
			const now = Date.now();

			await checkLines(tx, parent, lines);
			await deleteTransactionRows(tx, await childIdsOf(tx, parent.id));
			await insertChildren(tx, parent, lines, options.origin, now);
			await recompute(deps, tx, parent);
			await matchTransfers(tx, now);

			return { parentId: parent.id, childIds: await childIdsOf(tx, parent.id) };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes the children of the split `id` belongs to, from its parent or a
 * child, and counts the parent again, as Sure's `unsplit!`. Its `excluded`
 * stays locked, now `false`: the user set it. A line's transfer goes with
 * it, the other side standard again, and the matcher weighs the parent.
 * Throws `NOT_FOUND` for an unknown or an unsplit transaction. Returns the
 * parent's id.
 */
export async function unsplitTransaction(
	deps: ServiceDeps,
	id: string,
	options: { origin: Origin },
): Promise<string> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await parentOf(tx, id);
			const now = Date.now();

			await deleteTransactionRows(tx, await childIdsOf(tx, parent.id));
			await tx
				.update(transactions)
				.set({
					excluded: false,
					lockedFields: lockedBy(options.origin, parent.lockedFields, ["excluded"], now),
				})
				.where(eq(transactions.entryId, parent.id));
			await recompute(deps, tx, parent);
			await matchTransfers(tx, now);

			return parent.id;
		},
		{ behavior: "immediate" },
	);
}
