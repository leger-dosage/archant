import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, asc, desc, eq, gt, gte, inArray, lte, max, min, sql } from "drizzle-orm";

import type { Micros } from "@archant/data/micros";
import { toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { MAX_MINOR_UNITS, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { costBasisLocks, holdings } from "@archant/data/schema/holdings";
import type { PriceProviderId } from "@archant/data/schema/securities";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";
import { trades } from "@archant/data/schema/trades";

import { maxDate, today } from "../../domain/dates.ts";
import { marketValue } from "../../domain/trades.ts";
import { AppError } from "../../lib/errors.ts";
import { accountWithOpeningDate, lastBalanceOnOrBefore, recomputeBalances } from "./balances.ts";
import { invalidField, movesQuantity, oneByOne } from "./shared.ts";

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
		.where(and(eq(trades.securityId, securityId), movesQuantity))
		.groupBy(accounts.id, accounts.type, accounts.currency)
		.orderBy(asc(accounts.id));

	await oneByOne(holders, async ({ firstTrade: first, ...account }) =>
		recomputeBalances(tx, account, maxDate(from, first), timeZone),
	);
}

const FEE_COST_BASIS_KEY = "fee_cost_basis_recomputed_at";

/**
 * Rewrites every investment account's holdings once per instance, so a cost
 * basis stored before a buy's fee counted in it (Story 27.5) gets that fee,
 * and returns how many accounts it recomputed. A migration cannot replay
 * trades, so the `fee_cost_basis_recomputed_at` row is claimed in the same
 * transaction as the recompute (AD-12): a failure rolls the claim back and
 * the next start tries again, a later start recomputes nothing. No balance
 * moves, since neither a holding's amount nor the cash reads its cost basis
 * (AD-22).
 */
export async function recomputeFeeCostBases(
	deps: Pick<ServiceDeps, "db" | "timeZone">,
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const now = Date.now();
			const claimed = await tx
				.insert(settings)
				.values({ key: FEE_COST_BASIS_KEY, value: String(now), updatedAt: now })
				.onConflictDoNothing()
				.returning({ key: settings.key });

			if (claimed.length === 0) {
				return 0;
			}

			const investments = await tx
				.select({
					id: accounts.id,
					type: accounts.type,
					currency: accounts.currency,
					openingDate: entries.date,
				})
				.from(accounts)
				.innerJoin(
					entries,
					and(eq(entries.accountId, accounts.id), eq(entries.valuationKind, "opening_anchor")),
				)
				.where(eq(accounts.type, "investment"))
				.orderBy(asc(accounts.id));

			await oneByOne(investments, async ({ openingDate, ...account }) =>
				recomputeBalances(tx, account, openingDate, deps.timeZone),
			);

			return investments.length;
		},
		{ behavior: "immediate" },
	);
}

type Reader = Pick<ServiceDeps["db"], "select"> | Pick<Transaction, "select">;

/** A security an account holds at the end of a day, as its positions read it. */
export type CurrentHolding = {
	security: {
		id: string;
		name: string;
		ticker: string | null;
		mic: string | null;
		isin: string | null;
		/** `null` for a security priced by hand. */
		provider: PriceProviderId | null;
		offline: boolean;
	};
	/** Above zero: a security sold out is no position. */
	quantity: Micros;
	/** Per unit, in millionths of the account currency's major unit. */
	price: Micros;
	amount: MinorUnits;
	/** The lock's when the owner set one on this position, else the calculated one. */
	costBasis: Micros | null;
	costBasisLocked: boolean;
	/**
	 * The day the price shown was set: the later of the security's last
	 * stored price and its last trade on this account, neither after the
	 * holdings' day.
	 */
	priceDate: IsoDate;
};

export type CurrentHoldings = {
	/** The account's last holdings day on or before the day asked; `null` with no trade then. */
	date: IsoDate | null;
	/** By value, then name. */
	holdings: CurrentHolding[];
	/** The cash of the last stored balance on or before the day asked; zero before the opening date. */
	cash: MinorUnits;
};

