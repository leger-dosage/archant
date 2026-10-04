import type { IsoDate } from "../../domain/dates.ts";
import type { Origin, Transaction } from "./shared.ts";

import { asc, eq, sql } from "drizzle-orm";

import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { trades } from "@archant/data/schema/trades";

import { maxDate } from "../../domain/dates.ts";
import { recomputeBalances } from "./balances.ts";
import { oneByOne } from "./shared.ts";

/**
 * Values again what `securityId`'s prices from `from` on changed: each
 * account that traded it, a sold-out one included, recomputed from
 * `max(from, its first trade there)`, its holdings and balances together
 * (AD-22). Runs in the caller's transaction, so a price import commits its
 * prices and the values derived from them at once (AD-2); never a full
 * history, since every day before `from` kept its price.
 */
export async function revalueHoldings(
	tx: Transaction,
	securityId: string,
	from: IsoDate,
	timeZone: string,
	_options: { origin: Origin },
): Promise<void> {
	const firstTrade = sql<IsoDate>`min(${entries.date})`;
	const holders = await tx
		.select({
			id: accounts.id,
			type: accounts.type,
			currency: accounts.currency,
			firstTrade,
		})
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(eq(trades.securityId, securityId))
		.groupBy(accounts.id, accounts.type, accounts.currency)
		.orderBy(asc(accounts.id));

	await oneByOne(holders, async ({ firstTrade: first, ...account }) =>
		recomputeBalances(tx, account, maxDate(from, first), timeZone),
	);
}
