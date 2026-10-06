import type { IsoDate } from "../../domain/dates.ts";
import type { MatchEntry } from "../../domain/recurring/matcher.ts";
import type { Transaction } from "./shared.ts";

import { and, between, eq, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import { asInflow, asOutflow, isSplitParent, transferColumns } from "./shared.ts";

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
