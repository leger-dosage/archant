import type { DailyBalance } from "../domain/balances/forward.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { NormalizedTransaction, ParsedStatement, RejectionCode } from "../domain/statement.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, count, desc, eq, gt, gte, inArray, lte, or, sum } from "drizzle-orm";

import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits, Money } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";
import type { Account, NewBalance } from "@archant/data/types";

import { forwardBalances } from "../domain/balances/forward.ts";
import { fillDays } from "../domain/balances/history.ts";
import { addDays, maxDate, minDate, today } from "../domain/dates.ts";
import { rejectionFor } from "../domain/statement.ts";
import { AppError } from "../lib/errors.ts";

/** Who asked for a write (AD-2). Only `user` locks fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

export type NewAccountInput = {
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: CurrencyCode;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	openingBalance: MinorUnits;
	openingDate: IsoDate;
};

type Transaction = Parameters<Parameters<ServiceDeps["db"]["transaction"]>[0]>[0];

// SQLite caps bound parameters per statement at 32 766; four columns per row
// keeps a chunk far below it, and a decade of history is 3 650 rows.
const BALANCE_ROWS_PER_INSERT = 1000;

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

/**
 * Rewrites an account's daily balances from `affected`, the earliest date the
 * write touched, to `max(today, latest entry date)`, and deletes the rows past
 * that end. Called by every ledger write inside its own transaction, so no
 * commit ever leaves `balances` stale (AD-2).
 */
async function recomputeBalances(
	tx: Transaction,
	account: Pick<Account, "id" | "type" | "currency">,
	affected: IsoDate,
	timeZone: string,
): Promise<void> {
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
	// An array rather than `.get()`: the account always holds its opening anchor.
	const latest = await tx
		.select({ date: entries.date })
		.from(entries)
		.where(eq(entries.accountId, account.id))
		.orderBy(desc(entries.date))
		.limit(1);
	const until = latest.reduce((end, row) => maxDate(end, row.date), today(timeZone));

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

	const chunks: NewBalance[][] = [];
	for (let start = 0; start < rows.length; start += BALANCE_ROWS_PER_INSERT) {
		chunks.push(rows.slice(start, start + BALANCE_ROWS_PER_INSERT));
	}

	// Strictly in sequence, so a failed chunk rolls back with nothing else still queued.
	await chunks.reduce<Promise<unknown>>(
		(pending, chunk) => pending.then(() => tx.insert(balances).values(chunk)),
		Promise.resolve(),
	);
}

