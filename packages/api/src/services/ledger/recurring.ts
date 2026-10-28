import type { IsoDate } from "../../domain/dates.ts";
import type { MatchEntry } from "../../domain/recurring/matcher.ts";
import type { Transaction } from "./shared.ts";

import {
	and,
	between,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	notInArray,
	or,
	sql,
} from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { merchants } from "@archant/data/schema/merchants";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { contains } from "./filter.ts";
import {
	KEYS_PER_LOOKUP,
	asInflow,
	asOutflow,
	counterpartAccount,
	counterpartEntry,
	inSequence,
	isSplitParent,
	notSplitParent,
	transferColumns,
} from "./shared.ts";

type Reader = Pick<Transaction, "select">;

/**
 * The transactions dated within `window`, as the recurring matcher reads
 * them: split parents and transfer sides marked rather than left out, so the
 * matcher's own identity filter decides, as it does for one it explains. A
 * transfer's outflow carries the account it pays into, which a recurring
 * transfer reads, as Sure's `preload_transfer_destinations`.
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
			intoAccountId: counterpartEntry.accountId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, asOutflow.inflowTransactionId))
		.where(and(eq(entries.kind, "transaction"), between(entries.date, window.start, window.end)))
		.orderBy(entries.date, entries.createdAt, entries.id);

	return rows.map(({ transferKind, intoAccountId, splitParent, ...row }) => ({
		...row,
		amount: toMinorUnits(row.amount),
		splitParent: Boolean(splitParent),
		transfer: transferKind === null ? null : { kind: transferKind, intoAccountId },
	}));
}

/** A transaction « Ajouter une facture » may start from, as its picker lists it. */
export type PickerTransaction = {
	entryId: string;
	label: string;
	merchantName: string | null;
	date: IsoDate;
	accountId: string;
	accountName: string;
	amount: MinorUnits;
	currency: string;
};

/**
 * Sure's `picker_entries`: transactions of any account, outflows or inflows
 * as `sign` says, never excluded, a split parent or a transfer side, whose
 * label, notes or merchant's name contains `q` when given, newest first,
 * `limit` at most.
 */
export async function pickerTransactions(
	db: Reader,
	{ sign, q, limit }: { sign: "outflow" | "inflow"; q: string; limit: number },
): Promise<PickerTransaction[]> {
	const rows = await db
		.select({
			entryId: entries.id,
			label: transactions.label,
			merchantName: merchants.name,
			date: entries.date,
			accountId: entries.accountId,
			accountName: accounts.name,
			amount: entries.amount,
			currency: entries.currency,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.leftJoin(merchants, eq(merchants.id, transactions.merchantId))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(
			and(
				eq(entries.kind, "transaction"),
				sign === "outflow" ? lt(entries.amount, 0) : gt(entries.amount, 0),
				eq(transactions.excluded, false),
				notSplitParent,
				isNull(asOutflow.id),
				isNull(asInflow.id),
				q === ""
					? undefined
					: or(
							contains(transactions.label, q),
							contains(transactions.notes, q),
							contains(merchants.name, q),
						),
			),
		)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(limit);

	return rows.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));
}

/** A transaction « Rechercher dans toutes les transactions » lists. */
export type OccurrenceTransaction = {
	entryId: string;
	label: string;
	date: IsoDate;
	accountName: string;
	/** Signed as the transaction (AD-5). */
	amount: MinorUnits;
	currency: string;
};

/**
 * Sure's `candidate_entries` over its `candidate_scope`: transactions of
 * `accountId`, else of every account, in `currency` and of `sign`, never a
 * split parent nor one of `held`, a transfer side only for a recurring
 * transfer; within `window`, or, with `q`, whose label contains it whatever
 * its date. Nearest `target` in magnitude first, then nearest `dueOn`, then
 * newest, `limit` at most.
 */
