import type { IsoDate } from "../../domain/dates.ts";
import type { AccountPace } from "../../domain/goals.ts";
import type { ServiceDeps } from "../deps.ts";
import type { SQL } from "drizzle-orm";

import { and, between, eq, inArray, lte, sum } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import { GOAL_PACE_DAYS } from "../../domain/goals.ts";
import { balanceOn } from "./balances.ts";
import { notSplitParent } from "./shared.ts";

function bookedTransactions(accountIds: string[], excluded: boolean, dates: SQL) {
	return and(
		inArray(entries.accountId, accountIds),
		eq(transactions.pending, false),
		eq(transactions.excluded, excluded),
		notSplitParent,
		dates,
	);
}

function netInflows(db: ServiceDeps["db"], accountIds: string[], excluded: boolean, dates: SQL) {
	return db
		.select({ accountId: entries.accountId, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(bookedTransactions(accountIds, excluded, dates))
		.groupBy(entries.accountId);
}

/** Sure's two adjacent contribution windows, with its inclusive date boundaries. */
export async function goalContributionWindows(
	db: ServiceDeps["db"],
	accountIds: string[],
	date: IsoDate,
) {
	const windowDays = 30;
	const [current, prior] = await Promise.all([
		netInflows(db, accountIds, false, between(entries.date, addDays(date, -windowDays), date)),
		netInflows(
			db,
			accountIds,
			false,
			between(entries.date, addDays(date, -2 * windowDays), addDays(date, -windowDays - 1)),
		),
	]);

	return {
		contributed: toMinorUnits(current.reduce((total, row) => total + row.amount, 0)),
		priorContribution: toMinorUnits(prior.reduce((total, row) => total + row.amount, 0)),
	};
}

/** One set of account movements serves every goal, including goals sharing an earmarked account. */
export async function accountPaces(
	deps: ServiceDeps,
	balances: ReadonlyMap<string, MinorUnits>,
	date: IsoDate,
): Promise<Map<string, AccountPace>> {
	const accountIds = [...balances.keys()];
	const recent = await netInflows(
		deps.db,
		accountIds,
		false,
		between(entries.date, addDays(date, -GOAL_PACE_DAYS), date),
	);
	const paces = new Map<string, AccountPace>(
		recent.map(({ accountId, amount }) => [accountId, { change: toMinorUnits(amount), months: 3 }]),
	);
	const withoutRecent = accountIds.filter((id) => !paces.has(id));

	if (withoutRecent.length === 0) {
		return paces;
	}

	// An opening anchor only establishes the starting balance.
	const cutoff = addDays(date, -365);
	const valuations = await deps.db
		.selectDistinct({ accountId: entries.accountId })
		.from(entries)
		.where(
			and(
				inArray(entries.accountId, withoutRecent),
				inArray(entries.valuationKind, ["reconciliation", "current_anchor"]),
				between(entries.date, cutoff, date),
			),
		);
	const valuedIds = new Set(valuations.map(({ accountId }) => accountId));
	const [dormant, excluded, starts] = await Promise.all([
		deps.db
			.selectDistinct({ accountId: entries.accountId })
			.from(entries)
			.innerJoin(transactions, eq(transactions.entryId, entries.id))
			.where(
				bookedTransactions(
					withoutRecent.filter((id) => !valuedIds.has(id)),
					false,
					lte(entries.date, date),
				),
			),
		netInflows(deps.db, [...valuedIds], true, between(entries.date, addDays(cutoff, 1), date)),
		Promise.all(
			valuations.map(async ({ accountId }) => ({
				accountId,
				start: await balanceOn(deps, accountId, cutoff),
			})),
		),
	]);
	const excludedById = new Map(excluded.map(({ accountId, amount }) => [accountId, amount]));

	for (const { accountId } of dormant) {
		paces.set(accountId, { change: toMinorUnits(0), months: 3 });
	}

	for (const { accountId, start } of starts) {
		const current = balances.get(accountId);

		if (start !== null && current !== undefined) {
			paces.set(accountId, {
				change: toMinorUnits(current - start.amount - (excludedById.get(accountId) ?? 0)),
				months: 12,
			});
		}
	}

	return paces;
}
