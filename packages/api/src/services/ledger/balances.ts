import type { DailyBalance, HoldingValue } from "../../domain/balances/forward.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
	sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits, Money } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { securityPrices } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";
import type { Account, NewBalance, NewHolding } from "@archant/data/types";

import { forwardBalances } from "../../domain/balances/forward.ts";
import { fillDays } from "../../domain/balances/history.ts";
import { reverseBalances } from "../../domain/balances/reverse.ts";
import { addDays, maxDate, today } from "../../domain/dates.ts";
import { forwardHoldings } from "../../domain/holdings/forward.ts";
import { AppError } from "../../lib/errors.ts";
import { inSequence, movesQuantity, notSplitParent, oneByOne, tradedSecurityId } from "./shared.ts";

// SQLite caps bound parameters per statement at 32 766; five columns per row
// keeps a chunk far below it, and a decade of history is 3 650 rows.
const BALANCE_ROWS_PER_INSERT = 1000;

// Seven columns per row: 7 000 parameters, as far below the cap. A decade of
// twenty securities is 73 000 rows.
const HOLDING_ROWS_PER_INSERT = 1000;

// A `current_anchor` belongs to a bank-linked account, computed backward from
// it (AD-8); the forward computation reads only these two.
const FORWARD_VALUATION_KINDS = ["opening_anchor", "reconciliation"] as const;

/** The stored balance at the end of `date`: the last row on or before it. */
export async function lastBalanceOnOrBefore(
	db: Pick<ServiceDeps["db"], "select"> | Pick<Transaction, "select">,
	accountId: string,
	date: IsoDate,
) {
	return db
		.select({
			date: balances.date,
			balance: balances.balance,
			cash: balances.cash,
			currency: balances.currency,
		})
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
 * The account's booked movements summed per day, on the rows `where` keeps:
 * every entry that is not a valuation, a transaction once booked, a trade by
 * its cash amount (AD-22). Every balance reads its movements here: a pending
 * line counts in no balance until the bank books it (AD-8), as Sure's
 * `Entry.excluding_pending`. A split parent counts through its children
 * (AD-20): balances count excluded rows, so its exclusion alone would count
 * the money twice.
 */
export async function bookedMovements(
	db: Pick<ServiceDeps["db"], "select"> | Pick<Transaction, "select">,
	accountId: string,
	where?: SQL,
) {
	return db
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.leftJoin(transactions, eq(transactions.entryId, entries.id))
		.where(
			and(
				eq(entries.accountId, accountId),
				ne(entries.kind, "valuation"),
				// A trade has no `transactions` row, so no pending flag.
				or(isNull(transactions.entryId), eq(transactions.pending, false)),
				notSplitParent,
				where,
			),
		)
		.groupBy(entries.date);
}

/**
 * A bank-linked account's balances, rewritten whole from its opening date:
 * a change on any day moves every earlier one, since they derive from the
 * bank's balance backward (AD-8), each reconciliation, an earlier bank
 * figure included, fixing its own day. Pending entries play no part, as
 * Sure's `Entry.excluding_pending`: the bank's balance is a booked one
 * (AD-18).
 */
async function recomputeBackward(
	tx: Transaction,
	account: Pick<Account, "id" | "type" | "currency">,
	anchor: DailyBalance,
	openingDate: IsoDate,
	timeZone: string,
): Promise<void> {
	const movements = await bookedMovements(tx, account.id);
	// The opening anchor bounds the range; its amount plays no part.
	const reconciliations = await tx
		.select({ date: entries.date, balance: entries.amount })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "reconciliation")));
	const rows: NewBalance[] = reverseBalances({
		from: openingDate,
		anchor,
		valuations: reconciliations.map((row) => ({
			date: row.date,
			balance: toMinorUnits(row.balance),
		})),
		movements: movements.map((row) => ({ date: row.date, amount: toMinorUnits(row.amount) })),
		until: await lastBalanceDay(tx, account.id, timeZone),
		classification: classificationOf(account.type),
	}).map((row) => ({
		accountId: account.id,
		currency: account.currency,
		cash: row.balance,
		...row,
	}));

	// Holdings are computed forward only: the bank's balance is the whole value.
	await tx.delete(holdings).where(eq(holdings.accountId, account.id));
	await tx.delete(balances).where(eq(balances.accountId, account.id));
	await inSequence(rows, BALANCE_ROWS_PER_INSERT, (chunk) => tx.insert(balances).values(chunk));
}

