import type { IsoDate } from "../../domain/dates.ts";
import type { TradeSide } from "../../domain/trades.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";

import type { Micros } from "@archant/data/micros";
import { toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import type { PriceProviderId } from "@archant/data/schema/securities";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";

import { snapshotRejectionFor } from "../../domain/balances/snapshot.ts";
import { minDate, today } from "../../domain/dates.ts";
import { firstShortfall, sideOf, signedQuantity, tradeAmount } from "../../domain/trades.ts";
import { AppError } from "../../lib/errors.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { invalidField } from "./shared.ts";

/**
 * Which security a new trade is in: one already known, a listing the
 * provider's search found, or one typed by hand, such as a fonds euros.
 */
export type SecurityChoice =
	| { source: "known"; id: string }
	| {
			source: "listing";
			/** Yahoo's symbol with its venue's suffix, such as `MC.PA`, as its search returns it. */
			ticker: string;
			mic: string | null;
			name: string;
			/** The venue's usual currency; `null` takes the account's. */
			currency: string | null;
			provider: PriceProviderId;
	  }
	| { source: "manual"; isin: string | null; name: string };

export type TradeInput = {
	side: TradeSide;
	security: SecurityChoice;
	date: IsoDate;
	/** Unsigned, never zero: `side` gives the sign. */
	quantity: Micros;
	/** Per unit, in millionths of the account currency's major unit. */
	price: Micros;
	fee: MinorUnits;
};

/** An absent or `undefined` field is left as it is; the security never changes, as Sure's drawer. */
export type TradePatch = {
	side?: TradeSide | undefined;
	date?: IsoDate | undefined;
	quantity?: Micros | undefined;
	price?: Micros | undefined;
	fee?: MinorUnits | undefined;
};

const quantityUnavailable = () =>
	new AppError("QUANTITY_UNAVAILABLE", "The account would sell more than it holds.");

/** The account, refused unless it is an investment account: no other holds a security. */
async function investmentAccount(tx: Transaction, accountId: string) {
	const account = await accountWithOpeningDate(tx, accountId);

	if (account.type !== "investment") {
		throw new AppError("NOT_AN_INVESTMENT_ACCOUNT", "Only an investment account holds trades.");
	}

	return account;
}

/**
 * Dated as a snapshot is: after the opening date, whose anchor fixes its own
 * day, and not after today.
 */
function refuseDate(account: { openingDate: IsoDate }, date: IsoDate, timeZone: string): void {
	const reason = snapshotRejectionFor(date, {
		openingDate: account.openingDate,
		today: today(timeZone),
	});

	if (reason === "BEFORE_OPENING_DATE") {
		throw invalidField("date", "not_after_opening_date");
	}

	if (reason === "DATE_IN_FUTURE") {
		throw invalidField("date", "date_in_future");
	}
}

/** The cash amount, refused on the quantity when no balance could hold it. */
function amountOf(trade: { quantity: Micros; price: Micros; fee: MinorUnits }, currency: string) {
	const amount = tradeAmount(trade, currency);

	if (amount === null) {
		throw invalidField("quantity", "too_big");
	}

	return amount;
}

/**
 * Refuses a write after which the account's running quantity of the security
 * falls below zero on some day: a sale above what is held on its date, or an
 * edit or a deletion that leaves a later sale short, where Sure's
 * `CostBasisTracker` silently caps. `except` is the trade being rewritten,
 * `next` what it becomes, `null` when it goes.
 */
async function refuseShortfall(
	tx: Transaction,
	accountId: string,
	securityId: string,
	next: { date: IsoDate; quantity: Micros } | null,
	except?: string,
): Promise<void> {
	const held = await tx
		.select({ date: entries.date, quantity: trades.quantity })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(trades.securityId, securityId),
				except === undefined ? undefined : ne(trades.entryId, except),
			),
		);

	if (firstShortfall(next === null ? held : [...held, next]) !== null) {
		throw quantityUnavailable();
	}
}

/** What a new trade's security resolves to: its id, and its row when it is new. */
type Resolved = { id: string; row: typeof securities.$inferInsert | null };

function refuseCurrency(currency: string, accountCurrency: string): void {
	if (currency !== accountCurrency) {
		throw invalidField("security", "currency_mismatch");
	}
}

const securityColumns = { id: securities.id, currency: securities.currency };

