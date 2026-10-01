import type { Direction } from "../../domain/cash-flow.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { AmountRange } from "../../domain/transaction-filter.ts";
import type { SQL } from "drizzle-orm";

import {
	and,
	between,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lte,
	not,
	notInArray,
	or,
	sql,
} from "drizzle-orm";

import { entries } from "@archant/data/schema/entries";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import { EXPENSE_TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import { LIKE_ESCAPE, escapeLike } from "../../domain/transaction-filter.ts";
import { asInflow, asOutflow } from "./shared.ts";

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
export function needsTransactionColumns(filter: TransactionFilter): boolean {
	return (
		filter.q !== undefined ||
		filter.categoryIds !== undefined ||
		filter.uncategorised === true ||
		filter.merchantIds !== undefined
	);
}

function categoryCondition(
	filter: TransactionFilter,
	sides: TransferSideSql,
): SQL | undefined | null {
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
		uncategorised ? and(isNull(transactions.categoryId), not(sides.is)) : undefined,
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

// `LIKE` rather than FTS5 until NFR10's 150 ms target fails. Drizzle's
// `like` has no `escape` clause, and without one `50%` would find `Remise 500`.
function contains(column: typeof transactions.label | typeof transactions.notes, q: string): SQL {
	return sql`${column} like ${`%${escapeLike(q)}%`} escape ${LIKE_ESCAPE}`;
}

/** Drizzle's `and` of two conditions, typed as never empty, so a sum can pick rows by it. */
const both = (left: SQL, right: SQL): SQL => sql`(${left} and ${right})`;

/**
 * The SQL twin of `direction` in `domain/cash-flow.ts`, built from the same
 * `EXPENSE_TRANSFER_KINDS`; the ledger's parity test keeps the two in step. It
 * lives here because only the ledger reads the money tables. `is` says
 * whether a row is a transfer side; `directions` are the filter's conditions
 * built on it.
 */
type TransferSideSql = { is: SQL; directions: Record<Direction, SQL> };

function transferSideOf(is: SQL): TransferSideSql {
	// `+` keeps SQLite off `entries_kind_amount_date` for a sign: « Dépenses »
	// matches most rows, and read by amount they had to be sorted by date in
	// full, 65 ms at 100,000 rows, where the date index stops at the page.
	const amount = sql`+${entries.amount}`;

	return {
		is,
		directions: {
			income: both(not(is), gt(amount, 0)),
			expense: both(not(is), lte(amount, 0)),
			transfer: is,
		},
	};
}

/**
 * For a query that joins no `transfers`: the bulk selection and the cash flow.
 * A correlated subquery per row, which the list, its count and its sum cannot
 * afford at 100,000 rows.
 */
export const correlatedTransferSide = transferSideOf(
	sql`exists (select 1 from ${transfers} where ${transfers.inflowTransactionId} = ${entries.id} or (${transfers.outflowTransactionId} = ${entries.id} and ${notInArray(transfers.kind, [...EXPENSE_TRANSFER_KINDS])}))`,
);

/**
 * For a query that left-joins `asOutflow` and `asInflow` on the row's id: the
 * list, its count and its sum. Each join is on a unique index, so no row
 * doubles, and SQLite drops either join when nothing reads it.
 */
export const joinedTransferSide = transferSideOf(
	sql`(${asInflow.id} is not null or (${asOutflow.id} is not null and ${notInArray(asOutflow.kind, [...EXPENSE_TRANSFER_KINDS])}))`,
);

/**
 * The where clause of a filter, `null` when it can match nothing at all, so
 * the caller skips the query rather than asking SQLite for an empty `or`.
 */
export function filterCondition(
	filter: TransactionFilter,
	sides: TransferSideSql,
): SQL | undefined | null {
	const { accountIds, amounts, q, merchantIds, tagIds, direction } = filter;
	const category = categoryCondition(filter, sides);

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

	// `+` picks the index that gives the list's order. Sampled by
	// `analysis_limit`, `kind` and `account_id` look equally selective, and the
	// planner then sorted a whole account, or every account, before the page.
	// One account reads its own date index; several read the kind's.
	const oneAccount = accountIds?.length === 1;
	const kind = oneAccount ? sql`+${entries.kind}` : sql`${entries.kind}`;
	const accountId = oneAccount ? sql`${entries.accountId}` : sql`+${entries.accountId}`;

	return and(
		eq(kind, "transaction"),
		accountIds === undefined ? undefined : inArray(accountId, [...accountIds]),
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
			: or(...[...new Set(direction)].map((value) => sides.directions[value])),
	);
}
