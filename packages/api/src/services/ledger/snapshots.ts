import type { SnapshotRejectionCode } from "../../domain/balances/snapshot.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, count, desc, eq, exists, inArray, ne, sum } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { holdings } from "@archant/data/schema/holdings";
import { transactions } from "@archant/data/schema/transactions";

import {
	snapshotGap,
	snapshotGapBackward,
	snapshotRejectionFor,
} from "../../domain/balances/snapshot.ts";
import { addDays, minDate, today } from "../../domain/dates.ts";
import { AppError } from "../../lib/errors.ts";
import {
	accountWithOpeningDate,
	backwardAnchor,
	bookedMovements,
	recomputeBalances,
} from "./balances.ts";

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
	/** `replaced`: a snapshot already held the date, and now holds this balance. */
	| { status: "recorded"; id: string; replaced: boolean }
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
export async function snapshotOn(
	tx: Transaction,
	accountId: string,
	date: IsoDate,
	except?: string,
) {
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

			return { status: "recorded", id, replaced: existing !== undefined };
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
 * movements, one for their holdings, whatever the number of rows. Returns the
 * function adding them to a row.
 */
async function gapReader(db: ServiceDeps["db"], accountId: string, dates: readonly IsoDate[]) {
	// A linked account derives each day before its bank balance from the day
	// after: the gap is read against that day, since the day before is itself
	// derived from the snapshot and would always agree with it.
	const anchor = await backwardAnchor(db, accountId);
	const nextDays = dates.map((date) => addDays(date, 1));
	const balanceRows = await db
		.select({ date: balances.date, balance: balances.balance, cash: balances.cash })
		.from(balances)
		.where(
			and(
				eq(balances.accountId, accountId),
				inArray(balances.date, [...dates.map((date) => addDays(date, -1)), ...nextDays]),
			),
		);
	const movementRows = await bookedMovements(
		db,
		accountId,
		inArray(entries.date, [...dates, ...nextDays]),
	);
	const holdingRows = await db
		.select({ date: holdings.date, value: sum(holdings.amount).mapWith(Number) })
		.from(holdings)
		.where(and(eq(holdings.accountId, accountId), inArray(holdings.date, [...dates])))
		.groupBy(holdings.date);
	const stored = new Map(balanceRows.map((row) => [row.date, row]));
	const movements = new Map(movementRows.map((row) => [row.date, row.amount]));
	const values = new Map(holdingRows.map((row) => [row.date, row.value]));

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
						next: toMinorUnits(known.balance),
						nextMovements: toMinorUnits(movements.get(neighbour) ?? 0),
						recorded: balance,
						classification,
					})
				: snapshotGap({
						previousCash: toMinorUnits(known.cash),
						movements: toMinorUnits(movements.get(row.date) ?? 0),
						holdingsValue: toMinorUnits(values.get(row.date) ?? 0),
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
