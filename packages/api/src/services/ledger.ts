import type { DailyBalance } from "../domain/balances/forward.ts";
import type { SnapshotRejectionCode } from "../domain/balances/snapshot.ts";
import type { CashFlowRow, Direction } from "../domain/cash-flow.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { LineKeys, PairCandidate } from "../domain/keys.ts";
import type { PendingCandidate } from "../domain/pending.ts";
import type { RowPlan, RuleCandidate } from "../domain/rules/matching.ts";
import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
	StatementBalance,
} from "../domain/statement.ts";
import type { AmountRange } from "../domain/transaction-filter.ts";
import type { TransferSide } from "../domain/transfer-matching.ts";
import type { ServiceDeps } from "./deps.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
	and,
	between,
	count,
	desc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	not,
	notExists,
	notInArray,
	or,
	sql,
	sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AccountSubtype, AccountType, LoanDetails } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits, Money } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { BANK_CONNECTOR_IDS, bankConnections } from "@archant/data/schema/bank-connections";
import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import { categories } from "@archant/data/schema/categories";
import type { CategoryOrigin } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { EntryKeySource } from "@archant/data/schema/entry-keys";
import type { FileSourceId, ImportCounts } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import { merchants } from "@archant/data/schema/merchants";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import type { LockableField } from "@archant/data/schema/transactions";
import { LOCKABLE_FIELDS, transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind } from "@archant/data/transfer-kinds";
import { EXPENSE_TRANSFER_KINDS } from "@archant/data/transfer-kinds";
import type { Account, NewBalance, Transfer } from "@archant/data/types";

import { forwardBalances } from "../domain/balances/forward.ts";
import { fillDays } from "../domain/balances/history.ts";
import { reverseBalances } from "../domain/balances/reverse.ts";
import {
	snapshotGap,
	snapshotGapBackward,
	snapshotRejectionFor,
} from "../domain/balances/snapshot.ts";
import { toStoredBalance, toStoredBankBalance } from "../domain/balances/stored-balance.ts";
import { addDays, daysBetween, maxDate, minDate, today } from "../domain/dates.ts";
import { MATCH_WINDOW_DAYS, lineKeys, pairLines, previewDigest } from "../domain/keys.ts";
import { MAX_MISSED_SYNCS, absorbPending } from "../domain/pending.ts";
import { planActions } from "../domain/rules/matching.ts";
import { rejectionFor } from "../domain/statement.ts";
import { LIKE_ESCAPE, escapeLike } from "../domain/transaction-filter.ts";
import {
	TRANSFER_WINDOW_DAYS,
	isTransferCandidate,
	mutualMatches,
	narrowToExpected,
	transferKindOf,
} from "../domain/transfer-matching.ts";
import { AppError } from "../lib/errors.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../schemas/transactions.ts";
import { loadEnabledRules } from "./rules.ts";
import { getReportingCurrency } from "./settings.ts";

/** Who asked for a write (AD-2). Only `user` locks fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

/**
 * The `category_origin` a write records; a sync brings the provider's
 * category. Maintenance has none: it moves categories wholesale through
 * `recategorise`, never one transaction's through `updateTransaction`.
 */
const CATEGORY_ORIGIN_OF: Record<Exclude<Origin, "maintenance">, CategoryOrigin> = {
	user: "user",
	rule: "rule",
	provider: "provider",
	sync: "provider",
};

function categoryOriginOf(origin: Origin): CategoryOrigin {
	if (origin === "maintenance") {
		// A programming error, not a request error: no caller does this, and
		// the row would get an origin without the lock that goes with it.
		throw new Error("A maintenance write cannot set one transaction's category.");
	}

	return CATEGORY_ORIGIN_OF[origin];
}

export type NewAccountInput = {
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: CurrencyCode;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	openingBalance: MinorUnits;
	openingDate: IsoDate;
	/** A loan's details; absent or null for every other type. */
	details?: LoanDetails | null | undefined;
};

type Transaction = Parameters<Parameters<ServiceDeps["db"]["transaction"]>[0]>[0];

// SQLite caps bound parameters per statement at 32 766; four columns per row
// keeps a chunk far below it, and a decade of history is 3 650 rows.
const BALANCE_ROWS_PER_INSERT = 1000;

// Nine columns per entry row: 500 rows bind 4 500 parameters, far below the
// cap whatever the table. Epic 1 inserted a statement in one query, which a
// 3 600-line file would have pushed past it.
const ROWS_PER_INSERT = 500;

// Keys per lookup query; each query also binds the account and the source.
const KEYS_PER_LOOKUP = 500;

function chunksOf<Row>(rows: readonly Row[], size: number): Row[][] {
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
		rows.slice(index * size, (index + 1) * size),
	);
}

/** Runs `step` on each item strictly in sequence, so a failed step rolls back with nothing else queued. */
async function oneByOne<Item>(
	items: readonly Item[],
	step: (item: Item) => Promise<unknown>,
): Promise<void> {
	await items.reduce<Promise<unknown>>(
		(pending, item) => pending.then(() => step(item)),
		Promise.resolve(),
	);
}

/** Runs `write` on each chunk strictly in sequence. */
async function inSequence<Row>(
	rows: readonly Row[],
	size: number,
	write: (chunk: Row[]) => Promise<unknown>,
): Promise<void> {
	await oneByOne(chunksOf(rows, size), write);
}

/** The transfers `ids` sit in, on either side; `ids` may be a subquery. */
function transferOf(ids: readonly string[] | SQLWrapper): SQL | undefined {
	return or(
		inArray(transfers.outflowTransactionId, ids),
		inArray(transfers.inflowTransactionId, ids),
	);
}

// A `current_anchor` belongs to a bank-linked account, computed backward from
// it (AD-8); the forward computation reads only these two.
const FORWARD_VALUATION_KINDS = ["opening_anchor", "reconciliation"] as const;

/** The stored balance at the end of `date`: the last row on or before it. */
async function lastBalanceOnOrBefore(
	db: Pick<ServiceDeps["db"], "select"> | Pick<Transaction, "select">,
	accountId: string,
	date: IsoDate,
) {
	return db
		.select({ date: balances.date, balance: balances.balance, currency: balances.currency })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), lte(balances.date, date)))
		.orderBy(desc(balances.date))
		.limit(1)
		.get();
}

/** `max(today, latest entry date)`: the last day an account's balances run to. */
async function lastBalanceDay(tx: Transaction, accountId: string, timeZone: string) {
	// An array rather than `.get()`: the account always holds its opening anchor.
	const latest = await tx
		.select({ date: entries.date })
		.from(entries)
		.where(eq(entries.accountId, accountId))
		.orderBy(desc(entries.date))
		.limit(1);

	return latest.reduce((end, row) => maxDate(end, row.date), today(timeZone));
}

/**
 * A bank-linked account's balances, rewritten whole from its opening date:
 * a change on any day moves every earlier one, since they derive from the
 * bank's balance backward (AD-8). The bank's balance is a booked one, so the
 * pending entries dated on or before it go on top (AD-18); later ones move
 * the balance forward as any line does. The stored anchor stays the bank's
 * figure.
 */
async function recomputeBackward(
	tx: Transaction,
	account: Pick<Account, "id" | "type" | "currency">,
	anchor: DailyBalance,
	openingDate: IsoDate,
	timeZone: string,
): Promise<void> {
	const unbooked = await tx
		.select({ amount: entries.amount })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(
			and(
				eq(entries.accountId, account.id),
				eq(transactions.pending, true),
				lte(entries.date, anchor.date),
			),
		);
	const pendingOnAnchor = unbooked.reduce((total, row) => total + row.amount, 0);
	const sign = classificationOf(account.type) === "asset" ? 1 : -1;
	const movements = await tx
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.kind, "transaction")))
		.groupBy(entries.date);
	// The opening anchor bounds the range; its amount plays no part.
	const reconciliations = await tx
		.select({ date: entries.date, balance: entries.amount })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "reconciliation")));
	const rows: NewBalance[] = reverseBalances({
		from: openingDate,
		anchor: { date: anchor.date, balance: toMinorUnits(anchor.balance + sign * pendingOnAnchor) },
		valuations: reconciliations.map((row) => ({
			date: row.date,
			balance: toMinorUnits(row.balance),
		})),
		movements: movements.map((row) => ({ date: row.date, amount: toMinorUnits(row.amount) })),
		until: await lastBalanceDay(tx, account.id, timeZone),
		classification: classificationOf(account.type),
	}).map((row) => ({ accountId: account.id, currency: account.currency, ...row }));

	await tx.delete(balances).where(eq(balances.accountId, account.id));
	await inSequence(rows, BALANCE_ROWS_PER_INSERT, (chunk) => tx.insert(balances).values(chunk));
}

/**
 * The bank balance a linked account is computed backward from (AD-8), with
 * its opening date; `undefined` for an account computed forward.
 */
async function backwardAnchor(db: Pick<ServiceDeps["db"], "select">, accountId: string) {
	const openingAnchor = alias(entries, "opening_anchor");

	return db
		.select({ date: entries.date, balance: entries.amount, openingDate: openingAnchor.date })
		.from(entries)
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.innerJoin(
			openingAnchor,
			and(
				eq(openingAnchor.accountId, entries.accountId),
				eq(openingAnchor.valuationKind, "opening_anchor"),
			),
		)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.valuationKind, "current_anchor"),
				isNotNull(accounts.bankAccountId),
			),
		)
		.orderBy(desc(entries.date))
		.limit(1)
		.get();
}

/**
 * Rewrites an account's daily balances from `affected`, the earliest date the
 * write touched, to `max(today, latest entry date)`, and deletes the rows past
 * that end. Called by every ledger write inside its own transaction, so no
 * commit ever leaves `balances` stale (AD-2). A bank-linked account with a
 * bank balance is computed backward from it, whole; any other forward.
 */
async function recomputeBalances(
	tx: Transaction,
	account: Pick<Account, "id" | "type" | "currency">,
	affected: IsoDate,
	timeZone: string,
): Promise<void> {
	// Read here rather than passed in: an ingest or a revert may just have
	// moved the opening date.
	const anchor = await backwardAnchor(tx, account.id);

	if (anchor !== undefined) {
		await recomputeBackward(
			tx,
			account,
			{ date: anchor.date, balance: toMinorUnits(anchor.balance) },
			anchor.openingDate,
			timeZone,
		);

		return;
	}

	const previous = await lastBalanceOnOrBefore(tx, account.id, addDays(affected, -1));
	// Rows stop where the last write ended. A line dated past that day leaves a
	// gap the recompute fills from the last stored row. No row at all means the
	// account is being created: its opening anchor sets the first balance.
	const [from, opening] =
		previous === undefined ? [affected, 0] : [addDays(previous.date, 1), previous.balance];
	const movements = await tx
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				eq(entries.kind, "transaction"),
				gte(entries.date, from),
			),
		)
		.groupBy(entries.date);
	const valuations = await tx
		.select({ date: entries.date, balance: entries.amount })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				inArray(entries.valuationKind, FORWARD_VALUATION_KINDS),
				gte(entries.date, from),
			),
		);
	const until = await lastBalanceDay(tx, account.id, timeZone);

	const rows: NewBalance[] = forwardBalances({
		from,
		previous: toMinorUnits(opening),
		valuations: valuations.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
		movements: movements.map((row) => ({ date: row.date, amount: toMinorUnits(row.amount) })),
		until,
		classification: classificationOf(account.type),
	}).map((row) => ({ accountId: account.id, currency: account.currency, ...row }));

	await tx
		.delete(balances)
		.where(
			and(
				eq(balances.accountId, account.id),
				or(gte(balances.date, from), gt(balances.date, until)),
			),
		);

	await inSequence(rows, BALANCE_ROWS_PER_INSERT, (chunk) => tx.insert(balances).values(chunk));
}

async function accountWithOpeningDate(tx: Transaction, accountId: string) {
	const row = await tx
		.select({
			id: accounts.id,
			type: accounts.type,
			currency: accounts.currency,
			openingId: entries.id,
			openingDate: entries.date,
			openingBalance: entries.amount,
		})
		.from(accounts)
		.innerJoin(
			entries,
			and(eq(entries.accountId, accounts.id), eq(entries.valuationKind, "opening_anchor")),
		)
		.where(eq(accounts.id, accountId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	return row;
}

/**
 * Creates an account with its opening anchor and its daily balances, all or
 * nothing. `immediate` takes the write lock up front, so two concurrent ledger
 * writes queue on the busy timeout instead of failing halfway on an upgrade.
 */
export async function createAccount(
	deps: ServiceDeps,
	input: NewAccountInput,
	_options: { origin: Origin },
): Promise<Account> {
	const now = Date.now();
	const account: Account = {
		id: crypto.randomUUID(),
		name: input.name,
		type: input.type,
		subtype: input.subtype,
		currency: input.currency,
		details: input.details ?? null,
		active: true,
		excludedFromReports: false,
		bankAccountId: null,
		createdAt: now,
		updatedAt: now,
	};

	await deps.db.transaction(
		async (tx) => {
			await tx.insert(accounts).values(account);
			await tx.insert(entries).values({
				id: crypto.randomUUID(),
				accountId: account.id,
				kind: "valuation",
				valuationKind: "opening_anchor",
				date: input.openingDate,
				amount: input.openingBalance,
				currency: account.currency,
				createdAt: now,
				updatedAt: now,
			});
			await recomputeBalances(tx, account, input.openingDate, deps.timeZone);
		},
		{ behavior: "immediate" },
	);

	return account;
}

/** A bank's balance for the anchor: signed as it prints it, and the day it describes, if it says. */
export type AnchorBalance = { amount: MinorUnits; date: IsoDate | null };

/**
 * The day a `current_anchor` holds: the one the bank's balance describes,
 * never later than today. A closing balance often describes yesterday; dated
 * today, the backward computation would subtract today's lines a second time.
 */
function anchorDate(balance: AnchorBalance, day: IsoDate): IsoDate {
	return balance.date === null ? day : minDate(balance.date, day);
}

/**
 * Replaces the account's `current_anchor` with `anchor`, a stored balance,
 * or removes it for `null`. Returns the date written.
 */
async function writeCurrentAnchor(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	anchor: { date: IsoDate; balance: MinorUnits } | null,
	now: number,
): Promise<IsoDate | null> {
	// One current anchor per account, the bank's latest balance.
	await tx
		.delete(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "current_anchor")));

	if (anchor === null) {
		return null;
	}

	await tx.insert(entries).values({
		id: crypto.randomUUID(),
		accountId: account.id,
		kind: "valuation",
		valuationKind: "current_anchor",
		date: anchor.date,
		amount: anchor.balance,
		currency: account.currency,
		createdAt: now,
		updatedAt: now,
	});

	return anchor.date;
}

