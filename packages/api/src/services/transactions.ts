import type { RejectionCode } from "../domain/statement.ts";
import type { FieldError } from "../lib/errors.ts";
import type { TransactionInput, TransactionPatchInput } from "../schemas/transactions.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TransactionRecord } from "./ledger.ts";

import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { createTransactionSchema, updateTransactionSchema } from "../schemas/transactions.ts";
import { getAccount } from "./accounts.ts";
import * as ledger from "./ledger.ts";

/**
 * Where a transaction came from, shown in its sheet. Every transaction is
 * manual until imports (Epic 2) and bank sync (Epic 10) arrive.
 */
export type TransactionSource = "manual";

export type TransactionItem = TransactionRecord & { source: TransactionSource };

export type TransactionPage = {
	items: TransactionItem[];
	page: number;
	pageSize: number;
	total: number;
};

const withSource = (record: TransactionRecord): TransactionItem => ({
	...record,
	source: "manual",
});

// The ledger names why it refused a line; the form shows it under the date.
const REJECTION_FIELDS: Record<Exclude<RejectionCode, "CURRENCY_MISMATCH">, FieldError> = {
	BEFORE_OPENING_DATE: { path: "date", code: "not_after_opening_date" },
	DATE_TOO_LATE: { path: "date", code: "date_too_late" },
};

function rejectionError(reason: RejectionCode): AppError {
	if (reason === "CURRENCY_MISMATCH") {
		// The service always writes in the account's currency; reaching this is a bug.
		return new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return new AppError("VALIDATION_ERROR", "The request is invalid.", [REJECTION_FIELDS[reason]]);
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

	return withSource(record);
}

/** A page of one account's transactions, most recent first. */
export async function listAccountTransactions(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<TransactionPage> {
	await getAccount(deps, accountId);
	const { items, total } = await ledger.listTransactions(deps, accountId, page);

	return { items: items.map(withSource), page: page.page, pageSize: page.pageSize, total };
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
		{ transactions: [{ ...parsed.data, currency }] },
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
