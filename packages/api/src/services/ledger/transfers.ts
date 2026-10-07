import type { IsoDate } from "../../domain/dates.ts";
import type { TransferSide } from "../../domain/transfer-matching.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { and, between, eq, inArray, isNotNull, isNull, ne, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { Transfer } from "@archant/data/types";

import { daysBetween } from "../../domain/dates.ts";
import {
	TRANSFER_WINDOW_DAYS,
	isTransferCandidate,
	mutualMatches,
	narrowToExpected,
	transferKindOf,
} from "../../domain/transfer-matching.ts";
import { AppError } from "../../lib/errors.ts";
import {
	KEYS_PER_LOOKUP,
	ROWS_PER_INSERT,
	inAnyTransfer,
	inSequence,
	inTransferSql,
	invalidField,
	isSplitChild,
} from "./shared.ts";

/** A transaction that can be the other side of a transfer, as the picker lists it. */
export type TransferCandidate = {
	id: string;
	date: IsoDate;
	label: string;
	amount: MinorUnits;
	currency: string;
	accountId: string;
	accountName: string;
};

/** Whether the user refused `a` and `b` as one transfer, whichever side each was. */
function isRejectedPair(a: SQLWrapper, b: SQLWrapper): SQL {
	return sql`exists (select 1 from ${rejectedTransfers} where (${rejectedTransfers.outflowTransactionId} = ${a} and ${rejectedTransfers.inflowTransactionId} = ${b}) or (${rejectedTransfers.outflowTransactionId} = ${b} and ${rejectedTransfers.inflowTransactionId} = ${a}))`;
}

/** The columns of an `entries` row, or of an alias of it, the prefilter reads. */
type SideRef = Record<"id" | "kind" | "accountId" | "date" | "amount" | "currency", SQLiteColumn>;

// SQLite date modifiers, so the window can follow a column as well as a value.
const WINDOW_BEFORE = `-${TRANSFER_WINDOW_DAYS} days`;
const WINDOW_AFTER = `+${TRANSFER_WINDOW_DAYS} days`;

/**
 * The SQL prefilter of `isTransferCandidate`: `candidate` has the opposite,
 * non-zero amount of `source`, in another account of its currency, within
 * the window, neither is in a transfer, and the user never rejected the pair.
 * `candidatePairQuery` adds `matchableSide` on both sides, which reads the
 * transaction and account rows this condition does not join. One search
 * serves the picker, `matchTransfer`'s re-check, step 6 of `ingest`,
 * `applyRulePlanToHistory` and the list's suggestion, so none of them can
 * offer a pair another refuses.
 */
function candidateOf(source: SideRef, candidate: SideRef): SQL | undefined {
	return and(
		// `+` keeps SQLite from reading the sources through an index on `kind`.
		// Sampled by `analysis_limit`, `kind` looks as selective as a key, and at
		// 100,000 transactions the planner scanned every transaction for each
		// chunk of 500 sources instead of looking each up by its id: a
		// 24,000-line import took 17 s instead of 2.
		eq(sql`+${source.kind}`, "transaction"),
		eq(candidate.kind, "transaction"),
		ne(source.amount, 0),
		eq(candidate.amount, sql`-${source.amount}`),
		ne(candidate.accountId, source.accountId),
		eq(candidate.currency, source.currency),
		between(
			candidate.date,
			sql`date(${source.date}, ${WINDOW_BEFORE})`,
			sql`date(${source.date}, ${WINDOW_AFTER})`,
		),
		not(inTransferSql(source.id)),
		not(inTransferSql(candidate.id)),
		not(isRejectedPair(source.id, candidate.id)),
	);
}

/**
 * The SQL of `isTransferCandidate`'s `excluded`, `accountActive` and
 * `splitChild`: neither an excluded row, a row of a deactivated account nor a
 * split line is ever a side, as Sure's `Family::AutoTransferMatchable`; a
 * split parent is excluded (AD-20).
 */
function matchableSide(
	entry: Record<"parentEntryId", SQLiteColumn>,
	transaction: Record<"excluded", SQLiteColumn>,
	account: Record<"active", SQLiteColumn>,
): SQL | undefined {
	return and(
		isNull(entry.parentEntryId),
		eq(transaction.excluded, false),
		eq(account.active, true),
	);
}

const sideColumns = {
	id: entries.id,
	kind: entries.kind,
	accountId: entries.accountId,
	accountType: accounts.type,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	inTransfer: inAnyTransfer.mapWith(Boolean),
	excluded: transactions.excluded,
	accountActive: accounts.active,
	splitChild: isSplitChild.mapWith(Boolean),
};

