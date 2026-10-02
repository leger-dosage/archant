import type { IsoDate } from "../domain/dates.ts";
import type { RejectionCode } from "../domain/statement.ts";
import type { FieldError } from "../lib/errors.ts";
import type {
	BulkDeleteRequest,
	BulkFilterRequest,
	BulkSelectionRequest,
	BulkUpdateRequest,
	MergeDuplicateRequest,
	TransactionFilterRequest,
	TransactionInput,
	TransactionPatchInput,
	TransactionTotalsRequest,
} from "../schemas/transactions.ts";
import type { ServiceDeps } from "./deps.ts";
import type { DuplicateCandidate } from "./ledger/duplicates.ts";
import type { BulkSelection } from "./ledger/edits.ts";
import type { TransactionFilter } from "./ledger/filter.ts";
import type { EntryOrigin, TransactionListRecord, TransactionRecord } from "./ledger/queries.ts";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import type { FileSourceId } from "@archant/data/schema/imports";

import { today } from "../domain/dates.ts";
import { normalizeLabel } from "../domain/normalize-label.ts";
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
import {
	dismissDuplicate as dismissLedgerDuplicate,
	duplicateCandidates,
	mergeDuplicate as mergeLedgerDuplicate,
} from "./ledger/duplicates.ts";
import {
	bulkDeleteTransactions as bulkDeleteLedgerTransactions,
	bulkUpdateTransactions as bulkUpdateLedgerTransactions,
	deleteTransaction as deleteLedgerTransaction,
	updateTransaction as updateLedgerTransaction,
} from "./ledger/edits.ts";
import { ingest } from "./ledger/ingest.ts";
import {
	entryOrigins,
	findTransaction,
	listTransactionPage,
	listTransactions,
	sumTransactions,
	sumTransactionsByLabel,
} from "./ledger/queries.ts";
import { recurringEntryIds } from "./recurring.ts";
import { getReportingCurrency } from "./settings.ts";

/**
 * Where a transaction came from, shown in its sheet: typed by hand, or
 * brought by a file, with the day it was imported. Derived from the entry's
 * keys, so a manual entry an import paired with shows that import, and an
 * entry a sync paired with shows the bank.
 */
type TransactionSource =
	| { kind: "manual" }
	| { kind: "import"; format: FileSourceId; date: IsoDate }
	| { kind: "bank"; connector: BankConnectorId };

export type TransactionItem = TransactionRecord & { source: TransactionSource };

type TransactionListItem = TransactionListRecord & {
	source: TransactionSource;
	/** Held by a series that is not dismissed, as the sheet's « Récurrent » section reads it. */
	recurring: boolean;
};

export type TransactionPage = {
	items: TransactionListItem[];
	page: number;
	pageSize: number;
	total: number;
};

/** A page of the cross-account list; its count and sums come from `transactionTotals`. */
export type FilteredTransactionPage = Omit<TransactionPage, "total">;

export type TransactionTotals = {
	/** Every matching row, whatever its currency. */
	total: number;
	/**
	 * The signed sum of every matching row in the reporting currency, excluded
	 * ones included, and its income and expense parts, a transfer side in
	 * neither; `skippedCount` rows in another currency are left out until
	 * exchange rates exist.
	 */
	sum: {
		amount: MinorUnits;
		income: MinorUnits;
		expense: MinorUnits;
		currency: CurrencyCode;
		skippedCount: number;
	};
};

function sourceOf(origin: EntryOrigin | undefined, timeZone: string): TransactionSource {
	if (origin === undefined) {
		return { kind: "manual" };
	}

	if (origin.kind === "bank") {
		return { kind: "bank", connector: origin.connector };
	}

	return {
		kind: "import",
		format: origin.source,
		// Keys exist only once their import is confirmed.
		date: today(timeZone, new Date(origin.confirmedAt ?? 0)),
	};
}

/** Each record with its source, in two queries for the whole page. */
async function withSources<Row extends TransactionRecord>(
	deps: ServiceDeps,
	records: readonly Row[],
): Promise<(Row & { source: TransactionSource })[]> {
	const origins = await entryOrigins(
		deps,
		records.map((record) => record.id),
	);

	return records.map((record) => {
		const origin = origins.get(record.id);

		return {
			...record,
			source: sourceOf(origin, deps.timeZone),
		};
	});
}

