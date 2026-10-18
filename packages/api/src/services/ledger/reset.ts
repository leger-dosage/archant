import type { ServiceDeps } from "../deps.ts";
import type { Origin } from "./shared.ts";

import { gte, isNotNull } from "drizzle-orm";

import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { costBasisLocks, holdings } from "@archant/data/schema/holdings";
import { imports } from "@archant/data/schema/imports";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { ruleRuns, rules } from "@archant/data/schema/rules";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import { trades } from "@archant/data/schema/trades";
import { transactionAttachments } from "@archant/data/schema/transaction-attachments";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { AppError } from "../../lib/errors.ts";
import { LEASE_MS } from "../bank-connections.ts";
import { isSplitChild } from "./shared.ts";

/**
 * Sure's `Family::FinancialDataReset#delete_financial_data!`, mapped to
 * Archant's tables: every account and what it holds, imports, categories,
 * tags, merchants, rules and their runs, budgets, recurring series and bank
 * connections go; users, sessions, assistants, invitations, settings, goals
 * and the securities with their prices stay, as Sure keeps its users, its
 * goals and its global securities. A goal only loses the accounts backing
 * it, and a user their default account, through their foreign keys.
 *
 * One immediate transaction, so a failure leaves everything. A sync holding
 * its lease refuses it with `SYNC_IN_PROGRESS` before anything goes: it would
 * write into the ledger as it empties. The lease is read under the write lock,
 * so no sync takes one in between; a sync starting after finds no connection.
 * The bank's session is not revoked at the provider, as Sure's `destroy_all`
 * on its items does not.
 *
 * Children before parents, since their foreign keys restrict: split lines
 * before their parents, subcategories before theirs. Series, rules and
 * budgets take their own children by cascade, as connections their bank
 * accounts.
 */
export async function resetFinancialData(
	deps: ServiceDeps,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const syncing = await tx
				.select({ id: bankConnections.id })
				.from(bankConnections)
				.where(gte(bankConnections.syncStartedAt, Date.now() - LEASE_MS))
				.limit(1)
				.get();

			if (syncing !== undefined) {
				throw new AppError("SYNC_IN_PROGRESS", "This bank connection is already syncing.");
			}

			await tx.delete(ruleRuns);
			await tx.delete(rules);
			await tx.delete(budgets);
			await tx.delete(recurringTransactions);
			await tx.delete(entryKeys);
			await tx.delete(taggings);
			await tx.delete(transactionAttachments);
			await tx.delete(transfers);
			await tx.delete(rejectedTransfers);
			await tx.delete(trades);
			await tx.delete(transactions);
			await tx.delete(entries).where(isSplitChild);
			await tx.delete(entries);
			await tx.delete(holdings);
			await tx.delete(costBasisLocks);
			await tx.delete(balances);
			await tx.delete(imports);
			await tx.delete(accounts);
			await tx.delete(bankConnections);
			await tx.delete(categories).where(isNotNull(categories.parentId));
			await tx.delete(categories);
			await tx.delete(tags);
			await tx.delete(merchants);
		},
		{ behavior: "immediate" },
	);
}