/** One transaction as the matching rule reads it, `undefined` when the id names none. */
async function transferSide(db: Pick<Transaction, "select">, entryId: string) {
	const row = await db
		.select(sideColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(eq(entries.id, entryId))
		.get();

	return row === undefined ? undefined : { ...row, amount: toMinorUnits(row.amount) };
}

function asSide(row: Omit<TransferSide, "amount"> & { amount: number }): TransferSide {
	return { ...row, amount: toMinorUnits(row.amount) };
}

const sourceEntry = alias(entries, "source_entry");
const sourceAccount = alias(accounts, "source_account");
const sourceTransaction = alias(transactions, "source_transaction");

/** A side of a candidate pair, with what a transfer's direction and kind need. */
type PairSide = { id: string; amount: number; accountType: AccountType };

/** The candidates of `sourceIds`, one query; see `candidatePairs`. */
function candidatePairQuery(
	db: Pick<Transaction, "select">,
	sourceIds: readonly string[],
	counterpartId: string | undefined,
) {
	// Cross joins, conditions in `where`: SQLite keeps a cross join's tables in
	// the order written, so each source is looked up once by its id. As inner
	// joins, the planner looped over the few accounts first and looked every
	// source up once per account, ten times the work of an import.
	return db
		.select({
			source: {
				id: sourceEntry.id,
				kind: sourceEntry.kind,
				accountId: sourceEntry.accountId,
				accountType: sourceAccount.type,
				date: sourceEntry.date,
				amount: sourceEntry.amount,
				currency: sourceEntry.currency,
				inTransfer: inTransferSql(sourceEntry.id).mapWith(Boolean),
				excluded: sourceTransaction.excluded,
				accountActive: sourceAccount.active,
				splitChild: isNotNull(sourceEntry.parentEntryId).mapWith(Boolean),
				expectedAccountId: sourceTransaction.expectedTransferAccountId,
			},
			candidate: {
				...sideColumns,
				label: transactions.label,
				accountName: accounts.name,
				expectedAccountId: transactions.expectedTransferAccountId,
			},
		})
		.from(sourceEntry)
		.crossJoin(sourceAccount)
		.crossJoin(sourceTransaction)
		.crossJoin(entries)
		.crossJoin(transactions)
		.crossJoin(accounts)
		.where(
			and(
				inArray(sourceEntry.id, [...sourceIds]),
				eq(sourceAccount.id, sourceEntry.accountId),
				eq(sourceTransaction.entryId, sourceEntry.id),
				candidateOf(sourceEntry, entries),
				eq(transactions.entryId, entries.id),
				eq(accounts.id, entries.accountId),
				matchableSide(sourceEntry, sourceTransaction, sourceAccount),
				matchableSide(entries, transactions, accounts),
				counterpartId === undefined ? undefined : eq(entries.id, counterpartId),
			),
		)
		.orderBy(entries.date, entries.createdAt, entries.id);
}

type CandidatePair = Awaited<ReturnType<typeof candidatePairQuery>>[number];

/**
 * Every candidate of each of `sourceIds`, 500 sources per query, ordered by
 * date, then the older entry. SQL narrows them with `candidateOf` and
 * `matchableSide`; `isTransferCandidate` then has the last word.
 * `counterpartId` keeps that one candidate only.
 */
export async function candidatePairs(
	db: Pick<Transaction, "select">,
	sourceIds: readonly string[],
	counterpartId?: string,
): Promise<CandidatePair[]> {
	const found: CandidatePair[] = [];

	await inSequence(sourceIds, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await candidatePairQuery(db, chunk, counterpartId);

		found.push(
			...rows.filter(({ source, candidate }) =>
				isTransferCandidate(asSide(source), asSide(candidate)),
			),
		);
	});

	return found;
}

/**
 * A transfer between `a` and `b`, the negative side as the outflow, its kind
 * from both accounts' types.
 */
function transferBetween(a: PairSide, b: PairSide, now: number): Transfer {
	const [outflow, inflow] = a.amount < 0 ? [a, b] : [b, a];

	return {
		id: crypto.randomUUID(),
		outflowTransactionId: outflow.id,
		inflowTransactionId: inflow.id,
		kind: transferKindOf(inflow.accountType, outflow.accountType),
		createdAt: now,
	};
}

/**
 * Step 6 of `ingest`: links each of `createdIds` that forms a mutually unique
 * pair (AD-11). `applyRulePlanToHistory` calls it on the rows whose expected
 * counterpart account a rule set, which need not be new. Every candidate list is read before the first link is
 * written, so a link made for one line never removes a candidate from the
 * next, and the result does not depend on line order. A rule's expected
 * counterpart account narrows each list first, through `narrowToExpected`.
 * No balance, category, lock or tag moves.
 */