/**
 * The stored security `choice` names, `undefined` when there is none yet. A
 * listing is found by its ticker in upper case and its venue, as the unique
 * index compares them, so `MC.PA` is stored once; a security typed by hand
 * by its ISIN among those with no ticker.
 */
async function existingSecurity(tx: Transaction, choice: SecurityChoice) {
	if (choice.source === "known") {
		return tx.select(securityColumns).from(securities).where(eq(securities.id, choice.id)).get();
	}

	if (choice.source === "listing") {
		return tx
			.select(securityColumns)
			.from(securities)
			.where(
				and(
					sql`upper(${securities.ticker}) = ${choice.ticker.toUpperCase()}`,
					sql`coalesce(${securities.mic}, '') = ${choice.mic ?? ""}`,
				),
			)
			.get();
	}

	return choice.isin === null
		? undefined
		: tx
				.select(securityColumns)
				.from(securities)
				.where(and(isNull(securities.ticker), eq(securities.isin, choice.isin)))
				.orderBy(asc(securities.createdAt), asc(securities.id))
				.get();
}

/**
 * A new security's row. A listing is stored as Yahoo's symbol with its
 * venue's suffix, upper-cased, the one form its search returns; one whose
 * venue names no currency takes the account's, the price fetch then flagging
 * a mismatch as Story 22.1's does. A security typed by hand has no ticker and
 * no provider, and takes the account's currency.
 */
function securityRow(
	choice: Exclude<SecurityChoice, { source: "known" }>,
	accountCurrency: string,
	now: number,
): typeof securities.$inferInsert & { id: string; currency: string } {
	const stamps = { id: crypto.randomUUID(), name: choice.name, createdAt: now, updatedAt: now };

	return choice.source === "listing"
		? {
				...stamps,
				isin: null,
				ticker: choice.ticker.toUpperCase(),
				mic: choice.mic,
				currency: choice.currency ?? accountCurrency,
				provider: choice.provider,
			}
		: {
				...stamps,
				isin: choice.isin,
				ticker: null,
				mic: null,
				currency: accountCurrency,
				provider: null,
			};
}

/**
 * The security `choice` names, found or still to create, in the account's
 * currency or refused (AD-6).
 */
async function resolveSecurity(
	tx: Transaction,
	choice: SecurityChoice,
	accountCurrency: string,
	now: number,
): Promise<Resolved> {
	const found = await existingSecurity(tx, choice);

	if (found !== undefined) {
		refuseCurrency(found.currency, accountCurrency);

		return { id: found.id, row: null };
	}

	if (choice.source === "known") {
		throw invalidField("security", "invalid_value");
	}

	const row = securityRow(choice, accountCurrency, now);
	refuseCurrency(row.currency, accountCurrency);

	return { id: row.id, row };
}

/**
 * Records a buy or a sale on an investment account (AD-22): an entry of
 * kind `trade` whose amount is its cash, `-(quantity × price + fee)`, in the
 * account's currency, beside its `trades` row, and the security when it is
 * new, all in one immediate transaction that recomputes the balances from
 * its date.
 */
export async function recordTrade(
	deps: ServiceDeps,
	accountId: string,
	input: TradeInput,
	_options: { origin: Origin },
): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			const account = await investmentAccount(tx, accountId);
			refuseDate(account, input.date, deps.timeZone);

			const now = Date.now();
			const security = await resolveSecurity(tx, input.security, account.currency, now);
			const quantity = signedQuantity(input.side, input.quantity);
			const amount = amountOf({ quantity, price: input.price, fee: input.fee }, account.currency);
			await refuseShortfall(tx, account.id, security.id, { date: input.date, quantity });

			if (security.row !== null) {
				await tx.insert(securities).values(security.row);
			}

			const id = crypto.randomUUID();
			await tx.insert(entries).values({
				id,
				accountId: account.id,
				kind: "trade",
				date: input.date,
				amount,
				currency: account.currency,
				createdAt: now,
				updatedAt: now,
			});
			await tx.insert(trades).values({
				entryId: id,
				securityId: security.id,
				quantity,
				price: input.price,
				fee: input.fee,
			});
			await recomputeBalances(tx, account, input.date, deps.timeZone);

			return { id };
		},
		{ behavior: "immediate" },
	);
}