export async function occurrenceTransactions(
	db: Reader,
	scope: {
		accountId: string | null;
		currency: string;
		sign: "outflow" | "inflow";
		transfers: boolean;
		held: readonly string[];
		window: { start: IsoDate; end: IsoDate };
		q: string;
		target: MinorUnits;
		dueOn: IsoDate;
		limit: number;
	},
): Promise<OccurrenceTransaction[]> {
	const rows = await db
		.select({
			entryId: entries.id,
			label: transactions.label,
			date: entries.date,
			accountName: accounts.name,
			amount: entries.amount,
			currency: entries.currency,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(
			and(
				eq(entries.kind, "transaction"),
				scope.accountId === null ? undefined : eq(entries.accountId, scope.accountId),
				eq(entries.currency, scope.currency),
				scope.sign === "outflow" ? lt(entries.amount, 0) : gt(entries.amount, 0),
				notSplitParent,
				scope.held.length === 0 ? undefined : notInArray(entries.id, [...scope.held]),
				scope.transfers ? undefined : and(isNull(asOutflow.id), isNull(asInflow.id)),
				// A search looks past the window: the payment hunted for is usually one it left out.
				scope.q === ""
					? between(entries.date, scope.window.start, scope.window.end)
					: contains(transactions.label, scope.q),
			),
		)
		.orderBy(
			sql`abs(abs(${entries.amount}) - ${scope.target})`,
			sql`abs(julianday(${entries.date}) - julianday(${scope.dueOn}))`,
			desc(entries.date),
			entries.id,
		)
		.limit(scope.limit);

	return rows.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));
}

/**
 * The account each transfer outflow dated from `from` pays into, by the
 * outflow's id: what detection's passes read of a recurring transfer.
 */
export async function transferDestinations(
	db: Reader,
	from: IsoDate,
): Promise<Map<string, string>> {
	const rows = await db
		.select({ id: transfers.outflowTransactionId, intoAccountId: counterpartEntry.accountId })
		.from(transfers)
		.innerJoin(entries, eq(entries.id, transfers.outflowTransactionId))
		.innerJoin(counterpartEntry, eq(counterpartEntry.id, transfers.inflowTransactionId))
		.where(gte(entries.date, from));

	return new Map(rows.map((row) => [row.id, row.intoAccountId]));
}

/** A transfer as « Marquer comme récurrent » reads it: its outflow, and the account it pays into. */
export type TransferPair = {
	outflow: {
		accountId: string;
		amount: MinorUnits;
		currency: string;
		date: IsoDate;
		label: string;
	};
	destination: { id: string; name: string; type: AccountType };
};

/** The transfer `transferId` names, `null` for none. */
export async function transferPair(db: Reader, transferId: string): Promise<TransferPair | null> {
	const row = await db
		.select({
			accountId: entries.accountId,
			amount: entries.amount,
			currency: entries.currency,
			date: entries.date,
			label: transactions.label,
			destinationId: counterpartAccount.id,
			destinationName: counterpartAccount.name,
			destinationType: counterpartAccount.type,
		})
		.from(transfers)
		.innerJoin(entries, eq(entries.id, transfers.outflowTransactionId))
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(counterpartEntry, eq(counterpartEntry.id, transfers.inflowTransactionId))
		.innerJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId))
		.where(eq(transfers.id, transferId))
		.get();

	if (row === undefined) {
		return null;
	}

	return {
		outflow: {
			accountId: row.accountId,
			amount: toMinorUnits(row.amount),
			currency: row.currency,
			date: row.date,
			label: row.label,
		},
		destination: { id: row.destinationId, name: row.destinationName, type: row.destinationType },
	};
}

/** A transaction the owner attaches to an occurrence; `null` for no transaction of this id. */
export async function paymentTransaction(
	db: Reader,
	entryId: string,
): Promise<{
	id: string;
	accountId: string;
	amount: MinorUnits;
	date: IsoDate;
	currency: string;
	label: string;
	splitParent: boolean;
	transfer: MatchEntry["transfer"];
} | null> {
	const row = await db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			amount: entries.amount,
			date: entries.date,
			currency: entries.currency,
			label: transactions.label,
			splitParent: sql<number>`${isSplitParent(entries.id)}`,
			transferKind: transferColumns.transferKind,
			intoAccountId: counterpartEntry.accountId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, asOutflow.inflowTransactionId))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		return null;
	}

	const { transferKind, intoAccountId, ...rest } = row;

	return {
		...rest,
		amount: toMinorUnits(row.amount),
		splitParent: Boolean(row.splitParent),
		transfer: transferKind === null ? null : { kind: transferKind, intoAccountId },
	};
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
export type PaymentEntry = { label: string; amount: MinorUnits; date: IsoDate; accountId: string };

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
				accountId: entries.accountId,
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