/**
 * Makes `bankAccountId` feed the account, Sure's `link_existing_account`,
 * and writes the bank's balance as its `current_anchor`, dated the day the
 * balance describes: the account is then computed backward from it (AD-8).
 * `balance` is the bank's signed figure, `null` when the bank gave none,
 * which leaves the account computed forward. Entries, the opening anchor and
 * reconciliations stay.
 */
export async function linkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	input: { bankAccountId: string; balance: AnchorBalance | null },
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const now = Date.now();

			await tx
				.update(accounts)
				.set({ bankAccountId: input.bankAccountId, updatedAt: now })
				.where(eq(accounts.id, accountId));

			// Deleted even without a new one: an anchor left by an earlier link
			// would otherwise turn the account backward from a stale figure.
			await writeCurrentAnchor(
				tx,
				account,
				input.balance === null
					? null
					: {
							date: anchorDate(input.balance, today(deps.timeZone)),
							balance: toStoredBankBalance(account, input.balance.amount),
						},
				now,
			);

			await recomputeBalances(tx, account, account.openingDate, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Replaces the account's reconciliation on `date` with `balance`, or writes
 * one. The one already there keeps its id but loses its import: the value is
 * no longer the file's, and reverting the file must not take it away.
 */
async function writeReconciliation(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	date: IsoDate,
	balance: MinorUnits,
	now: number,
): Promise<void> {
	const existing = await snapshotOn(tx, account.id, date);

	if (existing === undefined) {
		await tx.insert(entries).values({
			id: crypto.randomUUID(),
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date,
			amount: balance,
			currency: account.currency,
			createdAt: now,
			updatedAt: now,
		});

		return;
	}

	await tx
		.update(entries)
		.set({ amount: balance, importId: null, updatedAt: now })
		.where(eq(entries.id, existing.id));
}

/**
 * The days an unlinked account must fix to keep its stored balances, each
 * with the balance it keeps: the bank's day, and every day where going
 * forward would part from the history the backward computation stored.
 *
 * Going forward from the opening date's stored balance adds the movements
 * the backward pass subtracted, so the two agree up to the first
 * reconciliation. Past it they part: backward, a reconciliation fixes its
 * day and the days before it, the day after coming from the bank's side;
 * forward, the day after starts from the reconciliation. The day after one
 * whose balance does not follow from it is fixed too.
 */
function unlinkReconciliations(input: {
	rows: readonly { date: IsoDate; balance: MinorUnits }[];
	openingDate: IsoDate;
	anchorDate: IsoDate;
	reconciled: ReadonlySet<IsoDate>;
	sums: ReadonlyMap<IsoDate, MinorUnits>;
	sign: 1 | -1;
}): { date: IsoDate; balance: MinorUnits }[] {
	const stored = new Map(input.rows.map((row) => [row.date, row.balance]));
	const fixes = (date: IsoDate) => date === input.openingDate || input.reconciled.has(date);

	return input.rows
		.filter((row) => {
			// The opening day belongs to the opening anchor, even when the bank's
			// balance describes a day before it.
			if (row.date === input.anchorDate) {
				return row.date > input.openingDate;
			}

			const previous = addDays(row.date, -1);
			const before = stored.get(previous);

			return (
				before !== undefined &&
				fixes(previous) &&
				!fixes(row.date) &&
				before + input.sign * (input.sums.get(row.date) ?? 0) !== row.balance
			);
		})
		.map((row) => ({ date: row.date, balance: row.balance }));
}

/**
 * Sure's `unlink`: the account stops being fed by a bank and becomes a
 * manual one, computed forward, with every stored balance as it was (AD-8).
 * The bank's last figure becomes a reconciliation on its day, pending lines
 * included, since that is the balance the page showed; the opening anchor
 * takes the stored balance of the opening date; the `current_anchor` goes.
 * An account without a bank balance, already computed forward, only loses
 * its link.
 */
export async function unlinkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const anchor = await backwardAnchor(tx, accountId);
			const now = Date.now();

			await tx
				.update(accounts)
				.set({ bankAccountId: null, updatedAt: now })
				.where(eq(accounts.id, accountId));

			if (anchor === undefined) {
				return;
			}

			const last = maxDate(anchor.date, account.openingDate);
			const rows = await tx
				.select({ date: balances.date, balance: balances.balance })
				.from(balances)
				.where(
					and(eq(balances.accountId, accountId), between(balances.date, account.openingDate, last)),
				);
			const movements = await tx
				.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
				.from(entries)
				.where(
					and(
						eq(entries.accountId, accountId),
						eq(entries.kind, "transaction"),
						between(entries.date, account.openingDate, last),
					),
				)
				.groupBy(entries.date);
			const reconciled = await tx
				.select({ date: entries.date })
				.from(entries)
				.where(
					and(
						eq(entries.accountId, accountId),
						eq(entries.valuationKind, "reconciliation"),
						between(entries.date, account.openingDate, last),
					),
				);

			await oneByOne(
				unlinkReconciliations({
					rows: rows.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
					openingDate: account.openingDate,
					anchorDate: last,
					reconciled: new Set(reconciled.map((row) => row.date)),
					sums: new Map(movements.map((row) => [row.date, toMinorUnits(row.amount)])),
					sign: classificationOf(account.type) === "asset" ? 1 : -1,
				}),
				(row) => writeReconciliation(tx, account, row.date, row.balance, now),
			);
			await oneByOne(
				rows.filter((row) => row.date === account.openingDate),
				(row) =>
					tx
						.update(entries)
						.set({ amount: row.balance, updatedAt: now })
						.where(eq(entries.id, account.openingId)),
			);
			await writeCurrentAnchor(tx, account, null, now);
			await recomputeBalances(tx, account, account.openingDate, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Where the statement comes from. A manual line carries no key; an import's
 * lines are keyed under its source, a sync's under its connection's
 * connector (AD-7).
 */
export type IngestSource = { manual: true } | { importId: string } | { connectionId: string };

export type IngestOptions = {
	origin: Origin;
	/** Computes the groups and writes nothing: the import preview (AD-4). */
	dryRun?: boolean | undefined;
	/**
	 * An earlier opening date the user accepted so the lines on or before the
	 * current one go in. Ignored unless it is earlier.
	 */
	moveOpeningDate?: IsoDate | undefined;
};

/** A line as the preview shows it; `entryId` names the entry it is or pairs with. */
export type PreviewLine = {
	ref: string;
	date: IsoDate;
	amount: MinorUnits;
	label: string;
	entryId: string | null;
};

/**
 * A refused line. `line` is `null` when the source could not read it, and
 * `ref` is then the line's position in the source rather than in the statement.
 */
export type RejectedLine = {
	ref: string;
	reason: RejectionCode;
	line: { date: IsoDate; amount: MinorUnits; label: string } | null;
};

/** The five groups of an import preview (AD-4). */
export type IngestGroups = {
	/** New entries. */
	created: PreviewLine[];
	/** Recognised by a key: nothing is written. */
	present: PreviewLine[];
	/** Paired with an entry of another source: its keys are attached to it. */
	matched: PreviewLine[];
	/** Two entries equally near: created, flagged `possible_duplicate`. */
	duplicates: PreviewLine[];
	rejected: RejectedLine[];
};

/** How many lines fell in each group: the import's stored counts. */
export function countsOf(groups: IngestGroups): ImportCounts {
	return {
		created: groups.created.length,
		present: groups.present.length,
		matched: groups.matched.length,
		duplicates: groups.duplicates.length,
		rejected: groups.rejected.length,
	};
}

/**
 * What step 7 of the pipeline does with the statement balance (AD-8), in
 * stored balances (AD-5). `recorded`: confirm writes it as a snapshot owned by
 * the import. `present`: a snapshot with the same value is on that date
 * already, whoever wrote it. `kept`: the user entered another value on that
 * date, which stays; `gap` is `balance - recorded`. `skipped`: the account
 * cannot hold a snapshot on that date, or in that currency.
 */
export type StatementBalanceOutcome =
	| { status: "recorded"; date: IsoDate; balance: MinorUnits }
	| { status: "present"; date: IsoDate; balance: MinorUnits }
	| { status: "kept"; date: IsoDate; balance: MinorUnits; recorded: MinorUnits; gap: MinorUnits }
	| {
			status: "skipped";
			date: IsoDate;
			balance: MinorUnits;
			reason: Exclude<SnapshotRejectionCode, "SNAPSHOT_EXISTS"> | "CURRENCY_MISMATCH";
	  };

export type IngestResult = {
	/** Entry ids written, in statement order: the created lines and the possible duplicates. */
	created: string[];
	/** Every refused line, the source's first; `ref` is the line's index in the statement. */
	rejected: { ref: string; reason: RejectionCode }[];
	groups: IngestGroups;
	/** The hash confirm compares with the preview's. */
	digest: string;
	/**
	 * The day before the earliest line refused for being on or before the
	 * opening date: the opening date that would let every such line in.
	 */
	openingSuggestion: IsoDate | null;
	/** The opening anchor this ingest moves, `null` when it stays. */
	opening: { date: IsoDate; balance: MinorUnits } | null;
	/** Step 7's outcome, `null` when the statement has no balance. */
	balance: StatementBalanceOutcome | null;
};

function filledFields(line: NormalizedTransaction): LockableField[] {
	return line.notes === null ? ["date", "amount", "label"] : ["date", "amount", "label", "notes"];
}

/** The previewed import a keyed ingest belongs to; anything else is unknown. */
async function previewedImport(tx: Transaction, importId: string, accountId: string) {
	const row = await tx
		.select({ source: imports.source, digest: imports.previewDigest })
		.from(imports)
		.where(
			and(
				eq(imports.id, importId),
				eq(imports.accountId, accountId),
				eq(imports.status, "previewed"),
			),
		)
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No previewed import has this id.");
	}

	return row;
}

/** The connector a bank connection's lines are keyed under; anything else is unknown. */
async function connectionConnector(
	tx: Transaction,
	connectionId: string,
): Promise<BankConnectorId> {
	const row = await tx
		.select({ connector: bankConnections.connector })
		.from(bankConnections)
		.where(eq(bankConnections.id, connectionId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No bank connection has this id.");
	}

	return row.connector;
}

/** The entry holding each key already, and whether it is pending, looked up 500 keys per query. */
async function entriesByKey(
	tx: Transaction,
	accountId: string,
	source: EntryKeySource,
	keys: readonly string[],
): Promise<Map<string, KnownEntry>> {
	const found = new Map<string, KnownEntry>();

	await inSequence(keys, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await tx
			.select({ key: entryKeys.key, entryId: entryKeys.entryId, pending: transactions.pending })
			.from(entryKeys)
			.innerJoin(transactions, eq(transactions.entryId, entryKeys.entryId))
			.where(
				and(
					eq(entryKeys.accountId, accountId),
					eq(entryKeys.source, source),
					inArray(entryKeys.key, chunk),
				),
			);

		for (const row of rows) {
			found.set(row.key, { entryId: row.entryId, pending: row.pending });
		}
	});

	return found;
}

type KnownEntry = { entryId: string; pending: boolean };

/**
 * The account's pending entries carrying a key of the connection (AD-17):
 * those a statement of that connection speaks for, so its booked lines may
 * absorb them and its silence counts as a miss.
 */
async function pendingOfConnection(tx: Transaction, accountId: string, connectionId: string) {
	return tx
		.select({
			id: entries.id,
			date: entries.date,
			amount: entries.amount,
			createdAt: entries.createdAt,
			missedSyncs: transactions.pendingMissedSyncs,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(transactions.pending, true),
				exists(
					tx
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(
							and(eq(entryKeys.entryId, entries.id), eq(entryKeys.connectionId, connectionId)),
						),
				),
			),
		);
}

/**
 * The account's transactions a line may pair with (AD-7): dated within the
 * window of the lines, and carrying no key from this source.
 */
async function pairCandidates(
	tx: Transaction,
	accountId: string,
	source: EntryKeySource,
	dates: readonly IsoDate[],
): Promise<PairCandidate[]> {
	const sorted = dates.toSorted();
	const [first] = sorted;
	const last = sorted.at(-1);

	if (first === undefined || last === undefined) {
		return [];
	}

	const rows = await tx
		.select({ id: entries.id, date: entries.date, amount: entries.amount })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.kind, "transaction"),
				between(entries.date, addDays(first, -MATCH_WINDOW_DAYS), addDays(last, MATCH_WINDOW_DAYS)),
				notExists(
					tx
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(and(eq(entryKeys.entryId, entries.id), eq(entryKeys.source, source))),
				),
			),
		);

	return rows.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));
}

