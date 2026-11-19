import type { AccountAccess } from "../account-access.ts";
import type { ServiceDeps } from "../deps.ts";
import type { SQL } from "drizzle-orm";

import { and, eq, inArray, isNull, not, or } from "drizzle-orm";

import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { AppError } from "../../lib/errors.ts";
import {
	accountIdFilter,
	forbidden,
	requireAccount,
	requireEntry,
	scopedAccounts,
	transactionScope,
} from "../account-access.ts";

type Reader = Pick<ServiceDeps, "actor" | "budgetOwnerId"> & {
	db: Pick<ServiceDeps["db"], "select">;
};

export function recurringScope(deps: Reader, access: AccountAccess = "read") {
	if (deps.actor === undefined && typeof deps.budgetOwnerId !== "string") {
		return undefined;
	}
	const allowed = scopedAccounts(deps, access);
	return and(
		typeof deps.budgetOwnerId === "string"
			? inArray(recurringTransactions.accountId, allowed)
			: or(
					isNull(recurringTransactions.accountId),
					inArray(recurringTransactions.accountId, allowed),
				),
		or(
			isNull(recurringTransactions.destinationAccountId),
			inArray(recurringTransactions.destinationAccountId, allowed),
		),
	);
}

/** An accountless series can use payments from the entire ledger. */
export function recurringProcessingScope(accountIds: readonly string[] | undefined) {
	if (accountIds === undefined) {
		return undefined;
	}
	return and(
		accountIdFilter(recurringTransactions.accountId, accountIds),
		or(
			isNull(recurringTransactions.destinationAccountId),
			accountIdFilter(recurringTransactions.destinationAccountId, accountIds),
		),
	);
}

export function allocationScope(deps: Reader, access: AccountAccess = "read") {
	if (deps.actor === undefined && typeof deps.budgetOwnerId !== "string") {
		return undefined;
	}
	return or(
		isNull(recurringAllocations.entryId),
		transactionScope(deps, recurringAllocations.entryId, access),
	);
}

export async function requireMatchingSeriesEditable(deps: Reader, filter: SQL) {
	const allowed = recurringScope(deps, "edit");
	if (allowed === undefined) {
		return;
	}
	const blocked = await deps.db
		.select({ id: recurringTransactions.id })
		.from(recurringTransactions)
		.where(and(filter, not(allowed)))
		.get();
	if (blocked !== undefined) {
		throw forbidden();
	}
}

export async function requireSeries(deps: Reader, id: string, access: AccountAccess = "read") {
	if (deps.actor === undefined) {
		return;
	}
	const row = await deps.db
		.select({
			account: recurringTransactions.accountId,
			destination: recurringTransactions.destinationAccountId,
		})
		.from(recurringTransactions)
		.where(eq(recurringTransactions.id, id))
		.get();
	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No recurring transaction has this id.");
	}
	if (row.account !== null) {
		await requireAccount(deps, row.account, access);
	}
	if (row.destination !== null) {
		await requireAccount(deps, row.destination, access);
	}
}

export async function requireOccurrence(deps: Reader, id: string, access: AccountAccess = "read") {
	if (deps.actor === undefined) {
		return;
	}
	const row = await deps.db
		.select({ id: recurringOccurrences.recurringTransactionId })
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.id, id))
		.get();
	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No occurrence has this id.");
	}
	await requireSeries(deps, row.id, access);
}

export async function requirePayment(deps: Reader, id: string, access: AccountAccess) {
	if (deps.actor === undefined) {
		return;
	}
	const row = await deps.db
		.select({
			occurrence: recurringAllocations.recurringOccurrenceId,
			entry: recurringAllocations.entryId,
		})
		.from(recurringAllocations)
		.where(eq(recurringAllocations.id, id))
		.get();
	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No payment has this id.");
	}
	await requireOccurrence(deps, row.occurrence, access);
	if (row.entry !== null) {
		await requireEntry(deps, row.entry, access);
	}
}
