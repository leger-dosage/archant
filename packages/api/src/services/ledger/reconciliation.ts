import type { ServiceDeps } from "../deps.ts";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";

import type { ReconciliationStatus } from "@archant/data/reconciliation";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";

import { AppError } from "../../lib/errors.ts";
import { requireEntry } from "../account-access.ts";
import { manualReconciliationEnabled } from "../manual-reconciliation.ts";
import { notSplitParent } from "./shared.ts";

export const manualAccountIds = new QueryBuilder()
	.select({ id: accounts.id })
	.from(accounts)
	.where(isNull(accounts.bankAccountId));

/** Writes only the checklist status, with eligibility checked in the same write transaction. */
export function setReconciliationStatus(
	deps: ServiceDeps,
	id: string,
	reconciliationStatus: ReconciliationStatus,
): Promise<ReconciliationStatus> {
	return deps.db.transaction(
		async (tx) => {
			await requireEntry({ ...deps, db: tx }, id, "edit");
			const unavailable = new AppError("NOT_FOUND", "No reconcilable transaction has this id.");

			if (!(await manualReconciliationEnabled(tx))) {
				throw unavailable;
			}

			const row = await tx
				.update(entries)
				.set({ reconciliationStatus })
				.where(
					and(
						eq(entries.id, id),
						eq(entries.kind, "transaction"),
						notSplitParent,
						inArray(entries.accountId, manualAccountIds),
					),
				)
				.returning({ reconciliationStatus: entries.reconciliationStatus })
				.get();

			if (row === undefined) {
				throw unavailable;
			}

			return row.reconciliationStatus;
		},
		{ behavior: "immediate" },
	);
}