type Keyed = { ref: string; line: NormalizedTransaction; keys: LineKeys };

type Paired = Keyed & { entryId: string };

/**
 * `absorbed` holds step 3's lines (AD-17): a booked line taking over a pending
 * entry, or a pending line refreshing one. Only a sync has them.
 */
type Groups = {
	created: Keyed[];
	present: Paired[];
	matched: Paired[];
	duplicates: Keyed[];
	absorbed: Paired[];
};

function previewLine({ ref, line, ...rest }: Keyed & { entryId?: string }): PreviewLine {
	return {
		ref,
		date: line.date,
		amount: line.amount,
		label: line.label,
		entryId: rest.entryId ?? null,
	};
}

/**
 * Who a keyed ingest writes for: an import, or a bank connection. Keys carry
 * one of the two ids, so a revert finds its import's and a disconnection
 * leaves its connection's in place.
 */
type KeyTarget = {
	source: EntryKeySource;
	importId: string | null;
	connectionId: string | null;
};

/**
 * Writes the keys of a statement's lines onto their entries (AD-7). Two
 * lines of one statement may share an external id: the second keeps its
 * fingerprint only. A key already stored fails the write, unless
 * `keepExisting`: an absorbed line brings the key that found its entry.
 */
async function attachKeys(
	tx: Transaction,
	accountId: string,
	target: KeyTarget,
	lines: readonly { entryId: string; keys: LineKeys }[],
	options: { keepExisting?: boolean } = {},
): Promise<void> {
	const claimed = new Set<string>();
	const rows = lines.flatMap(({ entryId, keys }) =>
		[keys.fingerprint, keys.external]
			.filter((key): key is string => key !== null && !claimed.has(key))
			.map((key) => {
				claimed.add(key);

				return {
					entryId,
					accountId,
					source: target.source,
					key,
					importId: target.importId,
					connectionId: target.connectionId,
				};
			}),
	);

	await inSequence(rows, ROWS_PER_INSERT, (chunk) => {
		const insert = tx.insert(entryKeys).values(chunk);

		return options.keepExisting === true ? insert.onConflictDoNothing() : insert;
	});
}

/**
 * Sorts the accepted lines of a keyed statement into present, matched,
 * possible duplicates, absorbed and created (AD-7, AD-17), each in statement
 * order. Step 3 runs between key matching and pairing, for a sync only: a
 * key hit on a pending entry absorbs the line, whatever its status, unless a
 * booked line of the same statement booked that entry first; a booked line no
 * key found takes a pending entry of the connection by amount and date. A
 * pending line never pairs by amount and date: it is recognised or created.
 */
async function groupLines(
	tx: Transaction,
	accountId: string,
	target: KeyTarget,
	accepted: readonly Keyed[],
): Promise<Groups> {
	const known = await entriesByKey(
		tx,
		accountId,
		target.source,
		accepted.flatMap(({ keys }) =>
			keys.external === null ? [keys.fingerprint] : [keys.fingerprint, keys.external],
		),
	);
	const groups: Groups = { created: [], present: [], matched: [], duplicates: [], absorbed: [] };
	const remaining: (Keyed & { date: IsoDate; amount: MinorUnits })[] = [];
	// Entries this statement already booked or refreshed: a later pending line
	// for a booked one changes nothing, and step 3's amount match skips both.
	const booked = new Set<string>();
	const claimed = new Set<string>();

	for (const item of accepted) {
		const hit =
			known.get(item.keys.fingerprint) ??
			(item.keys.external === null ? undefined : known.get(item.keys.external));

		if (hit === undefined) {
			remaining.push({ ...item, date: item.line.date, amount: item.line.amount });
		} else if (hit.pending && !booked.has(hit.entryId)) {
			// Only a bank connector's keys sit on a pending entry: only a sync gets here.
			groups.absorbed.push({ ...item, entryId: hit.entryId });
			claimed.add(hit.entryId);

			if (!item.line.pending) {
				booked.add(hit.entryId);
			}
		} else {
			groups.present.push({ ...item, entryId: hit.entryId });
		}
	}

	const pendingLines = remaining.filter(({ line }) => line.pending);
	const bookedLines = remaining.filter(({ line }) => !line.pending);
	const survivors =
		target.connectionId === null
			? []
			: (await pendingOfConnection(tx, accountId, target.connectionId))
					.filter(({ id }) => !claimed.has(id))
					.map((row): PendingCandidate => ({
						id: row.id,
						date: row.date,
						amount: toMinorUnits(row.amount),
						createdAt: row.createdAt,
					}));
	const unpaired: typeof remaining = [];

	for (const { line: item, survivorId } of absorbPending(bookedLines, survivors)) {
		if (survivorId === null) {
			unpaired.push(item);
		} else {
			groups.absorbed.push({
				ref: item.ref,
				line: item.line,
				keys: item.keys,
				entryId: survivorId,
			});
		}
	}

	const candidates = await pairCandidates(
		tx,
		accountId,
		target.source,
		unpaired.map(({ date }) => date),
	);

	for (const { line: item, pairing } of pairLines(unpaired, candidates)) {
		const keyed = { ref: item.ref, line: item.line, keys: item.keys };

		if (pairing.kind === "matched") {
			groups.matched.push({ ...keyed, entryId: pairing.candidateId });
		} else if (pairing.kind === "tie") {
			groups.duplicates.push(keyed);
		} else {
			groups.created.push(keyed);
		}
	}

	groups.created.push(...pendingLines.map(({ ref, line, keys }) => ({ ref, line, keys })));
	groups.created.sort((a, b) => Number(a.ref) - Number(b.ref));

	return groups;
}

type BalancePlan = {
	outcome: StatementBalanceOutcome;
	/** The snapshot already on the statement's date, if any. */
	existing: { id: string; balance: MinorUnits; importId: string | null } | undefined;
	importId: string;
};

/**
 * Step 7 of the pipeline, planned (AD-8): what the statement balance becomes,
 * checked against the opening date after any accepted move. A snapshot the
 * user entered on that date wins; one an earlier import wrote gives way, as
 * the bank's latest file is the better word, and Sure's `ReconciliationManager`
 * updates in place.
 */
async function planStatementBalance(
	tx: Transaction,
	account: { id: string; type: AccountType; currency: string },
	statementBalance: StatementBalance,
	context: { openingDate: IsoDate; today: IsoDate },
	importId: string,
): Promise<BalancePlan> {
	const { date } = statementBalance;
	const balance = toStoredBalance(account, statementBalance.amount);
	const reason =
		snapshotRejectionFor(date, context) ??
		(statementBalance.currency === account.currency ? null : "CURRENCY_MISMATCH");

	if (reason !== null) {
		return { outcome: { status: "skipped", date, balance, reason }, existing: undefined, importId };
	}

	const row = await snapshotOn(tx, account.id, date);
	const existing = row === undefined ? undefined : { ...row, balance: toMinorUnits(row.balance) };

	// As a line already present: an equal value writes nothing, so a re-import
	// changes nothing and the first import stays the owner.
	if (existing?.balance === balance) {
		return { outcome: { status: "present", date, balance }, existing, importId };
	}

	if (existing !== undefined && existing.importId === null) {
		const recorded = existing.balance;

		return {
			outcome: { status: "kept", date, balance, recorded, gap: toMinorUnits(balance - recorded) },
			existing,
			importId,
		};
	}

	return { outcome: { status: "recorded", date, balance }, existing, importId };
}

/**
 * Step 7 of the pipeline, written: inserts the statement balance as a
 * snapshot owned by the import, or moves an earlier import's snapshot to it.
 * Returns the date written, `null` when nothing was.
 */
async function writeStatementBalance(
	tx: Transaction,
	account: { id: string; currency: string },
	plan: BalancePlan,
	now: number,
): Promise<IsoDate | null> {
	const { outcome, existing, importId } = plan;

	if (outcome.status !== "recorded") {
		return null;
	}

	if (existing === undefined) {
		await tx.insert(entries).values({
			id: crypto.randomUUID(),
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date: outcome.date,
			amount: outcome.balance,
			currency: account.currency,
			importId,
			createdAt: now,
			updatedAt: now,
		});
	} else {
		await tx
			.update(entries)
			.set({ amount: outcome.balance, importId, updatedAt: now })
			.where(eq(entries.id, existing.id));
	}

	return outcome.date;
}

/**
 * Step 7 for a sync, planned: the bank's balance becomes the account's
 * `current_anchor` (AD-8), dated the day it describes and never after today.
 * Skipped in another currency: FR56 wants the bank's own figure, unconverted.
 */
function planCurrentAnchor(
	account: { type: AccountType; currency: string },
	statementBalance: StatementBalance,
	day: IsoDate,
): StatementBalanceOutcome {
	const date = anchorDate(statementBalance, day);
	const balance = toStoredBankBalance(account, statementBalance.amount);

	return statementBalance.currency === account.currency
		? { status: "recorded", date, balance }
		: { status: "skipped", date, balance, reason: "CURRENCY_MISMATCH" };
}

/**
 * Writes a statement into one account, in one transaction, following the
 * pipeline order of AD-4. A manual line carries no key and is always
 * created; an import's or a sync's lines are keyed and grouped (AD-7), and a
 * sync's reconcile with pending entries (AD-17): absorbed in place, or
 * counted missing and deleted at the second miss in a row. With `dryRun`, the
 * groups are computed and nothing is written. Confirming an import refuses with
 * `IMPORT_PREVIEW_STALE` when the groups differ from its preview, and marks
 * it confirmed with its counts in the same transaction. A sync's statement
 * balance rewrites the account's `current_anchor` instead of adding a
 * reconciliation.
 */
