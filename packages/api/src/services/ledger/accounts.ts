import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin } from "./shared.ts";

import { and, eq, inArray } from "drizzle-orm";

import type { AccountSubtype, AccountType, LoanDetails } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { deletedEntryKeys, entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { Account } from "@archant/data/types";

import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { isSplitChild, rejectedOf, transferOf } from "./shared.ts";

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

/**
 * Deletes an account and everything it holds, as one write: its entries'
 * keys and the tombstones of the ones the user deleted, its transactions'
 * taggings, transfers and rejected pairs, its transactions, all its entries,
 * split lines before their parents, snapshots and opening anchor included,
 * its daily balances, its imports, then the account. Children go first,
 * since their foreign keys restrict. A transfer's other side, on another
 * account, stays as a standard transaction, as Sure's `cleanup_transfers`
 * leaves it. Every delete selects
 * by `account_id` through a subquery, never a list of ids, so a history of
 * 100,000 transactions binds one parameter, not 100,000.
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
			await tx.delete(deletedEntryKeys).where(eq(deletedEntryKeys.accountId, accountId));
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
			// Split lines before their parents, which their foreign key restricts.
			await tx.delete(entries).where(and(eq(entries.accountId, accountId), isSplitChild));
			await tx.delete(entries).where(eq(entries.accountId, accountId));
			await tx.delete(balances).where(eq(balances.accountId, accountId));
			await tx.delete(imports).where(eq(imports.accountId, accountId));
			await tx.delete(accounts).where(eq(accounts.id, accountId));
		},
		{ behavior: "immediate" },
	);
}
