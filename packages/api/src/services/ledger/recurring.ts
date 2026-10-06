import type { IsoDate } from "../../domain/dates.ts";
import type { MatchEntry } from "../../domain/recurring/matcher.ts";
import type { Transaction } from "./shared.ts";

import { and, between, eq, inArray, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import {
	KEYS_PER_LOOKUP,
	asInflow,
	asOutflow,
	inSequence,
	isSplitParent,
	transferColumns,
} from "./shared.ts";

type Reader = Pick<Transaction, "select">;

/**
 * The transactions dated within `window`, as the recurring matcher reads
 * them: split parents and transfer sides marked rather than left out, so the
 * matcher's own identity filter decides, as it does for one it explains.
 */
export async function matchableTransactions(
	db: Reader,
	window: { start: IsoDate; end: IsoDate },
): Promise<MatchEntry[]> {
	const rows = await db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			currency: entries.currency,
			date: entries.date,
			amount: entries.amount,
			merchantId: transactions.merchantId,
			label: transactions.label,
			pending: transactions.pending,
			excluded: transactions.excluded,
			splitParent: sql<number>`${isSplitParent(entries.id)}`,
			transferKind: transferColumns.transferKind,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(and(eq(entries.kind, "transaction"), between(entries.date, window.start, window.end)))
		.orderBy(entries.date, entries.createdAt, entries.id);

	return rows.map(({ transferKind, splitParent, ...row }) => ({
		...row,
		amount: toMinorUnits(row.amount),
		splitParent: Boolean(splitParent),
		transfer: transferKind === null ? null : { kind: transferKind },
	}));
}

/** A transaction the owner attaches to an occurrence; `null` for no transaction of this id. */
export async function paymentTransaction(
	db: Reader,
	entryId: string,
): Promise<{
	id: string;
	amount: MinorUnits;
	date: IsoDate;
	currency: string;
	label: string;
	splitParent: boolean;
} | null> {
	const row = await db
		.select({
			id: entries.id,
			amount: entries.amount,
			date: entries.date,
			currency: entries.currency,
			label: transactions.label,
			splitParent: sql<number>`${isSplitParent(entries.id)}`,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	return row === undefined
		? null
		: { ...row, amount: toMinorUnits(row.amount), splitParent: Boolean(row.splitParent) };
}

/**
 * Whether the household holds any transaction, as Sure's
 * `has_transaction_history`: without one, detection could find nothing, so
 * the bills page offers only to declare a bill.
 */
export async function hasTransactions(db: Reader): Promise<boolean> {
	const row = await db
		.select({ id: entries.id })
		.from(entries)
		.where(eq(entries.kind, "transaction"))
		.limit(1)
		.get();

	return row !== undefined;
}

/** What the bills page shows of a payment's transaction. */
export type PaymentEntry = { label: string; amount: MinorUnits; date: IsoDate };

/** The transactions of `ids` the bills page names its payments by, by id. */
export async function paymentEntries(
	db: Reader,
	ids: readonly string[],
): Promise<Map<string, PaymentEntry>> {
	const found = new Map<string, PaymentEntry>();

	await inSequence([...new Set(ids)], KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await db
			.select({
				id: entries.id,
				label: transactions.label,
				amount: entries.amount,
				date: entries.date,
			})
			.from(entries)
			.innerJoin(transactions, eq(transactions.entryId, entries.id))
			.where(inArray(entries.id, chunk));

		for (const { id, ...row } of rows) {
			found.set(id, { ...row, amount: toMinorUnits(row.amount) });
		}
	});

	return found;
}