export async function ingest(
	deps: ServiceDeps,
	accountId: string,
	statement: ParsedStatement,
	source: IngestSource,
	options: IngestOptions,
): Promise<IngestResult> {
	return deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const target =
				"importId" in source
					? {
							id: source.importId,
							...(await previewedImport(tx, source.importId, accountId)),
						}
					: null;
			const connectionId = "connectionId" in source ? source.connectionId : null;
			const keyTarget: KeyTarget | null =
				target !== null
					? { source: target.source, importId: target.id, connectionId: null }
					: connectionId === null
						? null
						: {
								source: await connectionConnector(tx, connectionId),
								importId: null,
								connectionId,
							};
			const moveTo =
				options.moveOpeningDate !== undefined && options.moveOpeningDate < account.openingDate
					? options.moveOpeningDate
					: null;
			const context = {
				openingDate: moveTo ?? account.openingDate,
				currency: account.currency,
				today: today(deps.timeZone),
			};
			const accepted: Keyed[] = [];
			const refused: (RejectedLine & { line: NonNullable<RejectedLine["line"]> })[] = [];

			// 1. Reject lines the account cannot hold. Keys cover every line,
			// refused ones included, so a line's occurrence index never depends on
			// the account's opening date.
			for (const [index, { line, keys }] of lineKeys(statement.transactions).entries()) {
				const reason = rejectionFor(line, context);
				const ref = String(index);

				if (reason === null) {
					accepted.push({ ref, line, keys });
				} else {
					refused.push({
						ref,
						reason,
						line: { date: line.date, amount: line.amount, label: line.label },
					});
				}
			}

			// 2. Key matching, batched per statement (AD-7). A manual line has no key.
			const grouped: Groups =
				keyTarget === null
					? { created: accepted, present: [], matched: [], duplicates: [], absorbed: [] }
					: await groupLines(tx, accountId, keyTarget, accepted);
			const unreadable: RejectedLine[] = statement.rejected.map((item) => ({
				...item,
				line: null,
			}));
			const groups: IngestGroups = {
				created: grouped.created.map(previewLine),
				present: grouped.present.map(previewLine),
				matched: grouped.matched.map(previewLine),
				duplicates: grouped.duplicates.map(previewLine),
				rejected: [...unreadable, ...refused],
			};
			const written = [
				...grouped.created.map((item) => ({ ...item, duplicate: false })),
				...grouped.duplicates.map((item) => ({ ...item, duplicate: true })),
			];
			const [earliestRefused] = refused
				.filter(({ reason }) => reason === "BEFORE_OPENING_DATE")
				.map(({ line }) => line.date)
				.toSorted();
			// AD-5: the opening balance changes so that the old opening day ends on
			// the same balance once the lines up to it count. Sure's
			// `adjust_opening_anchor_if_needed!` keeps the amount and shifts today's
			// balance instead.
			const movedIn = written
				.filter(({ line }) => line.date <= account.openingDate)
				.reduce((total, { line }) => total + line.amount, 0);
			const opening =
				moveTo === null
					? null
					: {
							date: moveTo,
							balance: toMinorUnits(
								classificationOf(account.type) === "asset"
									? account.openingBalance - movedIn
									: account.openingBalance + movedIn,
							),
						};
			// 7. The statement balance, planned here so the preview shows it and
			// the digest covers it. A manual statement carries none.
			const balancePlan =
				target === null || statement.balance === null
					? null
					: await planStatementBalance(tx, account, statement.balance, context, target.id);
			const anchorPlan =
				connectionId === null || statement.balance === null
					? null
					: planCurrentAnchor(account, statement.balance, context.today);
			const digest = previewDigest([
				...(["created", "present", "matched", "duplicates"] as const).flatMap((group) =>
					groups[group].map(({ ref, entryId }) => ({ group, ref, entryId })),
				),
				...unreadable.map(({ ref, reason }) => ({ group: `source:${reason}`, ref, entryId: null })),
				...refused.map(({ ref, reason }) => ({ group: `ledger:${reason}`, ref, entryId: null })),
				// The opening confirm would write must be the one the preview showed.
				{ group: "opening", ref: JSON.stringify(opening), entryId: null },
				// A snapshot entered on that date since the preview turns `recorded`
				// into `kept`: confirm must not write what the preview did not show.
				{
					group: "balance",
					ref: JSON.stringify(balancePlan?.outcome ?? null),
					entryId: balancePlan?.existing?.id ?? null,
				},
			]);
			const result: IngestResult = {
				created: [],
				rejected: groups.rejected.map(({ ref, reason }) => ({ ref, reason })),
				groups,
				digest,
				openingSuggestion: earliestRefused === undefined ? null : addDays(earliestRefused, -1),
				opening,
				balance: balancePlan?.outcome ?? anchorPlan,
			};

			if (options.dryRun === true) {
				return result;
			}

			if (target !== null && target.digest !== digest) {
				throw new AppError("IMPORT_PREVIEW_STALE", "The account changed since the preview.");
			}

			// 3. Pending reconciliation (AD-17): each absorbed line updates its
			// entry in place, keeping its id and everything the user set.
			const now = Date.now();
			const absorbedFrom: IsoDate[] = [];

			if (keyTarget !== null) {
				await oneByOne(grouped.absorbed, async ({ entryId, line, keys }) => {
					absorbedFrom.push(
						await absorb(tx, entryId, { line, keys }, keyTarget, options.origin, now),
					);
				});
			}

			// 4. Insert the new entries, attach keys to matched ones.
			const rows = written.map((item) => ({ ...item, id: crypto.randomUUID() }));

			await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
				tx.insert(entries).values(
					chunk.map(({ id, line }) => ({
						id,
						accountId,
						kind: "transaction" as const,
						date: line.date,
						amount: line.amount,
						currency: line.currency,
						// The creation marker a revert deletes by. Matched entries get
						// keys only: keys alone cannot tell them from created ones.
						importId: target?.id ?? null,
						createdAt: now,
						updatedAt: now,
					})),
				),
			);
			const locksOf = (line: NormalizedTransaction) =>
				options.origin === "user" ? filledFields(line) : [];

			await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
				tx.insert(transactions).values(
					chunk.map(({ id, line, duplicate }) => ({
						entryId: id,
						label: line.label,
						notes: line.notes,
						reference: line.reference,
						possibleDuplicate: duplicate,
						pending: line.pending,
						lockedFields: locksOf(line),
					})),
				),
			);

			if (keyTarget !== null) {
				await attachKeys(tx, accountId, keyTarget, [
					...rows.map(({ id, keys }) => ({ entryId: id, keys })),
					...grouped.matched.map(({ entryId, keys }) => ({ entryId, keys })),
				]);
			}

			if (target !== null) {
				await tx
					.update(imports)
					.set({
						status: "confirmed",
						confirmedAt: now,
						// Nothing reads the file after confirm, and it holds the full
						// account number and every amount (AD-14).
						content: Buffer.alloc(0),
						counts: countsOf(groups),
						// A revert gives back the shift of the moved-in lines it deletes;
						// without it, every later balance would stay off by their sum.
						previousOpeningDate: opening === null ? null : account.openingDate,
					})
					.where(eq(imports.id, target.id));
			}

			if (opening !== null) {
				await tx
					.update(entries)
					.set({ date: opening.date, amount: opening.balance, updatedAt: now })
					.where(eq(entries.id, account.openingId));
			}

			// A pending entry of the connection this statement did not speak for
			// counts a miss; the second in a row deletes it. A failed sync rolls
			// back with this transaction, so it never counts.
			const missedFrom: IsoDate[] = [];

			if (connectionId !== null) {
				const seen = new Set([
					...grouped.absorbed.map(({ entryId }) => entryId),
					...rows.map(({ id }) => id),
				]);

				missedFrom.push(...(await countMissedSyncs(tx, accountId, connectionId, seen)));
			}

			// 5. Rules, on the rows this ingest created, possible duplicates
			// included. Loaded once per call, inside this transaction. A new row
			// carries no merchant, category, tag or transfer yet.
			if (rows.length > 0) {
				const { plan } = planActions(
					await loadEnabledRules(tx),
					rows.map(({ id, line }) => ({
						id,
						accountId,
						date: line.date,
						amount: line.amount,
						currency: line.currency,
						label: line.label,
						notes: line.notes,
						merchantId: null,
						categoryId: null,
						tagIds: [],
						excluded: false,
						transfer: null,
						expectedTransferAccountId: null,
						lockedFields: locksOf(line),
					})),
					getReportingCurrency(),
					MAX_TAGS_PER_TRANSACTION,
				);

				await applyRulePlan(tx, plan, { origin: "rule" });
			}

			// 6. Transfer matching, once every new row exists (AD-11).
			await matchNewTransfers(
				tx,
				rows.map((row) => row.id),
				now,
			);

			// 7. The statement balance (AD-8).
			const snapshotDate =
				balancePlan === null ? null : await writeStatementBalance(tx, account, balancePlan, now);
			const anchorWritten =
				anchorPlan?.status === "recorded"
					? await writeCurrentAnchor(tx, account, anchorPlan, now)
					: null;

			// 8. Recompute balances from the earliest date this write touched.
			const [earliest] = [
				...rows.map(({ line }) => line.date),
				...absorbedFrom,
				...missedFrom,
				...(opening === null ? [] : [opening.date]),
				...(snapshotDate === null ? [] : [snapshotDate]),
				...(anchorWritten === null ? [] : [anchorWritten]),
			].toSorted();

			if (earliest !== undefined) {
				await recomputeBalances(tx, account, earliest, deps.timeZone);
			}

			result.created.push(...rows.map((row) => row.id));

			return result;
		},
		{ behavior: "immediate" },
	);
}

/** Which of `ids` `find` still finds, looked up 500 per query. */
async function stillThere(
	ids: Iterable<string>,
	find: (chunk: string[]) => Promise<{ id: string }[]>,
): Promise<Set<string>> {
	const found = new Set<string>();

	await inSequence([...new Set(ids)], KEYS_PER_LOOKUP, async (chunk) => {
		for (const row of await find(chunk)) {
			found.add(row.id);
		}
	});

	return found;
}

/** `id` when `set` still holds it, `undefined` otherwise. */
function ifStillThere(set: ReadonlySet<string>, id: string | undefined): string | undefined {
	return id !== undefined && set.has(id) ? id : undefined;
}

/** What `applyRulePlan` re-reads of each planned row; a row deleted since the plan is absent. */
function plannedRows(tx: Transaction, ids: string[]) {
	return tx
		.select({
			id: entries.id,
			...editableColumns,
			inTransfer: inAnyTransfer.mapWith(Boolean),
			expectedTransferAccountId: transactions.expectedTransferAccountId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(inArray(entries.id, ids));
}

/**
 * Writes what rules planned, by entry id, with `origin: "rule"` (AD-10): a
 * category's origin becomes `rule` and nothing is locked. It re-reads each
 * row inside the transaction and skips a locked field, a value the row
 * already holds, and a category, merchant, tag or account deleted since the
 * plan. A tag is added beside the others while the row holds fewer than
 * `MAX_TAGS_PER_TRANSACTION`; the expected counterpart account is set only on
 * a row in no transfer. Returns the ids of the rows it changed and, among
 * them, of those whose expected counterpart account it set, which transfer
 * matching reads next. Step 5 of `ingest` calls it; applying rules to history
 * reuses it.
 */
export async function applyRulePlan(
	tx: Transaction,
	plan: ReadonlyMap<string, RowPlan>,
	_options: { origin: "rule" },
): Promise<{ changed: string[]; marked: string[] }> {
	const origin: Origin = "rule";
	const ids = [...plan.keys()];
	const plans = [...plan.values()];
	const rows: Awaited<ReturnType<typeof plannedRows>> = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(...(await plannedRows(tx, chunk)));
	});

	const tagsOf = await tagIdsByEntry(tx, ids);
	const [knownCategories, knownMerchants, knownTags, knownAccounts] = [
		await stillThere(
			plans.flatMap((row) => (row.categoryId === undefined ? [] : [row.categoryId])),
			(chunk) =>
				tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) => (row.merchantId === undefined ? [] : [row.merchantId])),
			(chunk) =>
				tx.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) => row.addTagIds ?? []),
			(chunk) => tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) =>
				row.expectedTransferAccountId === undefined ? [] : [row.expectedTransferAccountId],
			),
			(chunk) => tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, chunk)),
		),
	];
	// Rows whose write is the same share one statement per chunk, as in a bulk edit.
	const writes = new Map<
		string,
		{ detail: Partial<typeof transactions.$inferInsert>; ids: string[] }
	>();
	const newTaggings: { transactionId: string; tagId: string }[] = [];
	const marked: string[] = [];

	const rowById = new Map(rows.map((row) => [row.id, row]));

	for (const [id, planned] of plan) {
		const found = rowById.get(id);

		// Deleted since the plan: nothing left to write.
		if (found === undefined) {
			continue;
		}

		const { inTransfer, expectedTransferAccountId, ...row } = found;
		const current: EditableRow = { ...row, tagIds: tagsOf.get(id) ?? [] };
		const tagIds = [...current.tagIds];

		for (const tagId of planned.addTagIds ?? []) {
			if (
				knownTags.has(tagId) &&
				!tagIds.includes(tagId) &&
				tagIds.length < MAX_TAGS_PER_TRANSACTION
			) {
				tagIds.push(tagId);
			}
		}

		const change = changeOf(
			current,
			{
				categoryId: ifStillThere(knownCategories, planned.categoryId),
				merchantId: ifStillThere(knownMerchants, planned.merchantId),
				tagIds,
				label: planned.label,
				excluded: planned.excluded,
			},
			origin,
		);
		const expected = ifStillThere(knownAccounts, planned.expectedTransferAccountId);
		const expects =
			expected !== undefined &&
			expected !== expectedTransferAccountId &&
			expected !== row.accountId &&
			!inTransfer;

		if (change.changed.length === 0 && !expects) {
			continue;
		}

		if (expects) {
			marked.push(id);
		}

		const detail = {
			...detailOf(current, change, origin),
			...(expects ? { expectedTransferAccountId: expected } : {}),
		};
		const key = JSON.stringify(detail);
		const group = writes.get(key);

		if (group === undefined) {
			writes.set(key, { detail, ids: [id] });
		} else {
			group.ids.push(id);
		}

		if (change.changed.includes("tags")) {
			newTaggings.push(
				...change.next.tagIds
					.filter((tagId) => !current.tagIds.includes(tagId))
					.map((tagId) => ({ transactionId: id, tagId })),
			);
		}
	}

	const statements = [...writes.values()].flatMap(({ detail, ids: group }) =>
		chunksOf(group, ROWS_PER_INSERT).map((chunk) => ({ detail, chunk })),
	);

	await oneByOne(statements, ({ detail, chunk }) =>
		tx.update(transactions).set(detail).where(inArray(transactions.entryId, chunk)),
	);
	await inSequence(newTaggings, ROWS_PER_INSERT, (chunk) => tx.insert(taggings).values(chunk));

	return { changed: [...writes.values()].flatMap(({ ids: group }) => group), marked };
}

/**
 * Applying rules to existing transactions: writes `plan` through
 * `applyRulePlan`, then pairs the rows whose expected counterpart account it
 * set, as step 6 of `ingest` pairs new ones. No balance moves: no rule action
 * changes an amount. Returns how many rows changed, each once.
 */