async function tradeRow(tx: Transaction, id: string) {
	const row = await tx
		.select({
			accountId: entries.accountId,
			date: entries.date,
			securityId: trades.securityId,
			quantity: trades.quantity,
			price: trades.price,
			fee: trades.fee,
		})
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(eq(trades.entryId, id))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No trade has this id.");
	}

	return row;
}

/**
 * Changes a trade's side, date, quantity, price or fee, never its security,
 * as Sure's drawer, and recomputes from the earlier of its old and new dates.
 */
export async function updateTrade(
	deps: ServiceDeps,
	id: string,
	patch: TradePatch,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await tradeRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const date = patch.date ?? current.date;
			refuseDate(account, date, deps.timeZone);

			const quantity = signedQuantity(
				patch.side ?? sideOf(current.quantity),
				patch.quantity ?? toMicros(Math.abs(current.quantity)),
			);
			const price = patch.price ?? current.price;
			const fee = patch.fee ?? current.fee;
			const amount = amountOf({ quantity, price, fee }, account.currency);
			await refuseShortfall(tx, account.id, current.securityId, { date, quantity }, id);

			await tx
				.update(entries)
				.set({ date, amount, updatedAt: Date.now() })
				.where(eq(entries.id, id));
			await tx.update(trades).set({ quantity, price, fee }).where(eq(trades.entryId, id));
			await recomputeBalances(tx, account, minDate(current.date, date), deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes a trade and recomputes from its date. Refused when a later sale
 * would then sell more than the account holds. The security stays, a
 * history of prices with it.
 */
export async function deleteTrade(
	deps: ServiceDeps,
	id: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await tradeRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);
			await refuseShortfall(tx, account.id, current.securityId, null, id);

			await tx.delete(trades).where(eq(trades.entryId, id));
			await tx.delete(entries).where(eq(entries.id, id));
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

export type TradeRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	side: TradeSide;
	/** Unsigned: `side` gives the sign. */
	quantity: Micros;
	price: Micros;
	fee: MinorUnits;
	/** The cash amount (AD-5): negative for a buy. */
	amount: MinorUnits;
	currency: string;
	security: {
		id: string;
		name: string;
		ticker: string | null;
		mic: string | null;
		isin: string | null;
	};
};

const recordColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	quantity: trades.quantity,
	price: trades.price,
	fee: trades.fee,
	security: {
		id: securities.id,
		name: securities.name,
		ticker: securities.ticker,
		mic: securities.mic,
		isin: securities.isin,
	},
};

type RecordRow = {
	id: string;
	accountId: string;
	date: string;
	amount: number;
	currency: string;
	quantity: Micros;
	price: Micros;
	fee: MinorUnits;
	security: TradeRecord["security"];
};

function toRecord({ quantity, amount, ...row }: RecordRow): TradeRecord {
	return {
		...row,
		side: sideOf(quantity),
		quantity: toMicros(Math.abs(quantity)),
		amount: toMinorUnits(amount),
	};
}

function recordQuery(db: Pick<ServiceDeps["db"], "select">) {
	return db
		.select(recordColumns)
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.innerJoin(securities, eq(securities.id, trades.securityId));
}

/** One trade with its security, `null` when the id names none. */
export async function findTrade(deps: ServiceDeps, id: string): Promise<TradeRecord | null> {
	const row = await recordQuery(deps.db).where(eq(trades.entryId, id)).get();

	return row === undefined ? null : toRecord(row);
}

/** A page of an account's trades, most recent first (AD-15). */
export async function listTrades(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<{ items: TradeRecord[]; total: number }> {
	const where = and(eq(entries.accountId, accountId), eq(entries.kind, "trade"));
	const rows = await recordQuery(deps.db)
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(entries).where(where);

	return {
		items: rows.map(toRecord),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}

/**
 * Every traded security and the date of its first trade, on any account,
 * oldest first: a sold one too, since the past is valued from its prices, as
 * Sure's `MarketDataImporter` asks for prices from an account's first trade.
 */
export async function tradedSecurities(
	db: Pick<ServiceDeps["db"], "select">,
): Promise<{ securityId: string; from: IsoDate }[]> {
	const first = sql<IsoDate>`min(${entries.date})`;

	return db
		.select({ securityId: trades.securityId, from: first })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.groupBy(trades.securityId)
		.orderBy(asc(first), asc(trades.securityId));
}
