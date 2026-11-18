import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";

import { and, eq, gt, isNotNull, lte, ne, or, sum } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import { lastBalanceOnOrBefore, openingAnchorOf } from "./balances.ts";
import { notSplitParent } from "./shared.ts";

/**
 * Sure's market flows telescope to the change in holdings less net purchases.
 * Archant also supports investment accounts tracked by total valuations: any
 * change they record beyond booked cash flows is market movement. An opening
 * anchor establishes capital, and buys and sales move money within the account.
 */
export async function goalMarketGains(
	deps: ServiceDeps,
	accountIds: readonly string[],
	to: IsoDate,
	cutoff: IsoDate = to,
) {
	const { db } = deps;
	return new Map(
		await Promise.all(
			accountIds.map(async (id) => {
				const opening = await openingAnchorOf(deps, id);
				const recent = gt(entries.date, cutoff);
				const [end, beforeOpening, atCutoff, flows] = await Promise.all([
					lastBalanceOnOrBefore(db, id, to),
					opening === null || opening.date > to
						? undefined
						: lastBalanceOnOrBefore(db, id, addDays(opening.date, -1)),
					lastBalanceOnOrBefore(db, id, cutoff),
					db
						.select({
							recent,
							amount: sum(entries.amount).mapWith(Number),
						})
						.from(entries)
						.leftJoin(transactions, eq(transactions.entryId, entries.id))
						.leftJoin(trades, eq(trades.entryId, entries.id))
						.where(
							and(
								eq(entries.accountId, id),
								lte(entries.date, to),
								opening === null ? undefined : ne(entries.date, opening.date),
								notSplitParent,
								or(eq(transactions.pending, false), isNotNull(trades.incomeKind)),
							),
						)
						.groupBy(recent),
				]);
				const capital =
					opening === null || opening.date > to
						? 0
						: opening.balance - (beforeOpening?.balance ?? 0);
				const totalFunding = flows.reduce((total, row) => total + row.amount, 0);
				const recentFunding = flows.find((row) => row.recent)?.amount ?? 0;
				return [
					id,
					{
						total: toMinorUnits((end?.balance ?? 0) - capital - totalFunding),
						since: toMinorUnits(
							(end?.balance ?? 0) -
								(atCutoff?.balance ?? 0) -
								(opening !== null && opening.date > cutoff ? capital : 0) -
								recentFunding,
						),
					},
				] as const;
			}),
		),
	);
}