export async function applyRulePlanToHistory(
	deps: ServiceDeps,
	plan: ReadonlyMap<string, RowPlan>,
	options: { origin: "rule" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const { changed, marked } = await applyRulePlan(tx, plan, options);

			await matchNewTransfers(tx, marked, Date.now());

			return changed.length;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Every transaction as a rule reads it, for applying rules to history:
 * possible duplicates and excluded rows included, with their merchant,
 * category, tags, notes, transfer kind, expected counterpart and locks.
 * `from` keeps rows dated on or after it; `null` keeps every date. Tags are
 * read `KEYS_PER_LOOKUP` rows per query, below SQLite's parameter cap.
 */
export async function ruleCandidates(
	db: Pick<Transaction, "select">,
	from: IsoDate | null,
): Promise<RuleCandidate[]> {
	const rows = await db
		.select({
			id: entries.id,
			...editableColumns,
			expectedTransferAccountId: transactions.expectedTransferAccountId,
			transferKind: transferColumns.transferKind,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(
			and(eq(entries.kind, "transaction"), from === null ? undefined : gte(entries.date, from)),
		)
		.orderBy(entries.date, entries.createdAt, entries.id);
	const tagsOf = await tagIdsByEntry(
		db,
		rows.map((row) => row.id),
	);

	return rows.map(({ transferKind, amount, ...row }) => ({
		...row,
		amount: toMinorUnits(amount),
		tagIds: tagsOf.get(row.id) ?? [],
		transfer: transferKind === null ? null : { kind: transferKind },
	}));
}

/** An absent or `undefined` field is left as it is. */
export type TransactionPatch = {
	date?: IsoDate | undefined;
	amount?: MinorUnits | undefined;
	label?: string | undefined;
	notes?: string | null | undefined;
	excluded?: boolean | undefined;
	/** `null` leaves the transaction « Sans catégorie ». */
	categoryId?: string | null | undefined;
	/** `null` leaves the transaction « Sans marchand ». */
	merchantId?: string | null | undefined;
	/** The whole set, replacing the current one; `[]` removes every tag. */
	tagIds?: readonly string[] | undefined;
};

/** The patch key and the row column behind each lockable field. */
const PATCH_KEY_OF = {
	date: "date",
	amount: "amount",
	label: "label",
	notes: "notes",
	excluded: "excluded",
	category: "categoryId",
	merchant: "merchantId",
	tags: "tagIds",
} as const satisfies Record<LockableField, keyof TransactionPatch>;

export type UpdateResult = { status: "updated" } | { status: "rejected"; reason: RejectionCode };

// What a row edit reads: the entry's date and amount beside the detail row.
const editableColumns = {
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
	excluded: transactions.excluded,
	categoryId: transactions.categoryId,
	merchantId: transactions.merchantId,
	lockedFields: transactions.lockedFields,
};

async function transactionRow(tx: Transaction, entryId: string) {
	const row = await tx
		.select(editableColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return { ...row, tagIds: await tagIdsOf(tx, entryId) };
}

/** A transaction as an edit sees it, tags included. */
type EditableRow = Awaited<ReturnType<typeof transactionRow>>;

async function tagIdsOf(db: Pick<Transaction, "select">, entryId: string): Promise<string[]> {
	const rows = await db
		.select({ tagId: taggings.tagId })
		.from(taggings)
		.where(eq(taggings.transactionId, entryId))
		.orderBy(taggings.tagId);

	return rows.map((row) => row.tagId);
}

/** Tags are a set: the same ids in another order, or repeated, are no change. */
function sameValue(current: unknown, value: unknown): boolean {
	if (Array.isArray(current) && Array.isArray(value)) {
		const wanted = new Set<unknown>(value);

		return wanted.size === current.length && current.every((item) => wanted.has(item));
	}

	return current === value;
}

type RowChange = { next: EditableRow; changed: LockableField[] };

/**
 * What `patch` changes on one row. A field changes only where the value
 * differs; a `user` write changes a locked field, any other origin leaves it
 * as it is (AD-10). Shared by the single and the bulk edit, so both lock the
 * same way.
 */
function changeOf(current: EditableRow, patch: TransactionPatch, origin: Origin): RowChange {
	const locked = new Set(current.lockedFields);
	const next = { ...current };
	const changed: LockableField[] = [];

	for (const field of LOCKABLE_FIELDS) {
		const key = PATCH_KEY_OF[field];
		const value = patch[key];
		const allowed = origin === "user" || !locked.has(field);

		if (value !== undefined && !sameValue(current[key], value) && allowed) {
			changed.push(field);
			Object.assign(next, { [key]: Array.isArray(value) ? [...new Set(value)] : value });
		}
	}

	return { next, changed };
}

/**
 * The `transactions` columns a change writes: the fields it changed, the
 * category's origin with the category, `null` without one, and the locks a
 * `user` write adds. The entry's date and amount and the taggings are the
 * caller's.
 */
function detailOf(
	current: EditableRow,
	{ next, changed }: RowChange,
	origin: Origin,
): Partial<typeof transactions.$inferInsert> {
	// Asked even when the category is cleared, so a maintenance write fails either way.
	const categoryOrigin = changed.includes("category") ? categoryOriginOf(origin) : null;

	return {
		...(changed.includes("label") ? { label: next.label } : {}),
		...(changed.includes("notes") ? { notes: next.notes } : {}),
		...(changed.includes("excluded") ? { excluded: next.excluded } : {}),
		...(changed.includes("category")
			? {
					categoryId: next.categoryId,
					categoryOrigin: next.categoryId === null ? null : categoryOrigin,
				}
			: {}),
		...(changed.includes("merchant") ? { merchantId: next.merchantId } : {}),
		lockedFields:
			origin === "user"
				? [...new Set([...current.lockedFields, ...changed])]
				: current.lockedFields,
	};
}

function invalidField(path: string, code = "invalid_value"): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);
}

async function categoryExists(tx: Transaction, id: string): Promise<boolean> {
	const row = await tx
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.id, id))
		.get();

	return row !== undefined;
}

async function merchantExists(tx: Transaction, id: string): Promise<boolean> {
	const row = await tx
		.select({ id: merchants.id })
		.from(merchants)
		.where(eq(merchants.id, id))
		.get();

	return row !== undefined;
}

/** Whether every one of `ids`, without repeats, names a tag. */
async function tagsExist(tx: Transaction, ids: readonly string[]): Promise<boolean> {
	const found = await tx
		.select({ count: count() })
		.from(tags)
		.where(inArray(tags.id, [...ids]))
		.get();

	return found?.count === ids.length;
}

/**
 * Edits a transaction and recomputes its account's balances from the earlier
 * of its old and new dates; a change to the category or the merchant alone
 * touches neither the entry nor the balances. A `user` edit locks every
 * field it changes, clearing the category or the merchant included, as in
 * Sure; any other origin leaves locked fields as they are (AD-10). The
 * category's origin is the call's, `null` without a category. Throws
 * `VALIDATION_ERROR` on `categoryId` or `merchantId` for an unknown category
 * or merchant, checked in the same transaction as the write so a concurrent
 * delete cannot slip between them.
 */
export async function updateTransaction(
	deps: ServiceDeps,
	entryId: string,
	patch: TransactionPatch,
	options: { origin: Origin },
): Promise<UpdateResult> {
	return deps.db.transaction(
		async (tx): Promise<UpdateResult> => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const change = changeOf(current, patch, options.origin);
			const { next, changed } = change;

			if (
				changed.includes("category") &&
				next.categoryId !== null &&
				!(await categoryExists(tx, next.categoryId))
			) {
				throw invalidField("categoryId");
			}

			if (
				changed.includes("merchant") &&
				next.merchantId !== null &&
				!(await merchantExists(tx, next.merchantId))
			) {
				throw invalidField("merchantId");
			}

			if (
				changed.includes("tags") &&
				next.tagIds.length > 0 &&
				!(await tagsExist(tx, next.tagIds))
			) {
				throw invalidField("tagIds");
			}

			const reason = rejectionFor(
				{ date: next.date, currency: current.currency },
				{
					openingDate: account.openingDate,
					currency: account.currency,
					today: today(deps.timeZone),
				},
			);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			if (changed.length === 0) {
				return { status: "updated" };
			}

			// The category, the merchant and the tags live beside the entry and move
			// no balance, so classifying a row does not rewrite a decade of daily balances.
			const touchesEntry = changed.some(
				(field) => field !== "category" && field !== "merchant" && field !== "tags",
			);

			if (touchesEntry) {
				await tx
					.update(entries)
					.set({ date: next.date, amount: next.amount, updatedAt: Date.now() })
					.where(eq(entries.id, entryId));
			}

			// The two sides no longer cancel out, so they stop being one movement.
			// A new date keeps the transfer, as in Sure: the money still moved.
			if (changed.includes("amount")) {
				await tx.delete(transfers).where(transferOf([entryId]));
			}

			await tx
				.update(transactions)
				.set(detailOf(current, change, options.origin))
				.where(eq(transactions.entryId, entryId));

			if (changed.includes("tags")) {
				await tx.delete(taggings).where(eq(taggings.transactionId, entryId));

				if (next.tagIds.length > 0) {
					await tx
						.insert(taggings)
						.values(next.tagIds.map((tagId) => ({ transactionId: entryId, tagId })));
				}
			}

			if (touchesEntry) {
				await recomputeBalances(tx, account, minDate(current.date, next.date), deps.timeZone);
			}

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Step 3's write (AD-17): the survivor takes the line's date, amount, label
 * and notes, except the fields a user locked (`changeOf`), and its status;
 * its missed syncs start over, and the line's keys join the ones it has. The
 * old keys stay, so the bank sending the old pending line again finds a
 * booked entry and changes nothing. The id, the category, the merchant, the
 * tags, the transfer and the exclusion stay as they are, and rules do not run
 * again. Returns the earlier of the old and new dates, where balances move.
 */
async function absorb(
	tx: Transaction,
	survivorId: string,
	line: { line: NormalizedTransaction; keys: LineKeys },
	keyTarget: KeyTarget,
	origin: Origin,
	now: number,
): Promise<IsoDate> {
	const current = await transactionRow(tx, survivorId);
	const change = changeOf(
		current,
		{
			date: line.line.date,
			amount: line.line.amount,
			label: line.line.label,
			notes: line.line.notes,
		},
		origin,
	);
	const { next } = change;

	await tx
		.update(entries)
		.set({ date: next.date, amount: next.amount, updatedAt: now })
		.where(eq(entries.id, survivorId));
	await tx
		.update(transactions)
		.set({
			...detailOf(current, change, origin),
			pending: line.line.pending,
			pendingMissedSyncs: 0,
		})
		.where(eq(transactions.entryId, survivorId));
	await attachKeys(tx, current.accountId, keyTarget, [{ entryId: survivorId, keys: line.keys }], {
		keepExisting: true,
	});

	return minDate(current.date, next.date);
}

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

/**
 * Deletes transactions and every row that points at them, in the order their
 * foreign keys allow. Without its keys, a line comes back on re-import, as in
 * Sure; without its transfer, the other side is a standard transaction again.
 * The caller recomputes balances.
 */
async function deleteTransactionRows(tx: Transaction, ids: readonly string[]): Promise<void> {
	await tx.delete(entryKeys).where(inArray(entryKeys.entryId, ids));
	await tx.delete(transfers).where(transferOf(ids));
	await tx.delete(rejectedTransfers).where(rejectedOf(ids));
	await tx.delete(taggings).where(inArray(taggings.transactionId, ids));
	await tx.delete(transactions).where(inArray(transactions.entryId, ids));
	await tx.delete(entries).where(inArray(entries.id, ids));
}

/**
 * Counts a miss on every pending entry of the connection outside `seen`, and
 * deletes those reaching `MAX_MISSED_SYNCS` (AD-17). Returns the dates of the
 * deleted ones, where balances move.
 */
async function countMissedSyncs(
	tx: Transaction,
	accountId: string,
	connectionId: string,
	seen: ReadonlySet<string>,
): Promise<IsoDate[]> {
	const missed = (await pendingOfConnection(tx, accountId, connectionId)).filter(
		({ id }) => !seen.has(id),
	);
	const gone = missed.filter(({ missedSyncs }) => missedSyncs + 1 >= MAX_MISSED_SYNCS);
	const kept = missed.filter(({ missedSyncs }) => missedSyncs + 1 < MAX_MISSED_SYNCS);

	await inSequence(kept, KEYS_PER_LOOKUP, (chunk) =>
		tx
			.update(transactions)
			.set({ pendingMissedSyncs: sql`${transactions.pendingMissedSyncs} + 1` })
			.where(
				inArray(
					transactions.entryId,
					chunk.map(({ id }) => id),
				),
			),
	);
	await inSequence(gone, KEYS_PER_LOOKUP, (chunk) =>
		deleteTransactionRows(
			tx,
			chunk.map(({ id }) => id),
		),
	);

	return gone.map(({ date }) => date);
}

/**
 * Deletes a transaction for good, as Sure does, and recomputes its account's
 * balances from its date. The rows past the new end go with it.
 */
export async function deleteTransaction(
	deps: ServiceDeps,
	entryId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);

			await deleteTransactionRows(tx, [entryId]);
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * The rows a bulk action applies to: the given ids, or every transaction the
 * list's filter matches, across pages.
 */
export type BulkSelection = { ids: readonly string[] } | { filter: TransactionFilter };

/** What a bulk edit may change; an absent field is left as it is. */
export type BulkPatch = {
	/** `null` leaves the rows « Sans catégorie ». */
	categoryId?: string | null | undefined;
	/** `null` leaves the rows « Sans marchand ». */
	merchantId?: string | null | undefined;
	/** Added to each row's tags; a bulk edit never removes one. */
	addTagIds?: readonly string[] | undefined;
	excluded?: boolean | undefined;
};

/**
 * Resolves a selection to its rows once, before any write, so a write never
 * changes which rows match: « Sans catégorie », once categorised, would
 * otherwise lose the rows a later chunk still had to lock. An id naming no
 * transaction fails the call on `ids`.
 */
async function selectedRows(tx: Transaction, selection: BulkSelection) {
	const query = (where: SQL | undefined) =>
		tx
			.select({ id: entries.id, ...editableColumns, inTransfer: inAnyTransfer.mapWith(Boolean) })
			.from(entries)
			.innerJoin(transactions, eq(transactions.entryId, entries.id))
			.where(and(eq(entries.kind, "transaction"), where));

	if ("filter" in selection) {
		const where = filterCondition(selection.filter);

		return where === null ? [] : query(where);
	}

	const ids = [...new Set(selection.ids)];
	const rows: Awaited<ReturnType<typeof query>> = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(...(await query(inArray(entries.id, chunk))));
	});

	if (rows.length !== ids.length) {
		throw invalidField("ids");
	}

	return rows;
}

/**
 * Sets a category or a merchant, adds tags or changes the exclusion on every
 * selected row, all or nothing, and returns how many rows the selection
 * matched, unchanged ones included. Each row follows `updateTransaction`'s
 * rules through `changeOf`. An unknown category, merchant or tag, or a row
 * the new tags would carry past `MAX_TAGS_PER_TRANSACTION`, fails the call on
 * its `patch` field. Classification and exclusion move no balance, so nothing
 * is recomputed.
 */
export async function bulkUpdateTransactions(
	deps: ServiceDeps,
	selection: BulkSelection,
	patch: BulkPatch,
	options: { origin: Origin },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const { categoryId, merchantId, excluded } = patch;
			const added = patch.addTagIds === undefined ? undefined : [...new Set(patch.addTagIds)];

			if (
				categoryId !== undefined &&
				categoryId !== null &&
				!(await categoryExists(tx, categoryId))
			) {
				throw invalidField("patch.categoryId");
			}

			if (
				merchantId !== undefined &&
				merchantId !== null &&
				!(await merchantExists(tx, merchantId))
			) {
				throw invalidField("patch.merchantId");
			}

			if (added !== undefined && added.length > 0 && !(await tagsExist(tx, added))) {
				throw invalidField("patch.addTagIds");
			}

			const rows = await selectedRows(tx, selection);
			const tagsOf =
				added === undefined
					? new Map<string, string[]>()
					: await tagIdsByEntry(
							tx,
							rows.map((row) => row.id),
						);
			// Rows whose write is the same share one statement per chunk: the
			// classification is the same for all, only the locks already held differ.
			const writes = new Map<
				string,
				{ detail: Partial<typeof transactions.$inferInsert>; ids: string[] }
			>();
			const newTaggings: { transactionId: string; tagId: string }[] = [];

			for (const { id, inTransfer, ...row } of rows) {
				const current: EditableRow = { ...row, tagIds: tagsOf.get(id) ?? [] };
				const tagIds =
					added === undefined ? undefined : [...new Set([...current.tagIds, ...added])];

				if (tagIds !== undefined && tagIds.length > MAX_TAGS_PER_TRANSACTION) {
					throw invalidField("patch.addTagIds", "too_big");
				}

				const change = changeOf(
					current,
					// A transfer side has no category to set: it would stay hidden, and
					// come back unasked when the transfer is dissociated.
					{ categoryId: inTransfer ? undefined : categoryId, merchantId, excluded, tagIds },
					options.origin,
				);

				if (change.changed.length === 0) {
					continue;
				}

				const detail = detailOf(current, change, options.origin);
				const key = JSON.stringify(detail);
				const group = writes.get(key);

				if (group === undefined) {
					writes.set(key, { detail, ids: [id] });
				} else {
					group.ids.push(id);
				}

				if (change.changed.includes("tags")) {
					newTaggings.push(
						...change.next.tagIds
							.filter((tagId) => !current.tagIds.includes(tagId))
							.map((tagId) => ({ transactionId: id, tagId })),
					);
				}
			}

			const statements = [...writes.values()].flatMap(({ detail, ids }) =>
				chunksOf(ids, ROWS_PER_INSERT).map((chunk) => ({ detail, chunk })),
			);

			await oneByOne(statements, ({ detail, chunk }) =>
				tx.update(transactions).set(detail).where(inArray(transactions.entryId, chunk)),
			);
			await inSequence(newTaggings, ROWS_PER_INSERT, (chunk) => tx.insert(taggings).values(chunk));

			return rows.length;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes every selected transaction for good, all or nothing, as
 * `deleteTransaction` does one, and returns how many went. Recomputes each
 * affected account once, from its earliest deleted date, as `revertImport`
 * does.
 */
export async function bulkDeleteTransactions(
	deps: ServiceDeps,
	selection: BulkSelection,
	_options: { origin: Origin },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const rows = await selectedRows(tx, selection);
			const ids = rows.map((row) => row.id);
			const earliest = new Map<string, IsoDate>();

			for (const row of rows) {
				const known = earliest.get(row.accountId);
				earliest.set(row.accountId, known === undefined ? row.date : minDate(known, row.date));
			}

			// The same order as `deleteTransaction`: their foreign keys restrict
			// deleting the entry.
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(entryKeys).where(inArray(entryKeys.entryId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(taggings).where(inArray(taggings.transactionId, chunk)),
			);
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
			await oneByOne([...earliest], async ([accountId, date]) => {
				const account = await accountWithOpeningDate(tx, accountId);
				await recomputeBalances(tx, account, date, deps.timeZone);
			});

			return rows.length;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Moves every transaction of category `from` to `to`, or leaves them
 * uncategorised with `null`, and returns how many moved. Called by a
 * category's delete and merge with `origin: "maintenance"`: the user chose
 * the category, not each transaction, so `locked_fields` and
 * `category_origin` stay as they are (AD-10); only a row left without a
 * category loses its origin, which the database requires. No balance
 * changes, so nothing is recomputed. One statement, whatever the count: a
 * category can hold years of transactions.
 */
export async function recategorise(
	deps: ServiceDeps,
	from: string,
	to: string | null,
	// Maintenance only: a `user` call here would be expected to lock every
	// row it moves, and a category merge must not.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx
				.update(transactions)
				.set(to === null ? { categoryId: null, categoryOrigin: null } : { categoryId: to })
				.where(eq(transactions.categoryId, from));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/**
 * How many transactions each category holds, by category id. A category
 * absent from the map holds none. Counted in children and parents alike:
 * rolling children up into their parent is the reports' business (Epic 6).
 */
export async function countByCategory(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({
			// Never null: the `where` below leaves uncategorised rows out.
			categoryId: sql<string>`${transactions.categoryId}`,
			count: count(),
		})
		.from(transactions)
		.where(isNotNull(transactions.categoryId))
		.groupBy(transactions.categoryId);

	return new Map(rows.map((row) => [row.categoryId, row.count]));
}

/**
 * Moves every transaction of merchant `from` to `to`, or unlinks them with
 * `null`, and returns how many moved. Serves a merchant's merge and delete
 * with `origin: "maintenance"`: the user chose the merchant, not each
 * transaction, so `locked_fields` stay as they are (AD-10). One statement,
 * whatever the count, as `recategorise`.
 */
export async function moveMerchant(
	deps: ServiceDeps,
	from: string,
	to: string | null,
	// Maintenance only, for the same reason as `recategorise`.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx
				.update(transactions)
				.set({ merchantId: to })
				.where(eq(transactions.merchantId, from));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/** How many transactions each merchant holds, by merchant id; absent holds none. */
export async function countByMerchant(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({
			// Never null: the `where` below leaves rows without a merchant out.
			merchantId: sql<string>`${transactions.merchantId}`,
			count: count(),
		})
		.from(transactions)
		.where(isNotNull(transactions.merchantId))
		.groupBy(transactions.merchantId);

	return new Map(rows.map((row) => [row.merchantId, row.count]));
}

/**
 * Removes a tag from every transaction that carries it and returns how many
 * lost it. Serves a tag's delete with `origin: "maintenance"`: the user chose
 * the tag, not each transaction, so `locked_fields` stay as they are (AD-10).
 */
export async function removeTag(
	deps: ServiceDeps,
	tagId: string,
	// Maintenance only, for the same reason as `recategorise`.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx.delete(taggings).where(eq(taggings.tagId, tagId));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/** How many transactions each tag marks, by tag id; absent marks none. */
export async function countByTag(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({ tagId: taggings.tagId, count: count() })
		.from(taggings)
		.groupBy(taggings.tagId);

	return new Map(rows.map((row) => [row.tagId, row.count]));
}

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

export type RevertResult = { accountId: string; removed: Removable };

/**
 * Undoes a confirmed import, in one transaction (AD-7): deletes the keys it
 * wrote, the transactions it created that no other source holds, edited ones
 * included as Sure deletes every entry of an import, and the snapshot it still
 * owns. When the import moved the opening anchor, its date stays, as Sure
 * never moves it back, and its amount gets back what the deleted lines had
 * shifted it by. Then marks the import `reverted` and recomputes. The `imports` row stays, for the history.
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

			// 4. The opening anchor keeps the date this import gave it. `ingest`
			// shifted its amount by the lines dated on or before the old opening
			// date so that day kept its balance; the deleted ones give their share
			// back, the kept ones and a later import's keep theirs.
			const previousDate = row.previousOpeningDate;
			const givenBack =
				previousDate === null ? [] : created.filter((entry) => entry.date <= previousDate);

			if (givenBack.length > 0) {
				const shift = givenBack.reduce((total, entry) => total + entry.amount, 0);

				await tx
					.update(entries)
					.set({
						amount: toMinorUnits(
							classificationOf(account.type) === "asset"
								? account.openingBalance + shift
								: account.openingBalance - shift,
						),
						updatedAt: now,
					})
					.where(eq(entries.id, account.openingId));
			}

			// 5.
			await tx
				.update(imports)
				.set({ status: "reverted", revertedAt: now })
				.where(eq(imports.id, importId));

			// 6. From the earliest date touched, the anchor's when its amount changed.
			const [earliest] = [
				...[...created, ...snapshots].map((entry) => entry.date),
				...(givenBack.length > 0 ? [account.openingDate] : []),
			].toSorted();

			if (earliest !== undefined) {
				await recomputeBalances(tx, account, earliest, deps.timeZone);
			}

			return {
				accountId: account.id,
				removed: { transactions: created.length, snapshot: snapshots.length },
			};
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes an account and everything it holds, as one write: its entries'
 * keys, its transactions' taggings, transfers and rejected pairs, its
 * transactions, all its entries, snapshots and opening anchor included, its
 * daily balances, its imports, then the account. Children go first, since
 * their foreign keys restrict. A transfer's other side, on another account,
 * stays as a standard transaction, as Sure's `cleanup_transfers` leaves it.
 * Every delete selects by `account_id` through a subquery, never a list of
 * ids, so a history of 50,000 transactions binds one parameter, not 50,000.
 */
export async function deleteAccount(
	deps: ServiceDeps,
	accountId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			await accountWithOpeningDate(tx, accountId);

			await tx.delete(entryKeys).where(eq(entryKeys.accountId, accountId));
			await tx
				.delete(taggings)
				.where(
					inArray(
						taggings.transactionId,
						tx.select({ id: entries.id }).from(entries).where(eq(entries.accountId, accountId)),
					),
				);
			await tx
				.delete(transfers)
				.where(
					transferOf(
						tx.select({ id: entries.id }).from(entries).where(eq(entries.accountId, accountId)),
					),
				);
			await tx
				.delete(rejectedTransfers)
				.where(
					rejectedOf(
						tx.select({ id: entries.id }).from(entries).where(eq(entries.accountId, accountId)),
					),
				);
			await tx
				.delete(transactions)
				.where(
					inArray(
						transactions.entryId,
						tx.select({ id: entries.id }).from(entries).where(eq(entries.accountId, accountId)),
					),
				);
			await tx.delete(entries).where(eq(entries.accountId, accountId));
			await tx.delete(balances).where(eq(balances.accountId, accountId));
			await tx.delete(imports).where(eq(imports.accountId, accountId));
			await tx.delete(accounts).where(eq(accounts.id, accountId));
		},
		{ behavior: "immediate" },
	);
}

/**
 * The balance at the end of `date`: the last stored day on or before it (AD-8).
 * `null` before the account's opening date, when it did not exist yet.
 */
export async function balanceOn(
	deps: ServiceDeps,
	accountId: string,
	date: IsoDate,
): Promise<Money | null> {
	const row = await lastBalanceOnOrBefore(deps.db, accountId, date);

	return row === undefined ? null : { amount: toMinorUnits(row.balance), currency: row.currency };
}

/**
 * The end-of-day balance of every day from `from` to `to`, both included,
 * oldest first, as `balanceOn` would read each one (AD-8). Stored rows stop at
 * the last write's end, so the days after it carry its balance. Days before
 * the opening date are left out. One primary-key range scan plus one lookup.
 */
export async function balancesBetween(
	deps: ServiceDeps,
	accountId: string,
	from: IsoDate,
	to: IsoDate,
): Promise<DailyBalance[]> {
	const previous = await lastBalanceOnOrBefore(deps.db, accountId, from);
	const rows = await deps.db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), gt(balances.date, from), lte(balances.date, to)))
		.orderBy(balances.date);
	const known = previous === undefined ? rows : [previous, ...rows];

	return fillDays(
		known.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
		from,
		to,
	);
}

/** The date of the account's opening anchor, `null` for an unknown account. */
export async function openingDateOf(deps: ServiceDeps, accountId: string): Promise<IsoDate | null> {
	const row = await deps.db
		.select({ date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "opening_anchor")))
		.get();

	return row?.date ?? null;
}

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

/** Whether the transaction `id` names is already the outflow or the inflow of a transfer. */
function inTransferSql(id: SQLWrapper): SQL {
	return sql`exists (select 1 from ${transfers} where ${transfers.outflowTransactionId} = ${id} or ${transfers.inflowTransactionId} = ${id})`;
}

const inAnyTransfer = inTransferSql(entries.id);

/** Whether the user refused `a` and `b` as one transfer, whichever side each was. */
function isRejectedPair(a: SQLWrapper, b: SQLWrapper): SQL {
	return sql`exists (select 1 from ${rejectedTransfers} where (${rejectedTransfers.outflowTransactionId} = ${a} and ${rejectedTransfers.inflowTransactionId} = ${b}) or (${rejectedTransfers.outflowTransactionId} = ${b} and ${rejectedTransfers.inflowTransactionId} = ${a}))`;
}

/** The rejected pairs `ids` sit in, on either side; `ids` may be a subquery. */
function rejectedOf(ids: readonly string[] | SQLWrapper): SQL | undefined {
	return or(
		inArray(rejectedTransfers.outflowTransactionId, ids),
		inArray(rejectedTransfers.inflowTransactionId, ids),
	);
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
 * One condition serves the picker, `matchTransfer`'s re-check, step 6 of
 * `ingest` and the list's suggestion, so none of them can offer a pair
 * another refuses.
 */
function candidateOf(source: SideRef, candidate: SideRef): SQL | undefined {
	return and(
		eq(source.kind, "transaction"),
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

const sideColumns = {
	id: entries.id,
	kind: entries.kind,
	accountId: entries.accountId,
	accountType: accounts.type,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	inTransfer: inAnyTransfer.mapWith(Boolean),
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
		.innerJoin(sourceAccount, eq(sourceAccount.id, sourceEntry.accountId))
		.innerJoin(sourceTransaction, eq(sourceTransaction.entryId, sourceEntry.id))
		.innerJoin(entries, candidateOf(sourceEntry, entries))
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(
			and(
				inArray(sourceEntry.id, [...sourceIds]),
				counterpartId === undefined ? undefined : eq(entries.id, counterpartId),
			),
		)
		.orderBy(entries.date, entries.createdAt, entries.id);
}

type CandidatePair = Awaited<ReturnType<typeof candidatePairQuery>>[number];

/**
 * Every candidate of each of `sourceIds`, 500 sources per query, ordered by
 * date, then the older entry. SQL narrows them with `candidateOf`;
 * `isTransferCandidate` then has the last word. `counterpartId` keeps that
 * one candidate only.
 */
async function candidatePairs(
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
async function matchNewTransfers(
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
 * already matched or rejected included.
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

/**
 * Deletes a transfer, both sides becoming standard transactions again, their
 * category, locks and tags as they were. Throws `NOT_FOUND` for an unknown id.
 */
export async function unmatchTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const deleted = await tx
				.delete(transfers)
				.where(eq(transfers.id, transferId))
				.returning({ id: transfers.id });

			if (deleted.length === 0) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}
		},
		{ behavior: "immediate" },
	);
}

/**
 * Undoes a transfer, as `unmatchTransfer`, and records its pair so that no
 * candidate search, by hand or automatic, offers it again. There is no way
 * back: the pair stays refused until one side is deleted. Throws `NOT_FOUND`
 * for an unknown id.
 */
export async function rejectTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const [deleted] = await tx.delete(transfers).where(eq(transfers.id, transferId)).returning({
				outflowTransactionId: transfers.outflowTransactionId,
				inflowTransactionId: transfers.inflowTransactionId,
			});

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			await tx.insert(rejectedTransfers).values({
				id: crypto.randomUUID(),
				...deleted,
				createdAt: Date.now(),
			});
		},
		{ behavior: "immediate" },
	);
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

