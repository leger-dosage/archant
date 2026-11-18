import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "./shared.ts";

import { and, between, desc, eq, inArray, isNull, lte } from "drizzle-orm";

import type { CurrencyCode } from "@archant/data/money";
import { minorUnitsOf, toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import { AppError } from "../../lib/errors.ts";

const LOOKBACK_DAYS = 90;
const MIN_MAJOR_UNITS = 100;
const SUGGESTION_LIMIT = 3;

type Scope = { accountIds: string[]; currency: CurrencyCode; date: IsoDate };

function outflowQuery(db: ServiceDeps["db"]) {
	return db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			date: entries.date,
			label: transactions.label,
			amount: entries.amount,
			consumedGoalId: transactions.consumedGoalId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id));
}

function eligible({ accountIds, currency, date }: Scope) {
	return and(
		inArray(entries.accountId, accountIds),
		eq(entries.currency, currency),
		between(entries.date, addDays(date, -LOOKBACK_DAYS), date),
		lte(entries.amount, -MIN_MAJOR_UNITS * 10 ** minorUnitsOf(currency)),
		eq(transactions.excluded, false),
		eq(transactions.pending, false),
		// The parent represents the booked debit. Its split lines repeat its money.
		isNull(entries.parentEntryId),
	);
}

export async function listGoalOutflows(db: ServiceDeps["db"], scope: Scope) {
	const rows = await outflowQuery(db)
		.where(and(eligible(scope), isNull(transactions.consumedGoalId)))
		.orderBy(desc(entries.date), desc(entries.id))
		.limit(SUGGESTION_LIMIT);

	return rows.map(({ id, accountId, date, label, amount }) => ({
		id,
		accountId,
		date,
		label,
		amount: toMinorUnits(-amount),
	}));
}

/** Called under the same write lock as the release of the goal's allocation. */
export async function claimGoalOutflow(
	tx: Transaction,
	scope: Scope,
	entryId: string,
	goalId: string,
) {
	const row = await outflowQuery(tx)
		.where(and(eligible(scope), eq(entries.id, entryId)))
		.get();

	if (row === undefined) {
		throw new AppError("GOAL_SPEND_REFUSED", "This outflow is no longer available.", undefined, {
			reason: "transaction_not_found",
		});
	}

	if (row.consumedGoalId !== null) {
		throw new AppError("GOAL_SPEND_REFUSED", "This outflow has already been claimed.", undefined, {
			reason: "transaction_already_claimed",
		});
	}

	await tx
		.update(transactions)
		.set({ consumedGoalId: goalId })
		.where(eq(transactions.entryId, entryId));

	return { accountId: row.accountId, amount: toMinorUnits(-row.amount) };
}
