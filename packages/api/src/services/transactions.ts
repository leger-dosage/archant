import type { IsoDate } from "../domain/dates.ts";
import type { RejectionCode } from "../domain/statement.ts";
import type { FieldError } from "../lib/errors.ts";
import type {
	TransactionFilterRequest,
	TransactionInput,
	TransactionPatchInput,
} from "../schemas/transactions.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TransactionFilter, TransactionListRecord, TransactionRecord } from "./ledger.ts";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import type { FileSourceId } from "@archant/data/schema/imports";

import { today } from "../domain/dates.ts";
import { amountBoundsFor } from "../domain/transaction-filter.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import {
	UNCATEGORISED,
	createTransactionSchema,
	updateTransactionSchema,
} from "../schemas/transactions.ts";
import { getAccount } from "./accounts.ts";
import { withChildren } from "./categories.ts";
import * as ledger from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

/**
 * Where a transaction came from, shown in its sheet: typed by hand, or
 * brought by a file, with the day it was imported. Derived from the entry's
 * keys, so a manual entry an import paired with shows that import. Bank sync
 * joins with Epic 10.
 */
export type TransactionSource =
	| { kind: "manual" }
	| { kind: "import"; format: FileSourceId; date: IsoDate };

export type TransactionItem = TransactionRecord & { source: TransactionSource };

export type TransactionListItem = TransactionListRecord & { source: TransactionSource };

export type TransactionPage = {
	items: TransactionListItem[];
	page: number;
	pageSize: number;
	total: number;
};

export type FilteredTransactionPage = TransactionPage & {
	/**
	 * The signed sum of every matching row in the reporting currency, excluded
	 * ones included; `skippedCount` rows in another currency are left out
	 * until exchange rates exist.
	 */
	sum: { amount: MinorUnits; currency: CurrencyCode; skippedCount: number };
};

/** Each record with its source, in one query for the whole page. */
async function withSources<Row extends TransactionRecord>(
	deps: ServiceDeps,
	records: readonly Row[],
): Promise<(Row & { source: TransactionSource })[]> {
	const origins = await ledger.importOrigins(
		deps,
		records.map((record) => record.id),
	);

	return records.map((record) => {
		const origin = origins.get(record.id);

		return {
			...record,
			source:
				origin === undefined
					? { kind: "manual" }
					: {
							kind: "import",
							format: origin.source,
							// Keys exist only once their import is confirmed.
							date: today(deps.timeZone, new Date(origin.confirmedAt ?? 0)),
						},
		};
	});
}

// The ledger names why it refused a line; the form shows it under the date.
const REJECTION_FIELDS: Partial<Record<RejectionCode, FieldError>> = {
	BEFORE_OPENING_DATE: { path: "date", code: "not_after_opening_date" },
	DATE_TOO_LATE: { path: "date", code: "date_too_late" },
};

function rejectionError(reason: RejectionCode): AppError {
	const field = REJECTION_FIELDS[reason];

	if (field === undefined) {
		// The service always writes in the account's currency, from a parsed
		// form; any other reason is a bug.
		return new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return new AppError("VALIDATION_ERROR", "The request is invalid.", [field]);
}

async function currencyOf(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

async function found(deps: ServiceDeps, id: string): Promise<TransactionItem> {
	const record = await ledger.findTransaction(deps, id);

	if (record === null) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	const [item] = await withSources(deps, [record]);

	if (item === undefined) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return item;
}

/** A page of one account's transactions, most recent first. */
export async function listAccountTransactions(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<TransactionPage> {
	await getAccount(deps, accountId);
	const { items, total } = await ledger.listTransactions(deps, { accountIds: [accountId] }, page);

	return {
		items: await withSources(deps, items),
		page: page.page,
		pageSize: page.pageSize,
		total,
	};
}

/**
 * The amount bounds scaled to every currency an account holds. A currency
 * whose minor units leave no value between the bounds is absent, so none of
 * its rows match.
 */
async function amountsFor(
	deps: ServiceDeps,
	query: TransactionFilterRequest,
): Promise<TransactionFilter["amounts"]> {
	const { amountMin, amountMax } = query;

	if (amountMin === undefined && amountMax === undefined) {
		return undefined;
	}

	const rows = await deps.db.selectDistinct({ currency: accounts.currency }).from(accounts);

	return rows.flatMap(({ currency }) => {
		const range = isCurrencyCode(currency) ? amountBoundsFor(amountMin, amountMax, currency) : null;

		return range === null ? [] : [{ currency, ...range }];
	});
}

/** The `category` values as the ledger reads them, each parent standing for its children too. */
async function categoryFilterOf(
	deps: ServiceDeps,
	values: readonly string[] | undefined,
): Promise<Pick<TransactionFilter, "categoryIds" | "uncategorised">> {
	if (values === undefined) {
		return {};
	}

	const ids = values.filter((value) => value !== UNCATEGORISED);

	return {
		categoryIds: await withChildren(deps, ids),
		uncategorised: ids.length < values.length,
	};
}

/**
 * A page of every account's transactions matching the filter, most recent
 * first, with the count and the signed total of all the matching rows.
 */
export async function listAllTransactions(
	deps: ServiceDeps,
	query: TransactionFilterRequest,
): Promise<FilteredTransactionPage> {
	const currency = getReportingCurrency();
	const filter: TransactionFilter = {
		accountIds: query.account,
		from: query.from,
		to: query.to,
		amounts: await amountsFor(deps, query),
		q: query.q,
		...(await categoryFilterOf(deps, query.category)),
	};
	const page = { page: query.page, pageSize: query.pageSize };
	const { items, total } = await ledger.listTransactions(deps, filter, page);
	const sums = await ledger.sumTransactions(deps, filter);
	const counted = sums.find((row) => row.currency === currency);

	return {
		items: await withSources(deps, items),
		...page,
		total,
		sum: {
			amount: counted?.amount ?? toMinorUnits(0),
			currency,
			skippedCount: sums
				.filter((row) => row.currency !== currency)
				.reduce((skipped, row) => skipped + row.count, 0),
		},
	};
}

/** Records a transaction typed by the user, in its account's currency. */
export async function createTransaction(
	deps: ServiceDeps,
	accountId: string,
	input: TransactionInput,
): Promise<TransactionItem> {
	const currency = await currencyOf(deps, accountId);
	const parsed = createTransactionSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await ledger.ingest(
		deps,
		accountId,
		{
			transactions: [{ ...parsed.data, externalId: null, reference: null, currency }],
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);
	const [id] = result.created;
	const [rejected] = result.rejected;

	if (rejected !== undefined) {
		throw rejectionError(rejected.reason);
	}

	if (id === undefined) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return found(deps, id);
}

/** Edits a transaction on the user's behalf. */
export async function updateTransaction(
	deps: ServiceDeps,
	id: string,
	input: TransactionPatchInput,
): Promise<TransactionItem> {
	const current = await found(deps, id);
	const currency = await currencyOf(deps, current.accountId);
	const parsed = updateTransactionSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await ledger.updateTransaction(deps, id, parsed.data, { origin: "user" });

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return found(deps, id);
}

/** Deletes a transaction for good. */
export async function deleteTransaction(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await ledger.deleteTransaction(deps, id, { origin: "user" });

	return { id };
}