export type TransactionRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
	/** A cheque or QIF `N` number from the import that created it. */
	reference: string | null;
	/** Left out of reports (AD-9), still counted in the balance. */
	excluded: boolean;
	/** Not booked by the bank yet: counted in the balance, left out of cash flow (AD-8, AD-9). */
	pending: boolean;
	/** `null` is « Sans catégorie ». */
	categoryId: string | null;
	/** `null` is « Sans marchand ». */
	merchantId: string | null;
	/** Sorted by id; the interface sorts the names. */
	tagIds: string[];
	/** The transfer it is a side of, with the other side's account. */
	transfer: TransferLink | null;
	/**
	 * In no transfer, with at least `SUGGESTION_THRESHOLD` candidates: automatic
	 * matching left it for the user to pick.
	 */
	transferSuggested: boolean;
	/**
	 * Created by an import or a sync that found two entries equally near it
	 * (AD-7), until the user merges or dismisses it.
	 */
	possibleDuplicate: boolean;
};

/**
 * A transaction's transfer as its row shows it. Which side it is follows from
 * its amount: the outflow is the negative one.
 */
export type TransferLink = {
	id: string;
	kind: TransferKind;
	counterpartAccountId: string;
	counterpartAccountName: string;
};

/** A transaction as a list shows it, with its account's name. */
export type TransactionListRecord = TransactionRecord & { accountName: string };

const transactionColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
	reference: transactions.reference,
	excluded: transactions.excluded,
	pending: transactions.pending,
	possibleDuplicate: transactions.possibleDuplicate,
	categoryId: transactions.categoryId,
	merchantId: transactions.merchantId,
};

function toRecord<Row extends { amount: number }>(row: Row): Row & { amount: MinorUnits } {
	return { ...row, amount: toMinorUnits(row.amount) };
}

// A row is the outflow of at most one transfer and the inflow of at most one,
// so a left join on each unique index never repeats it.
const asOutflow = alias(transfers, "as_outflow");
const asInflow = alias(transfers, "as_inflow");
const counterpartEntry = alias(entries, "counterpart_entry");
const counterpartAccount = alias(accounts, "counterpart_account");

const counterpartIdOf = sql`coalesce(${asOutflow.inflowTransactionId}, ${asInflow.outflowTransactionId})`;

const transferColumns = {
	transferId: sql<string | null>`coalesce(${asOutflow.id}, ${asInflow.id})`,
	transferKind: sql<TransferKind | null>`coalesce(${asOutflow.kind}, ${asInflow.kind})`,
	counterpartAccountId: counterpartAccount.id,
	counterpartAccountName: counterpartAccount.name,
};

type TransferColumns = {
	transferId: string | null;
	transferKind: TransferKind | null;
	counterpartAccountId: string | null;
	counterpartAccountName: string | null;
};

/**
 * How many candidates make a suggestion. Two, as the epic says: a pair unlinked
 * with « Dissocier » has one candidate, and flagging it would undo the unlink.
 */
const SUGGESTION_THRESHOLD = 2;

/**
 * The rows of `entryIds` with at least `SUGGESTION_THRESHOLD` candidates, by
 * the search the picker and step 6 use, `isTransferCandidate` included, so the
 * flag never disagrees with them. Read after the page query, for its rows in
 * no transfer only: a subquery in the page's select would run for every row
 * the filter keeps whenever the sort is not index-covered.
 */
async function suggestedAmong(
	db: Pick<Transaction, "select">,
	entryIds: readonly string[],
): Promise<Set<string>> {
	const counts = new Map<string, number>();

	for (const { source } of await candidatePairs(db, entryIds)) {
		counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
	}

	return new Set(
		[...counts].filter(([, total]) => total >= SUGGESTION_THRESHOLD).map(([id]) => id),
	);
}

/** The ids of `rows` in no transfer, the only ones a suggestion is read for. */
const unmatchedIds = (rows: readonly { id: string; transferId: string | null }[]) =>
	rows.filter((row) => row.transferId === null).map((row) => row.id);

/** Folds the transfer columns of a row into its `transfer`. */
function withTransferLink<Row extends TransferColumns>(
	row: Row,
): Omit<Row, keyof TransferColumns> & { transfer: TransferLink | null } {
	const { transferId, transferKind, counterpartAccountId, counterpartAccountName, ...rest } = row;

	return {
		...rest,
		transfer:
			transferId === null ||
			transferKind === null ||
			counterpartAccountId === null ||
			counterpartAccountName === null
				? null
				: { id: transferId, kind: transferKind, counterpartAccountId, counterpartAccountName },
	};
}

/**
 * Where a keyed entry came from: a file import, `confirmedAt` in epoch
 * milliseconds, or a bank connector.
 */
export type EntryOrigin =
	| { kind: "import"; source: FileSourceId; confirmedAt: number | null }
	| { kind: "bank"; connector: BankConnectorId };

/**
 * The origin of each of `entryIds` that has keys; manual entries are absent.
 * A bank's key wins over a file's: an entry a sync paired with is fed by the
 * bank from then on.
 */
export async function entryOrigins(
	deps: ServiceDeps,
	entryIds: readonly string[],
): Promise<Map<string, EntryOrigin>> {
	const found = new Map<string, EntryOrigin>();

	await inSequence(entryIds, KEYS_PER_LOOKUP, async (chunk) => {
		const imported = await deps.db
			.selectDistinct({
				entryId: entryKeys.entryId,
				source: imports.source,
				confirmedAt: imports.confirmedAt,
			})
			.from(entryKeys)
			.innerJoin(imports, eq(imports.id, entryKeys.importId))
			.where(inArray(entryKeys.entryId, chunk));
		const synced = await deps.db
			.selectDistinct({
				entryId: entryKeys.entryId,
				// Narrowed by the `where` below, which the column type cannot see.
				connector: sql<BankConnectorId>`${entryKeys.source}`,
			})
			.from(entryKeys)
			.where(and(inArray(entryKeys.entryId, chunk), inArray(entryKeys.source, BANK_CONNECTOR_IDS)));

		for (const { entryId, ...origin } of imported) {
			found.set(entryId, { kind: "import", ...origin });
		}

		for (const { entryId, connector } of synced) {
			found.set(entryId, { kind: "bank", connector });
		}
	});

	return found;
}

/** One transaction, `null` when the id names none. */
export async function findTransaction(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransactionRecord | null> {
	const row = await deps.db
		.select({ ...transactionColumns, ...transferColumns })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, counterpartIdOf))
		.leftJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		return null;
	}

	const suggested = await suggestedAmong(deps.db, unmatchedIds([row]));

	return {
		...withTransferLink(toRecord(row)),
		tagIds: await tagIdsOf(deps.db, entryId),
		transferSuggested: suggested.has(entryId),
	};
}

/**
 * The tags of each of `entryIds`, one query for a page rather than a join that
 * would repeat a row once per tag.
 */
async function tagIdsByEntry(
	db: Pick<Transaction, "select">,
	entryIds: readonly string[],
): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();

	await inSequence(entryIds, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await db
			.select({ transactionId: taggings.transactionId, tagId: taggings.tagId })
			.from(taggings)
			.where(inArray(taggings.transactionId, chunk))
			.orderBy(taggings.tagId);

		for (const row of rows) {
			found.set(row.transactionId, [...(found.get(row.transactionId) ?? []), row.tagId]);
		}
	});

	return found;
}

/**
 * What narrows a transaction list. Every field is optional; an empty filter
 * lists every transaction of every account.
 */
export type TransactionFilter = {
	accountIds?: readonly string[] | undefined;
	/** Inclusive. */
	from?: IsoDate | undefined;
	/** Inclusive. */
	to?: IsoDate | undefined;
	/**
	 * Absolute-value bounds per currency, computed by `amountBoundsFor`. When
	 * set, a transaction in a currency the list leaves out matches nothing.
	 */
	amounts?: readonly ({ currency: string } & AmountRange)[] | undefined;
	/**
	 * Substring of the label or the notes, matched literally. Case is ignored
	 * for ASCII letters only, as SQLite's `LIKE` does: « électricité » does not
	 * find « Électricité ».
	 */
	q?: string | undefined;
	/**
	 * Categories matched as given, without their children: the caller expands
	 * a parent. Ored with `uncategorised`; an unknown id matches nothing.
	 */
	categoryIds?: readonly string[] | undefined;
	/** Also match transactions without a category. */
	uncategorised?: boolean | undefined;
	/** Merchants, ORed; an unknown id matches nothing, an empty list nothing at all. */
	merchantIds?: readonly string[] | undefined;
	/** Tags, ORed; a row carrying several still matches once. */
	tagIds?: readonly string[] | undefined;
	/** Income, expense or transfer as `direction` decides, ORed. */
	direction?: readonly Direction[] | undefined;
};

/** Whether the filter reads `transactions`, so the count and the sum must join it. */
function needsTransactionColumns(filter: TransactionFilter): boolean {
	return (
		filter.q !== undefined ||
		filter.categoryIds !== undefined ||
		filter.uncategorised === true ||
		filter.merchantIds !== undefined
	);
}

function categoryCondition(filter: TransactionFilter): SQL | undefined | null {
	const { categoryIds, uncategorised = false } = filter;

	if (categoryIds === undefined && !uncategorised) {
		return undefined;
	}

	const ids = categoryIds ?? [];

	if (ids.length === 0 && !uncategorised) {
		return null;
	}

	return or(
		ids.length === 0 ? undefined : inArray(transactions.categoryId, [...ids]),
		// A transfer side shows no category, so it is not « Sans catégorie »
		// either, as Sure's `uncategorized_condition` leaves transfers out. The
		// outflows of `EXPENSE_TRANSFER_KINDS`, loan payments and investment
		// contributions, are the exception: the dashboard counts them as
		// uncategorised expenses, so its drill-down must list them.
		uncategorised ? and(isNull(transactions.categoryId), not(isTransferSide)) : undefined,
	);
}

function absoluteAmountIn(range: AmountRange): SQL | undefined {
	const min = range.min === null ? null : Number(range.min);
	const max = range.max === null ? null : Number(range.max);

	if (min !== null && max !== null) {
		return or(between(entries.amount, min, max), between(entries.amount, -max, -min));
	}

	if (min !== null) {
		return or(gte(entries.amount, min), lte(entries.amount, -min));
	}

	return max === null ? undefined : between(entries.amount, -max, max);
}

// `LIKE` rather than FTS5 until the 300 ms target of Story 1.5 fails. Drizzle's
// `like` has no `escape` clause, and without one `50%` would find `Remise 500`.
function contains(column: typeof transactions.label | typeof transactions.notes, q: string): SQL {
	return sql`${column} like ${`%${escapeLike(q)}%`} escape ${LIKE_ESCAPE}`;
}

/**
 * The SQL twin of `direction` in `domain/cash-flow.ts`, built from the same
 * `EXPENSE_TRANSFER_KINDS`; the ledger's parity test keeps the two in step. It
 * lives here because only the ledger reads the money tables. `exists` rather
 * than a join, so the count and the sum need no join either.
 */
const isTransferSide = sql`exists (select 1 from ${transfers} where ${transfers.inflowTransactionId} = ${entries.id} or (${transfers.outflowTransactionId} = ${entries.id} and ${notInArray(transfers.kind, [...EXPENSE_TRANSFER_KINDS])}))`;

const DIRECTION_CONDITIONS: Record<Direction, SQL | undefined> = {
	income: and(not(isTransferSide), gt(entries.amount, 0)),
	expense: and(not(isTransferSide), lte(entries.amount, 0)),
	transfer: isTransferSide,
};

/**
 * The where clause of a filter, `null` when it can match nothing at all, so
 * the caller skips the query rather than asking SQLite for an empty `or`.
 */