async function accountWithOpeningDate(tx: Transaction, accountId: string) {
	const row = await tx
		.select({
			id: accounts.id,
			type: accounts.type,
			currency: accounts.currency,
			openingDate: entries.date,
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

/** Where the statement comes from. Imports and bank sync add their ids with Epics 2 and 10. */
export type IngestSource = { manual: true };

export type IngestResult = {
	/** Entry ids, in statement order. */
	created: string[];
	/** `ref` is the line's index in the statement. */
	rejected: { ref: string; reason: RejectionCode }[];
};

function filledFields(line: NormalizedTransaction): LockableField[] {
	return line.notes === null ? ["date", "amount", "label"] : ["date", "amount", "label", "notes"];
}

/**
 * Writes a statement into one account, in one transaction, following the
 * pipeline order of AD-4. Steps 2, 3 and 5 to 7 arrive with their epics, in
 * their slot; a manual line carries no key.
 */
export async function ingest(
	deps: ServiceDeps,
	accountId: string,
	statement: ParsedStatement,
	_source: IngestSource,
	options: { origin: Origin },
): Promise<IngestResult> {
	return deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const context = {
				openingDate: account.openingDate,
				currency: account.currency,
				today: today(deps.timeZone),
			};
			const result: IngestResult = { created: [], rejected: [] };
			const accepted: NormalizedTransaction[] = [];

			// 1. Reject lines the account cannot hold.
			for (const [index, line] of statement.transactions.entries()) {
				const reason = rejectionFor(line, context);

				if (reason === null) {
					accepted.push(line);
				} else {
					result.rejected.push({ ref: String(index), reason });
				}
			}

			// 4. Insert the new entries.
			const now = Date.now();
			const rows = accepted.map((line) => ({ id: crypto.randomUUID(), line }));
			const [earliest] = accepted.map((line) => line.date).toSorted();

			if (earliest !== undefined) {
				await tx.insert(entries).values(
					rows.map(({ id, line }) => ({
						id,
						accountId,
						kind: "transaction" as const,
						date: line.date,
						amount: line.amount,
						currency: line.currency,
						createdAt: now,
						updatedAt: now,
					})),
				);
				await tx.insert(transactions).values(
					rows.map(({ id, line }) => ({
						entryId: id,
						label: line.label,
						notes: line.notes,
						lockedFields: options.origin === "user" ? filledFields(line) : [],
					})),
				);

				// 8. Recompute balances from the earliest new line.
				await recomputeBalances(tx, account, earliest, deps.timeZone);
			}

			result.created.push(...rows.map((row) => row.id));

			return result;
		},
		{ behavior: "immediate" },
	);
}

/** An absent or `undefined` field is left as it is. */
export type TransactionPatch = {
	date?: IsoDate | undefined;
	amount?: MinorUnits | undefined;
	label?: string | undefined;
	notes?: string | null | undefined;
};

export type UpdateResult = { status: "updated" } | { status: "rejected"; reason: RejectionCode };

async function transactionRow(tx: Transaction, entryId: string) {
	const row = await tx
		.select({
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			label: transactions.label,
			notes: transactions.notes,
			lockedFields: transactions.lockedFields,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return row;
}

/**
 * Edits a transaction and recomputes its account's balances from the earlier
 * of its old and new dates. A `user` edit locks every field it changes; any
 * other origin leaves locked fields as they are (AD-10).
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
			const locked = new Set(current.lockedFields);
			const next = { ...current };
			const changed: LockableField[] = [];

			for (const field of ["date", "amount", "label", "notes"] as const) {
				const value = patch[field];
				const allowed = options.origin === "user" || !locked.has(field);

				if (value !== undefined && value !== current[field] && allowed) {
					changed.push(field);
					Object.assign(next, { [field]: value });
				}
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

			await tx
				.update(entries)
				.set({ date: next.date, amount: next.amount, updatedAt: Date.now() })
				.where(eq(entries.id, entryId));
			await tx
				.update(transactions)
				.set({
					label: next.label,
					notes: next.notes,
					lockedFields:
						options.origin === "user"
							? [...new Set([...current.lockedFields, ...changed])]
							: current.lockedFields,
				})
				.where(eq(transactions.entryId, entryId));
			await recomputeBalances(tx, account, minDate(current.date, next.date), deps.timeZone);

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
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

			// The detail row first: its foreign key restricts deleting the entry.
			await tx.delete(transactions).where(eq(transactions.entryId, entryId));
			await tx.delete(entries).where(eq(entries.id, entryId));
			await recomputeBalances(tx, account, current.date, deps.timeZone);
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

export type TransactionRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
};

const transactionColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
};

function toRecord(row: {
	id: string;
	accountId: string;
	date: string;
	amount: number;
	currency: string;
	label: string;
	notes: string | null;
}): TransactionRecord {
	return { ...row, amount: toMinorUnits(row.amount) };
}

/** One transaction, `null` when the id names none. */
export async function findTransaction(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransactionRecord | null> {
	const row = await deps.db
		.select(transactionColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	return row === undefined ? null : toRecord(row);
}

/** A page of an account's transactions, most recent first (AD-15). */
export async function listTransactions(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<{ items: TransactionRecord[]; total: number }> {
	const where = and(eq(entries.accountId, accountId), eq(entries.kind, "transaction"));
	const rows = await deps.db
		.select(transactionColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(entries).where(where);

	return {
		items: rows.map(toRecord),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}