export async function matchNewTransfers(
	tx: Transaction,
	createdIds: readonly string[],
	now: number,
): Promise<void> {
	const candidatesOf = new Map<string, string[]>();
	// Each source's list, narrowed once all of its candidates are known.
	const record = (ids: readonly string[], pairs: readonly CandidatePair[]) => {
		const bySource = new Map<string, CandidatePair[]>();

		for (const pair of pairs) {
			bySource.set(pair.source.id, [...(bySource.get(pair.source.id) ?? []), pair]);
		}

		for (const id of ids) {
			const own = bySource.get(id) ?? [];
			const [first] = own;

			candidatesOf.set(
				id,
				first === undefined
					? []
					: narrowToExpected(
							first.source,
							own.map(({ candidate }) => candidate),
						),
			);
		}
	};

	const fromNew = await candidatePairs(tx, createdIds);
	record(createdIds, fromNew);

	// Only a unique candidate can complete a pair; its own candidates tell
	// whether the choice is mutual. A new row's are known already.
	const uniques = [
		...new Set(
			[...candidatesOf.values()]
				.filter((ids) => ids.length === 1)
				.flat()
				.filter((id) => !candidatesOf.has(id)),
		),
	];

	record(uniques, await candidatePairs(tx, uniques));

	// Each pair is a row of the first read, the new side as its source.
	const matched = new Set(mutualMatches(createdIds, candidatesOf).map((pair) => pair.join(" ")));
	const links = fromNew
		.filter(({ source, candidate }) => matched.has(`${source.id} ${candidate.id}`))
		.map(({ source, candidate }) => transferBetween(source, candidate, now));

	await inSequence(links, ROWS_PER_INSERT, (chunk) => tx.insert(transfers).values(chunk));
}

/**
 * The transactions `entryId` can be matched with, closest date first, then
 * the earlier, then the older entry: `candidatePairs` for this one source.
 * Throws `NOT_FOUND` for an unknown transaction; a transaction already in a
 * transfer has no candidate.
 */
export async function transferCandidates(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransferCandidate[]> {
	const source = await transferSide(deps.db, entryId);

	if (source === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	const rows = await candidatePairs(deps.db, [entryId]);

	return (
		rows
			.map(({ candidate }) => ({
				candidate,
				distance: Math.abs(daysBetween(source.date, candidate.date)),
			}))
			// Stable, so rows equally far keep the query's order.
			.toSorted((a, b) => a.distance - b.distance)
			.map(({ candidate }) => ({
				id: candidate.id,
				date: candidate.date,
				label: candidate.label,
				amount: toMinorUnits(candidate.amount),
				currency: candidate.currency,
				accountId: candidate.accountId,
				accountName: candidate.accountName,
			}))
	);
}

/**
 * Links `entryId` and `counterpartId` as one transfer, the negative side as
 * the outflow, its kind from the inflow account's type. The candidate search
 * runs again inside the write, so a concurrent match cannot put a transaction
 * in two transfers, and a rejected pair stays refused. No balance moves and
 * no category, lock or tag changes: the two rows stay what they were, only
 * their direction changes. Throws `NOT_FOUND` for an unknown `entryId`,
 * `VALIDATION_ERROR` on `counterpartId` when it is no candidate, unknown,
 * already matched, rejected, excluded or on a deactivated account included.
 */
export async function matchTransfer(
	deps: ServiceDeps,
	entryId: string,
	counterpartId: string,
	_options: { origin: Origin },
): Promise<Transfer> {
	return deps.db.transaction(
		async (tx): Promise<Transfer> => {
			if ((await transferSide(tx, entryId)) === undefined) {
				throw new AppError("NOT_FOUND", "No transaction has this id.");
			}

			const [pair] = await candidatePairs(tx, [entryId], counterpartId);

			if (pair === undefined) {
				throw invalidField("counterpartId", "not_a_candidate");
			}

			const transfer = transferBetween(pair.source, pair.candidate, Date.now());

			await tx.insert(transfers).values(transfer);

			return transfer;
		},
		{ behavior: "immediate" },
	);
}

/** The two sides a transfer joined, as an unpair gives them back. */
export type TransferSides = Pick<Transfer, "outflowTransactionId" | "inflowTransactionId">;

const sidesColumns = {
	outflowTransactionId: transfers.outflowTransactionId,
	inflowTransactionId: transfers.inflowTransactionId,
};

/**
 * Deletes a transfer, both sides becoming standard transactions again, their
 * category, locks and tags as they were, and returns the two sides. Throws
 * `NOT_FOUND` for an unknown id.
 */
export async function unmatchTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<TransferSides> {
	return deps.db.transaction(
		async (tx) => {
			const [deleted] = await tx
				.delete(transfers)
				.where(eq(transfers.id, transferId))
				.returning(sidesColumns);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			return deleted;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Undoes a transfer, as `unmatchTransfer`, and records its pair so that no
 * candidate search, by hand or automatic, offers it again. There is no way
 * back: the pair stays refused until one side is deleted. Returns the two
 * sides; throws `NOT_FOUND` for an unknown id.
 */
export async function rejectTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<TransferSides> {
	return deps.db.transaction(
		async (tx) => {
			const [deleted] = await tx
				.delete(transfers)
				.where(eq(transfers.id, transferId))
				.returning(sidesColumns);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			await tx.insert(rejectedTransfers).values({
				id: crypto.randomUUID(),
				...deleted,
				createdAt: Date.now(),
			});

			return deleted;
		},
		{ behavior: "immediate" },
	);
}