function filterCondition(filter: TransactionFilter): SQL | undefined | null {
	const { accountIds, amounts, q, merchantIds, tagIds, direction } = filter;
	const category = categoryCondition(filter);

	if (
		accountIds?.length === 0 ||
		amounts?.length === 0 ||
		merchantIds?.length === 0 ||
		tagIds?.length === 0 ||
		direction?.length === 0 ||
		category === null
	) {
		return null;
	}

	return and(
		eq(entries.kind, "transaction"),
		accountIds === undefined ? undefined : inArray(entries.accountId, [...accountIds]),
		filter.from === undefined ? undefined : gte(entries.date, filter.from),
		filter.to === undefined ? undefined : lte(entries.date, filter.to),
		amounts === undefined
			? undefined
			: or(
					...amounts.map((range) =>
						and(eq(entries.currency, range.currency), absoluteAmountIn(range)),
					),
				),
		q === undefined
			? undefined
			: or(contains(transactions.label, q), contains(transactions.notes, q)),
		category,
		merchantIds === undefined ? undefined : inArray(transactions.merchantId, [...merchantIds]),
		// `exists` rather than a join: a row with two of the tags would be listed,
		// counted and summed twice.
		tagIds === undefined
			? undefined
			: sql`exists (select 1 from ${taggings} where ${taggings.transactionId} = ${entries.id} and ${inArray(taggings.tagId, [...tagIds])})`,
		direction === undefined
			? undefined
			: or(...[...new Set(direction)].map((value) => DIRECTION_CONDITIONS[value])),
	);
}

/**
 * A page of transactions matching `filter`, most recent first (AD-15), each
 * with its account's name. The count joins `transactions` only when the text
 * search or the category or merchant filter needs its columns, so the unfiltered count
 * reads one index.
 */
export async function listTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
	page: { page: number; pageSize: number },
): Promise<{ items: TransactionListRecord[]; total: number }> {
	const where = filterCondition(filter);

	if (where === null) {
		return { items: [], total: 0 };
	}

	const rows = await deps.db
		.select({
			...transactionColumns,
			...transferColumns,
			accountName: accounts.name,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, counterpartIdOf))
		.leftJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId))
		.where(where)
		// A pending row sits at the top of its day: the bank has not settled it yet.
		.orderBy(
			desc(entries.date),
			desc(transactions.pending),
			desc(entries.createdAt),
			desc(entries.id),
		)
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = !needsTransactionColumns(filter)
		? await deps.db.select({ total: count() }).from(entries).where(where)
		: await deps.db
				.select({ total: count() })
				.from(entries)
				.innerJoin(transactions, eq(transactions.entryId, entries.id))
				.where(where);

	const tagsOf = await tagIdsByEntry(
		deps.db,
		rows.map((row) => row.id),
	);
	const suggested = await suggestedAmong(deps.db, unmatchedIds(rows));

	return {
		items: rows.map((row) => ({
			...withTransferLink(toRecord(row)),
			tagIds: tagsOf.get(row.id) ?? [],
			transferSuggested: suggested.has(row.id),
		})),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}

/**
 * The signed sum and the count of the transactions matching `filter`, one row
 * per currency. Excluded transactions count: the sum describes the rows the
 * list shows, not a report. Joins `transactions` only for the text search and
 * the category and merchant filters, as the count does.
 */
export async function sumTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
): Promise<{ currency: string; amount: MinorUnits; count: number }[]> {
	const where = filterCondition(filter);

	if (where === null) {
		return [];
	}

	const columns = {
		currency: entries.currency,
		amount: sum(entries.amount).mapWith(Number),
		count: count(),
	};
	const rows = !needsTransactionColumns(filter)
		? await deps.db
				.select(columns)
				.from(entries)
				.where(where)
				.groupBy(entries.currency)
				.orderBy(entries.currency)
		: await deps.db
				.select(columns)
				.from(entries)
				.innerJoin(transactions, eq(transactions.entryId, entries.id))
				.where(where)
				.groupBy(entries.currency)
				.orderBy(entries.currency);

	return rows.map(toRecord);
}

/**
 * The counted transactions of `accountIds` between `from` and `to`, both
 * inclusive, summed per category and per sign: `countsInCashFlow`'s SQL
 * twin, tied to it by a parity test. Uncategorised rows keep their two signs
 * apart, since « Sans catégorie » splits into income and expenses; a
 * category's two signs meet again in `cashFlowBreakdown`. The currency is the
 * caller's to settle through `accountIds`.
 */
export async function cashFlowByCategory(
	deps: ServiceDeps,
	range: { from: IsoDate; to: IsoDate; accountIds: readonly string[] },
): Promise<CashFlowRow[]> {
	const where = filterCondition({ ...range, direction: ["income", "expense"] });

	if (where === null) {
		return [];
	}

	const rows = await deps.db
		.select({
			categoryId: transactions.categoryId,
			amount: sum(entries.amount).mapWith(Number),
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(and(where, eq(transactions.excluded, false), eq(transactions.pending, false)))
		.groupBy(transactions.categoryId, sql`${entries.amount} > 0`);

	return rows.map(toRecord);
}

export type SnapshotInput = {
	date: IsoDate;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	balance: MinorUnits;
};

/** An absent or `undefined` field is left as it is. */
export type SnapshotPatch = {
	date?: IsoDate | undefined;
	balance?: MinorUnits | undefined;
};

export type RecordSnapshotResult =
	| { status: "recorded"; id: string }
	| { status: "rejected"; reason: SnapshotRejectionCode };

export type SnapshotUpdateResult =
	| { status: "updated" }
	| { status: "rejected"; reason: SnapshotRejectionCode };

function snapshotRejection(
	account: { openingDate: IsoDate },
	date: IsoDate,
	timeZone: string,
): SnapshotRejectionCode | null {
	return snapshotRejectionFor(date, { openingDate: account.openingDate, today: today(timeZone) });
}

/** The account's snapshot on `date`, other than `except`, if any. */
async function snapshotOn(tx: Transaction, accountId: string, date: IsoDate, except?: string) {
	return tx
		.select({ id: entries.id, balance: entries.amount, importId: entries.importId })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.valuationKind, "reconciliation"),
				eq(entries.date, date),
				except === undefined ? undefined : ne(entries.id, except),
			),
		)
		.get();
}

async function snapshotRow(tx: Transaction, id: string) {
	const row = await tx
		.select({ accountId: entries.accountId, date: entries.date, balance: entries.amount })
		.from(entries)
		.where(and(eq(entries.id, id), eq(entries.valuationKind, "reconciliation")))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No snapshot has this id.");
	}

	return row;
}

/**
 * Records the balance the bank shows at the end of `date`, a `reconciliation`
 * valuation (AD-8), and recomputes the balances from that day. A snapshot
 * already on that date is updated in place and keeps its id, as in Sure's
 * `Account::ReconciliationManager`.
 */
export async function recordSnapshot(
	deps: ServiceDeps,
	accountId: string,
	input: SnapshotInput,
	_options: { origin: Origin },
): Promise<RecordSnapshotResult> {
	return deps.db.transaction(
		async (tx): Promise<RecordSnapshotResult> => {
			const account = await accountWithOpeningDate(tx, accountId);
			const reason = snapshotRejection(account, input.date, deps.timeZone);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			const now = Date.now();
			const existing = (await snapshotOn(tx, accountId, input.date))?.id;
			const id = existing ?? crypto.randomUUID();

			if (existing === undefined) {
				await tx.insert(entries).values({
					id,
					accountId,
					kind: "valuation",
					valuationKind: "reconciliation",
					date: input.date,
					amount: input.balance,
					currency: account.currency,
					createdAt: now,
					updatedAt: now,
				});
			} else {
				// The user's value now: later imports keep it, and reverting the
				// import that wrote it leaves it.
				await tx
					.update(entries)
					.set({ amount: input.balance, importId: null, updatedAt: now })
					.where(eq(entries.id, existing));
			}

			await recomputeBalances(tx, account, input.date, deps.timeZone);

			return { status: "recorded", id };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Moves or changes a snapshot and recomputes from the earlier of its old and
 * new dates. Moving it onto a date another snapshot holds is refused: an edit
 * never deletes a second snapshot behind the user's back.
 */
export async function updateSnapshot(
	deps: ServiceDeps,
	id: string,
	patch: SnapshotPatch,
	_options: { origin: Origin },
): Promise<SnapshotUpdateResult> {
	return deps.db.transaction(
		async (tx): Promise<SnapshotUpdateResult> => {
			const current = await snapshotRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const date = patch.date ?? current.date;
			const balance = patch.balance ?? current.balance;
			const reason = snapshotRejection(account, date, deps.timeZone);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			if ((await snapshotOn(tx, account.id, date, id)) !== undefined) {
				return { status: "rejected", reason: "SNAPSHOT_EXISTS" };
			}

			// As in `recordSnapshot`, an edited snapshot is the user's.
			await tx
				.update(entries)
				.set({ date, amount: balance, importId: null, updatedAt: Date.now() })
				.where(eq(entries.id, id));
			await recomputeBalances(tx, account, minDate(current.date, date), deps.timeZone);

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
}

/** Deletes a snapshot; the balances from its date follow the transactions again. */
export async function deleteSnapshot(
	deps: ServiceDeps,
	id: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await snapshotRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);

			await tx.delete(entries).where(eq(entries.id, id));
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

export type SnapshotRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	/** The recorded stored balance (AD-5). */
	balance: MinorUnits;
	/** The balance the transactions alone give for that day. */
	computed: MinorUnits;
	/** `balance - computed`, derived here and never stored. */
	gap: MinorUnits;
	currency: string;
};

const snapshotColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	balance: entries.amount,
	currency: entries.currency,
	type: accounts.type,
};

type SnapshotRow = {
	id: string;
	accountId: string;
	date: string;
	balance: number;
	currency: string;
	type: AccountType;
};

/**
 * Reads what `computed` and `gap` need for snapshots of one account on
 * `dates`: one query for the balances of the days before, one for those days'
 * movements, whatever the number of rows. Returns the function adding them to
 * a row.
 */
async function gapReader(db: ServiceDeps["db"], accountId: string, dates: readonly IsoDate[]) {
	// A linked account derives each day before its bank balance from the day
	// after: the gap is read against that day, since the day before is itself
	// derived from the snapshot and would always agree with it.
	const anchor = await backwardAnchor(db, accountId);
	const nextDays = dates.map((date) => addDays(date, 1));
	const balanceRows = await db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(
			and(
				eq(balances.accountId, accountId),
				inArray(balances.date, [...dates.map((date) => addDays(date, -1)), ...nextDays]),
			),
		);
	const movementRows = await db
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.kind, "transaction"),
				inArray(entries.date, [...dates, ...nextDays]),
			),
		)
		.groupBy(entries.date);
	const stored = new Map(balanceRows.map((row) => [row.date, row.balance]));
	const movements = new Map(movementRows.map((row) => [row.date, row.amount]));

	return ({ type, ...row }: SnapshotRow): SnapshotRecord => {
		const backward = anchor !== undefined && row.date < anchor.date;
		const neighbour = addDays(row.date, backward ? 1 : -1);
		const known = stored.get(neighbour);

		// Balances are written from the opening date on, and a snapshot is dated
		// after it and not after today, so the neighbouring day always has a
		// row; a missing one is a bug.
		if (known === undefined) {
			throw new AppError("INTERNAL_ERROR", "Something went wrong.");
		}

		const balance = toMinorUnits(row.balance);
		const classification = classificationOf(type);

		return {
			...row,
			balance,
			...(backward
				? snapshotGapBackward({
						next: toMinorUnits(known),
						nextMovements: toMinorUnits(movements.get(neighbour) ?? 0),
						recorded: balance,
						classification,
					})
				: snapshotGap({
						previous: toMinorUnits(known),
						movements: toMinorUnits(movements.get(row.date) ?? 0),
						recorded: balance,
						classification,
					})),
		};
	};
}

/** One snapshot with its gap, `null` when the id names none. */
export async function findSnapshot(deps: ServiceDeps, id: string): Promise<SnapshotRecord | null> {
	const row = await deps.db
		.select(snapshotColumns)
		.from(entries)
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(and(eq(entries.id, id), eq(entries.valuationKind, "reconciliation")))
		.get();

	if (row === undefined) {
		return null;
	}

	const withGap = await gapReader(deps.db, row.accountId, [row.date]);

	return withGap(row);
}

/**
 * The date of the account's oldest pending transaction carrying a key of the
 * connection, `null` when it has none. Scoped as `countMissedSyncs` is: an
 * entry whose connection is gone would otherwise hold the window back forever.
 */
export async function oldestPendingDate(
	deps: Pick<ServiceDeps, "db">,
	accountId: string,
	connectionId: string,
): Promise<IsoDate | null> {
	const row = await deps.db
		.select({ date: entries.date })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(transactions.pending, true),
				exists(
					deps.db
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(
							and(eq(entryKeys.entryId, entries.id), eq(entryKeys.connectionId, connectionId)),
						),
				),
			),
		)
		.orderBy(entries.date)
		.limit(1)
		.get();

	return row?.date ?? null;
}

/** A page of an account's snapshots with their gaps, most recent first (AD-15). */
export async function listSnapshots(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<{ items: SnapshotRecord[]; total: number }> {
	const where = and(eq(entries.accountId, accountId), eq(entries.valuationKind, "reconciliation"));
	const rows = await deps.db
		.select(snapshotColumns)
		.from(entries)
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(entries).where(where);
	const withGap = await gapReader(
		deps.db,
		accountId,
		rows.map((row) => row.date),
	);

	return {
		items: rows.map(withGap),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}