/**
 * A cost basis the owner locked on a position still running: `after` is the
 * position's last day at quantity zero before it, `null` when it never was,
 * so the lock stands on the days after it that hold the security.
 */
export type LiveCostBasisLock = {
	accountId: string;
	securityId: string;
	costBasis: Micros;
	after: IsoDate | null;
};

/**
 * The rule that a full sale ends a lock: the first day at quantity zero on or
 * after the day it was locked, `null` while none, read per lock row of the
 * query it goes in. A seek into the partial index `holdings_zero_quantity`:
 * the zero is a literal, never a bound parameter, since SQLite proves a
 * partial index applies only from the query's text.
 */
function lockEndedOn(db: Reader) {
	const firstZero = db
		.select({ day: min(holdings.date) })
		.from(holdings)
		.where(
			and(
				eq(holdings.accountId, costBasisLocks.accountId),
				eq(holdings.securityId, costBasisLocks.securityId),
				sql`${holdings.quantity} = 0`,
				gte(holdings.date, costBasisLocks.lockedOn),
			),
		);

	return sql<IsoDate | null>`(${firstZero})`;
}

/**
 * The cost basis locks whose position still runs, one account's or every
 * one's. A day at quantity zero on or after the day it was locked ended that
 * position, a full sale, and the lock with it: a rebuy is priced from its own
 * buys, as Sure's tracker starts over. Such a lock stays in its table, read
 * by nothing, until the owner locks or unlocks that security again.
 */
export async function liveCostBasisLocks(
	db: Reader,
	accountId: string | null,
): Promise<LiveCostBasisLock[]> {
	// `after`, which the export reads, and the lock's end: per lock, seeks
	// into the partial index `holdings_zero_quantity`, the locks being few and
	// the holdings ten years of days per security. The zero is a literal.
	const lastZero = db
		.select({ day: max(holdings.date) })
		.from(holdings)
		.where(
			and(
				eq(holdings.accountId, costBasisLocks.accountId),
				eq(holdings.securityId, costBasisLocks.securityId),
				sql`${holdings.quantity} = 0`,
			),
		);
	const rows = await db
		.select({
			accountId: costBasisLocks.accountId,
			securityId: costBasisLocks.securityId,
			costBasis: costBasisLocks.costBasis,
			after: sql<IsoDate | null>`(${lastZero})`,
			endedOn: lockEndedOn(db),
		})
		.from(costBasisLocks)
		.where(accountId === null ? undefined : eq(costBasisLocks.accountId, accountId))
		.orderBy(asc(costBasisLocks.accountId), asc(costBasisLocks.securityId));

	return rows
		.filter(({ endedOn }) => endedOn === null)
		.map(({ endedOn: _endedOn, ...lock }) => lock);
}

/** The account's last holdings day on or before `day`, `null` before its first trade. */
async function lastHoldingsDay(db: Reader, accountId: string, day: IsoDate) {
	const row = await db
		.select({ date: max(holdings.date) })
		.from(holdings)
		.where(and(eq(holdings.accountId, accountId), lte(holdings.date, day)))
		.get();

	return row?.date ?? null;
}

/**
 * What an account holds at the end of `day`, as Sure's holdings table reads
 * it: each security's holding on the account's last holdings day on or
 * before `day`, quantity above zero, by value then name, its cost basis the
 * lock's when the owner set one on this position (AD-22), and the cash of the
 * last stored balance on or before `day`.
 */