/** A list page's records with their source and their recurring flag, in two queries. */
async function listItemsOf(
	deps: ServiceDeps,
	records: readonly TransactionListRecord[],
): Promise<TransactionListItem[]> {
	const recurring = await recurringEntryIds(deps.db, records);

	return (await withSources(deps, records)).map((record) => ({
		...record,
		recurring: recurring.has(record.id),
	}));
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
	const record = await findTransaction(deps, id);

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
	const { items, total } = await listTransactions(deps, { accountIds: [accountId] }, page);

	return {
		items: await listItemsOf(deps, items),
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
	query: BulkFilterRequest,
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
 * The list's filter as the ledger reads it, shared by the list and the bulk
 * actions so « Tout sélectionner » acts on exactly the rows the list counts.
 */
async function filterOf(deps: ServiceDeps, query: BulkFilterRequest): Promise<TransactionFilter> {
	return {
		accountIds: query.account,
		from: query.from,
		to: query.to,
		amounts: await amountsFor(deps, query),
		q: query.q,
		...(await categoryFilterOf(deps, query.category)),
		merchantIds: query.merchant,
		tagIds: query.tag,
		direction: query.direction,
	};
}

/**
 * A page of every account's transactions matching the filter, most recent
 * first. No count and no sum: they do not change from one page to the next,
 * so `transactionTotals` answers them once per filter.
 */
export async function listAllTransactions(
	deps: ServiceDeps,
	query: TransactionFilterRequest,
): Promise<FilteredTransactionPage> {
	const filter = await filterOf(deps, query);
	const page = { page: query.page, pageSize: query.pageSize };
	const items = await listTransactionPage(deps, filter, page);

	return { items: await listItemsOf(deps, items), ...page };
}

/** The count and the signed total of every transaction matching the filter. */
export async function transactionTotals(
	deps: ServiceDeps,
	query: TransactionTotalsRequest,
): Promise<TransactionTotals> {
	const currency = getReportingCurrency();
	const sums = await sumTransactions(deps, await filterOf(deps, query));
	const counted = sums.find((row) => row.currency === currency);

	return {
		total: sums.reduce((total, row) => total + row.count, 0),
		sum: {
			amount: counted?.amount ?? toMinorUnits(0),
			income: counted?.income ?? toMinorUnits(0),
			expense: counted?.expense ?? toMinorUnits(0),
			currency,
			skippedCount: sums
				.filter((row) => row.currency !== currency)
				.reduce((skipped, row) => skipped + row.count, 0),
		},
	};
}

/**
 * A page of the list with its count and sums, as the list reads them in two
 * requests: what an assistant reads in one call.
 */
export async function findTransactions(
	deps: ServiceDeps,
	query: TransactionFilterRequest,
): Promise<FilteredTransactionPage & TransactionTotals> {
	const [page, totals] = await Promise.all([
		listAllTransactions(deps, query),
		transactionTotals(deps, query),
	]);

	return { ...page, ...totals };
}

/** Transactions whose labels read the same, case, accents and spaces aside. */
export type LabelGroup = {
	/** The label most of them carry, as the bank wrote it. */
	label: string;
	count: number;
	/** Signed, in `currency`: a group never mixes currencies nor signs. */
	total: MinorUnits;
	currency: string;
	lastDate: IsoDate;
	/** The categories its transactions carry, `null` for uncategorised ones first. */
	categoryIds: (string | null)[];
};

/** Past this a list of groups is no longer read through; `groupCount` says how many there are. */
const MAX_LABEL_GROUPS = 100;

type GroupDraft = Omit<LabelGroup, "label" | "categoryIds"> & {
	labels: Map<string, number>;
	categoryIds: Set<string | null>;
};

/** The label most rows carry; the first in code-point order among equals, so it never flickers. */
function mostFrequent(labels: ReadonlyMap<string, number>): string {
	let best = "";
	let bestCount = 0;

	for (const [label, count] of labels) {
		if (count > bestCount || (count === bestCount && label < best)) {
			best = label;
			bestCount = count;
		}
	}

	return best;
}

const nullFirst = (a: string | null, b: string | null) =>
	a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;

/**
 * The transactions matching the list's filter, grouped by label as Sure's
 * « Catégoriser » offers them: case, accents and spaces aside, each currency
 * and each sign apart, as Sure keeps income and expenses apart. The largest
 * groups first, `MAX_LABEL_GROUPS` at most, with how many there are.
 */
export async function groupTransactionsByLabel(
	deps: ServiceDeps,
	query: TransactionTotalsRequest,
): Promise<{ groups: LabelGroup[]; groupCount: number }> {
	const rows = await sumTransactionsByLabel(deps, await filterOf(deps, query));
	const drafts = new Map<string, GroupDraft>();

	for (const row of rows) {
		const key = JSON.stringify([normalizeLabel(row.label), row.currency, row.outflow]);
		const draft = drafts.get(key) ?? {
			count: 0,
			total: toMinorUnits(0),
			currency: row.currency,
			lastDate: row.lastDate,
			labels: new Map<string, number>(),
			categoryIds: new Set<string | null>(),
		};

		draft.count += row.count;
		draft.total = toMinorUnits(draft.total + row.amount);
		draft.lastDate = row.lastDate > draft.lastDate ? row.lastDate : draft.lastDate;
		draft.labels.set(row.label, (draft.labels.get(row.label) ?? 0) + row.count);
		draft.categoryIds.add(row.categoryId);
		drafts.set(key, draft);
	}

	const groups = [...drafts.values()]
		.map(({ labels, categoryIds, ...draft }) => ({
			...draft,
			label: mostFrequent(labels),
			categoryIds: [...categoryIds].toSorted(nullFirst),
		}))
		.toSorted(
			(a, b) =>
				b.count - a.count ||
				a.label.localeCompare(b.label, "fr") ||
				a.currency.localeCompare(b.currency) ||
				a.total - b.total,
		);

	return { groups: groups.slice(0, MAX_LABEL_GROUPS), groupCount: groups.length };
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

	const result = await ingest(
		deps,
		accountId,
		{
			transactions: [
				{ ...parsed.data, externalId: null, reference: null, currency, pending: false },
			],
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

	const result = await updateLedgerTransaction(deps, id, parsed.data, { origin: "user" });

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return found(deps, id);
}

/** Deletes a transaction for good. */
export async function deleteTransaction(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await deleteLedgerTransaction(deps, id, { origin: "user" });

	return { id };
}

/** What « Fusionner avec… » lists for a possible duplicate, nearest date first. */
export async function listDuplicateCandidates(
	deps: ServiceDeps,
	id: string,
): Promise<DuplicateCandidate[]> {
	return duplicateCandidates(deps, id);
}

/**
 * Merges a possible duplicate into the candidate the user picked, on the
 * user's behalf, and returns that candidate as it now stands.
 */
export async function mergeDuplicate(
	deps: ServiceDeps,
	id: string,
	body: MergeDuplicateRequest,
): Promise<TransactionItem> {
	await mergeLedgerDuplicate(deps, id, body.into);

	return found(deps, body.into);
}

/** Clears a possible-duplicate flag: « Ce n'est pas un doublon ». */
export async function dismissDuplicate(deps: ServiceDeps, id: string): Promise<TransactionItem> {
	await dismissLedgerDuplicate(deps, id);

	return found(deps, id);
}

async function selectionOf(
	deps: ServiceDeps,
	selection: BulkSelectionRequest,
): Promise<BulkSelection> {
	return "ids" in selection ? selection : { filter: await filterOf(deps, selection.filter) };
}

/**
 * Sets a category or a merchant, adds tags or changes the exclusion on the
 * selected transactions, on the user's behalf, and counts the rows selected.
 */
export async function bulkUpdateTransactions(
	deps: ServiceDeps,
	body: BulkUpdateRequest,
): Promise<{ updated: number }> {
	const updated = await bulkUpdateLedgerTransactions(
		deps,
		await selectionOf(deps, body.selection),
		body.patch,
		{ origin: "user" },
	);

	return { updated };
}

/** Deletes the selected transactions for good and counts them. */
export async function bulkDeleteTransactions(
	deps: ServiceDeps,
	body: BulkDeleteRequest,
): Promise<{ deleted: number }> {
	const deleted = await bulkDeleteLedgerTransactions(
		deps,
		await selectionOf(deps, body.selection),
		{ origin: "user" },
	);

	return { deleted };
}