/**
 * The bank balance a linked account is computed backward from (AD-8), with
 * its opening date; `undefined` for an account computed forward.
 */
export async function backwardAnchor(db: Pick<ServiceDeps["db"], "select">, accountId: string) {
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
 * Rewrites an investment account's holdings from `from` to `until`, and
 * deletes the rows past that end; the rows before `from` stay as they are.
 * The day before `from` is replayed from every earlier trade and each
 * security's last stored price before it (AD-22). Returns what each holding
 * is worth, by day.
 */
async function recomputeHoldings(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	from: IsoDate,
	until: IsoDate,
): Promise<HoldingValue[]> {
	// In recording order: a buy's place among the day's trades moves its cost
	// basis. A dividend or interest moves cash only.
	const tradeRows = await tx
		.select({
			date: entries.date,
			securityId: tradedSecurityId,
			quantity: trades.quantity,
			price: trades.price,
			fee: trades.fee,
		})
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(and(eq(entries.accountId, account.id), movesQuantity))
		.orderBy(asc(entries.date), asc(entries.createdAt), asc(entries.id));
	const securityIds = [...new Set(tradeRows.map((row) => row.securityId))];
	const priceColumns = {
		securityId: securityPrices.securityId,
		date: securityPrices.date,
		price: securityPrices.price,
	};
	const prices = await tx
		.select(priceColumns)
		.from(securityPrices)
		.where(
			and(
				inArray(securityPrices.securityId, securityIds),
				gte(securityPrices.date, from),
				lte(securityPrices.date, until),
			),
		);
	const pricesBefore = new Map<string, (typeof prices)[number]>();

	// One primary-key lookup per security, where a grouped query would read
	// every price of the decade before `from`.
	await oneByOne(securityIds, async (securityId) => {
		const row = await tx
			.select(priceColumns)
			.from(securityPrices)
			.where(and(eq(securityPrices.securityId, securityId), lt(securityPrices.date, from)))
			.orderBy(desc(securityPrices.date))
			.limit(1)
			.get();

		if (row !== undefined) {
			pricesBefore.set(securityId, row);
		}
	});

	const rows: NewHolding[] = forwardHoldings({
		from,
		until,
		trades: tradeRows,
		prices,
		pricesBefore,
		currency: account.currency,
	}).map((row) => ({ accountId: account.id, ...row }));

	await tx
		.delete(holdings)
		.where(
			and(
				eq(holdings.accountId, account.id),
				or(gte(holdings.date, from), gt(holdings.date, until)),
			),
		);
	await inSequence(rows, HOLDING_ROWS_PER_INSERT, (chunk) => tx.insert(holdings).values(chunk));

	return rows.map((row) => ({ date: row.date, value: row.amount }));
}

/**
 * Rewrites an account's daily balances from `affected`, the earliest date the
 * write touched, to `max(today, latest entry date)`, and deletes the rows past
 * that end. Called by every ledger write inside its own transaction, so no
 * commit ever leaves `balances` stale (AD-2). A bank-linked account with a
 * bank balance is computed backward from it, whole; any other forward, an
 * investment account's holdings with it, from the same day.
 */
export async function recomputeBalances(
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
	const [from, previousCash] =
		previous === undefined ? [affected, 0] : [addDays(previous.date, 1), previous.cash];
	const movements = await bookedMovements(tx, account.id, gte(entries.date, from));
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
	// Only an investment account holds a security (AD-22).
	const held =
		account.type === "investment" ? await recomputeHoldings(tx, account, from, until) : [];

	const rows: NewBalance[] = forwardBalances({
		from,
		previousCash: toMinorUnits(previousCash),
		valuations: valuations.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
		movements: movements.map((row) => ({ date: row.date, amount: toMinorUnits(row.amount) })),
		holdings: held,
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

export async function accountWithOpeningDate(tx: Transaction, accountId: string) {
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
	return (await openingAnchorOf(deps, accountId))?.date ?? null;
}

/**
 * The account's opening anchor, its first valuation since no snapshot may
 * precede it; `null` for an unknown account.
 */
export async function openingAnchorOf(
	deps: ServiceDeps,
	accountId: string,
): Promise<{ date: IsoDate; balance: MinorUnits } | null> {
	const row = await deps.db
		.select({ date: entries.date, balance: entries.amount })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "opening_anchor")))
		.get();

	return row === undefined ? null : { date: row.date, balance: toMinorUnits(row.balance) };
}