export async function currentHoldings(
	db: Reader,
	accountId: string,
	day: IsoDate,
): Promise<CurrentHoldings> {
	const balance = await lastBalanceOnOrBefore(db, accountId, day);
	const cash = toMinorUnits(balance?.cash ?? 0);
	const date = await lastHoldingsDay(db, accountId, day);

	if (date === null) {
		return { date, holdings: [], cash };
	}

	// The later of the last stored price and the last trade on the account:
	// a held security always has a trade, the stored price may be missing. A
	// dividend sets no price.
	const lastPrice = db
		.select({ date: max(securityPrices.date) })
		.from(securityPrices)
		.where(and(eq(securityPrices.securityId, holdings.securityId), lte(securityPrices.date, date)));
	const lastTrade = db
		.select({ date: max(entries.date) })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(trades.securityId, holdings.securityId),
				movesQuantity,
				lte(entries.date, date),
			),
		);
	const rows = await db
		.select({
			quantity: holdings.quantity,
			price: holdings.price,
			amount: holdings.amount,
			costBasis: holdings.costBasis,
			priceDate: sql<IsoDate>`max(coalesce((${lastPrice}), (${lastTrade})), (${lastTrade}))`,
			security: {
				id: securities.id,
				name: securities.name,
				ticker: securities.ticker,
				mic: securities.mic,
				isin: securities.isin,
				provider: securities.provider,
				offline: securities.offline,
			},
		})
		.from(holdings)
		.innerJoin(securities, eq(securities.id, holdings.securityId))
		.where(
			and(
				eq(holdings.accountId, accountId),
				eq(holdings.date, date),
				gt(holdings.quantity, toMicros(0)),
			),
		)
		.orderBy(desc(holdings.amount), asc(securities.name), asc(securities.id));
	const locked = new Map(
		(await liveCostBasisLocks(db, accountId)).map((lock) => [lock.securityId, lock.costBasis]),
	);

	return {
		date,
		holdings: rows.map((row) => {
			const lock = locked.get(row.security.id);

			return {
				...row,
				amount: toMinorUnits(row.amount),
				costBasis: lock ?? row.costBasis,
				costBasisLocked: lock !== undefined,
			};
		}),
		cash,
	};
}

/** A security's last held day on an account, as Sure's `get_holdings` lists it. */
export type LastHeldHolding = {
	accountId: string;
	security: { id: string; name: string; ticker: string | null };
	/** The last day it was held, today for a position still running. */
	date: IsoDate;
	/** Above zero: that day's quantity, a sold-out security's last one. */
	quantity: Micros;
	price: Micros;
	amount: MinorUnits;
	/** The lock's when one stands on that day, else the calculated one. */
	costBasis: Micros | null;
};

/**
 * Each security's last holding above zero on or before `day`, on each of
 * `accountIds`, a security sold out included at its last held quantity, as
 * Sure's `DISTINCT ON (account_id, security_id)` over `qty <> 0`. Its cost
 * basis is the lock's when no day at zero falls between the lock's day and
 * the row's, so a lock stands on the last day of a position sold since.
 */
export async function lastHeldHoldings(
	db: Reader,
	accountIds: readonly string[],
	day: IsoDate,
): Promise<LastHeldHolding[]> {
	if (accountIds.length === 0) {
		return [];
	}

	// No index: the primary key's `account_id` prefix bounds the scan to the
	// accounts asked, once per assistant call.
	const lastHeld = db
		.select({
			accountId: holdings.accountId,
			securityId: holdings.securityId,
			day: max(holdings.date).as("day"),
		})
		.from(holdings)
		.where(
			and(
				inArray(holdings.accountId, [...accountIds]),
				lte(holdings.date, day),
				gt(holdings.quantity, toMicros(0)),
			),
		)
		.groupBy(holdings.accountId, holdings.securityId)
		.as("last_held");
	const rows = await db
		.select({
			accountId: holdings.accountId,
			date: holdings.date,
			quantity: holdings.quantity,
			price: holdings.price,
			amount: holdings.amount,
			costBasis: holdings.costBasis,
			security: { id: securities.id, name: securities.name, ticker: securities.ticker },
		})
		.from(holdings)
		.innerJoin(
			lastHeld,
			and(
				eq(holdings.accountId, lastHeld.accountId),
				eq(holdings.securityId, lastHeld.securityId),
				eq(holdings.date, lastHeld.day),
			),
		)
		.innerJoin(securities, eq(securities.id, holdings.securityId))
		.orderBy(asc(holdings.accountId), asc(securities.id));
	const locks = new Map(
		(
			await db
				.select({
					accountId: costBasisLocks.accountId,
					securityId: costBasisLocks.securityId,
					costBasis: costBasisLocks.costBasis,
					endedOn: lockEndedOn(db),
				})
				.from(costBasisLocks)
				.where(inArray(costBasisLocks.accountId, [...accountIds]))
		).map((lock) => [`${lock.accountId}:${lock.securityId}`, lock]),
	);

	return rows.map((row) => {
		const lock = locks.get(`${row.accountId}:${row.security.id}`);
		// A lock stands on a row unless a day at zero falls between its day and the row's.
		const locked = lock !== undefined && (lock.endedOn === null || lock.endedOn > row.date);

		return {
			...row,
			amount: toMinorUnits(row.amount),
			costBasis: locked ? lock.costBasis : row.costBasis,
		};
	});
}

/** The refusal of a cost basis for a security the account does not hold. */
export const notHeld = () => new AppError("NOT_FOUND", "The account holds none of this security.");

/**
 * The quantity the investment account `accountId` holds of `securityId`
 * today, refused when it holds none: only a position has a cost basis to
 * lock. Also returns the account's currency and today's date.
 */
async function heldToday(
	tx: Transaction,
	accountId: string,
	securityId: string,
	timeZone: string,
): Promise<{ quantity: Micros; currency: string; day: IsoDate }> {
	const account = await accountWithOpeningDate(tx, accountId);

	if (account.type !== "investment") {
		throw new AppError("NOT_AN_INVESTMENT_ACCOUNT", "Only an investment account holds trades.");
	}

	const day = today(timeZone);
	const date = await lastHoldingsDay(tx, accountId, day);
	const row =
		date === null
			? undefined
			: await tx
					.select({ quantity: holdings.quantity })
					.from(holdings)
					.where(
						and(
							eq(holdings.accountId, accountId),
							eq(holdings.date, date),
							eq(holdings.securityId, securityId),
							gt(holdings.quantity, toMicros(0)),
						),
					)
					.get();

	if (row === undefined) {
		throw notHeld();
	}

	return { quantity: row.quantity, currency: account.currency, day };
}

/**
 * Sets a position's cost basis by hand and locks it, as Sure's
 * `set_manual_cost_basis!`: every reader then takes it over the calculated
 * one, until a full sale ends the position. Holdings keep theirs and no
 * balance moves, so nothing is recomputed. A cost basis whose book value no
 * balance could hold is refused on `costBasis`, as a trade's amount is.
 */
export async function lockCostBasis(
	deps: ServiceDeps,
	accountId: string,
	securityId: string,
	costBasis: Micros,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const held = await heldToday(tx, accountId, securityId, deps.timeZone);

			if (marketValue(held.quantity, costBasis, held.currency) > BigInt(MAX_MINOR_UNITS)) {
				throw invalidField("costBasis", "too_big");
			}

			await tx
				.insert(costBasisLocks)
				.values({ accountId, securityId, costBasis, lockedOn: held.day })
				.onConflictDoUpdate({
					target: [costBasisLocks.accountId, costBasisLocks.securityId],
					set: { costBasis, lockedOn: held.day },
				});
		},
		{ behavior: "immediate" },
	);
}

/**
 * Unlocks a position's cost basis: the calculated one is back at once, as
 * Sure's next sync replaces an unlocked manual one, a lock a full sale ended
 * deleted with it. Nothing is recomputed.
 */
export async function unlockCostBasis(
	deps: ServiceDeps,
	accountId: string,
	securityId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			await heldToday(tx, accountId, securityId, deps.timeZone);
			await tx
				.delete(costBasisLocks)
				.where(
					and(eq(costBasisLocks.accountId, accountId), eq(costBasisLocks.securityId, securityId)),
				);
		},
		{ behavior: "immediate" },
	);
}
