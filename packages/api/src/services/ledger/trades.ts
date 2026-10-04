import type { IsoDate } from "../../domain/dates.ts";
import type { TradeSide, TradeType } from "../../domain/trades.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, asc, count, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";

import type { IncomeKind } from "@archant/data/income-kinds";
import type { Micros } from "@archant/data/micros";
import { toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import type { PriceProviderId } from "@archant/data/schema/securities";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";

import { snapshotRejectionFor } from "../../domain/balances/snapshot.ts";
import { minDate, today } from "../../domain/dates.ts";
import {
	conversionFee,
	isIncome,
	sideOf,
	signFits,
	signedQuantity,
	tradeAmount,
	typeOf,
} from "../../domain/trades.ts";
import { AppError } from "../../lib/errors.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import {
	invalidField,
	lockedBy,
	movesQuantity,
	refuseShortfall,
	tradedSecurityId,
} from "./shared.ts";
import { splitRow } from "./splits.ts";

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

/**
 * A held security, as an income names it, or `null` for interest on the
 * account's cash, as Sure's `Security.cash_for`.
 */
type IncomeSecurity = { source: "known"; id: string } | null;

export type TradeInput =
	| {
			side: TradeSide;
			security: SecurityChoice;
			date: IsoDate;
			/** Unsigned, never zero: `side` gives the sign. */
			quantity: Micros;
			/** Per unit, in millionths of the account currency's major unit. */
			price: Micros;
			fee: MinorUnits;
	  }
	| {
			side: IncomeKind;
			security: IncomeSecurity;
			date: IsoDate;
			/** The cash it brought, above zero (AD-5). */
			amount: MinorUnits;
	  };

/**
 * An absent or `undefined` field is left as it is; the security and the
 * kind never change, as Sure's drawer. A buy or a sale takes `side`,
 * `quantity`, `price` and `fee`, an income `amount`.
 */
export type TradePatch = {
	side?: TradeSide | undefined;
	date?: IsoDate | undefined;
	quantity?: Micros | undefined;
	price?: Micros | undefined;
	fee?: MinorUnits | undefined;
	amount?: MinorUnits | undefined;
};

/**
 * What turns a transaction into a trade: a buy or a sale's security,
 * quantity and price, the fee being what is left; an income's security.
 */
export type ConversionInput =
	| { side: TradeSide; security: SecurityChoice; quantity: Micros; price: Micros }
	| { side: IncomeKind; security: IncomeSecurity };

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

/** An income's amount, refused unless it is money in (AD-5). */
function refuseIncomeAmount(amount: MinorUnits): void {
	if (amount <= 0) {
		throw invalidField("amount", "not_positive");
	}
}

/**
 * Refuses an income on a security the account had not bought by `date`, as
 * Sure's form offers the account's holdings only, or a dividend on cash,
 * which only a security pays.
 */
async function refuseIncomeSecurity(
	tx: Transaction,
	accountId: string,
	side: IncomeKind,
	securityId: string | null,
	date: IsoDate,
): Promise<void> {
	if (securityId === null) {
		if (side === "dividend") {
			throw invalidField("security", "too_small");
		}

		return;
	}

	const bought = await tx
		.select({ id: trades.entryId })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(trades.securityId, securityId),
				gt(trades.quantity, toMicros(0)),
				lte(entries.date, date),
			),
		)
		.get();

	if (bought === undefined) {
		throw invalidField("security", "not_held");
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

/** A trade's own row, as `trades` holds it. */
type TradeRow = {
	securityId: string | null;
	incomeKind: IncomeKind | null;
	quantity: Micros;
	price: Micros;
	fee: MinorUnits;
};

/**
 * Writes a trade's entry, its `trades` row and its security when it is new,
 * then recomputes the balances from its date. `parentEntryId` names the
 * transaction converted into it (AD-20).
 */
async function insertTrade(
	deps: ServiceDeps,
	tx: Transaction,
	account: Awaited<ReturnType<typeof investmentAccount>>,
	trade: TradeRow & { date: IsoDate; amount: MinorUnits; parentEntryId: string | null },
	newSecurity: Resolved["row"],
	now: number,
): Promise<string> {
	if (newSecurity !== null) {
		await tx.insert(securities).values(newSecurity);
	}

	const id = crypto.randomUUID();
	await tx.insert(entries).values({
		id,
		accountId: account.id,
		kind: "trade",
		date: trade.date,
		amount: trade.amount,
		currency: account.currency,
		parentEntryId: trade.parentEntryId,
		createdAt: now,
		updatedAt: now,
	});
	await tx.insert(trades).values({
		entryId: id,
		securityId: trade.securityId,
		incomeKind: trade.incomeKind,
		quantity: trade.quantity,
		price: trade.price,
		fee: trade.fee,
	});
	await recomputeBalances(tx, account, trade.date, deps.timeZone);

	return id;
}

/** An income's `trades` row: quantity, price and fee zero (AD-22). */
function incomeRow(side: IncomeKind, security: IncomeSecurity): TradeRow {
	return {
		securityId: security?.id ?? null,
		incomeKind: side,
		quantity: toMicros(0),
		price: toMicros(0),
		fee: toMinorUnits(0),
	};
}

/**
 * Records a trade on an investment account (AD-22): an entry of kind
 * `trade` whose amount is its cash, in the account's currency, beside its
 * `trades` row, and the security when it is new, all in one immediate
 * transaction that recomputes the balances from its date. A buy or a sale
 * moves `-(quantity × price + fee)`; a dividend or interest, a trade of
 * quantity zero as Sure's `Trade::CreateForm`, its amount, above zero, on a
 * security the account bought by its date or, for interest, on its cash.
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

			if (isIncome(input)) {
				refuseIncomeAmount(input.amount);
				await refuseIncomeSecurity(
					tx,
					account.id,
					input.side,
					input.security?.id ?? null,
					input.date,
				);

				const id = await insertTrade(
					deps,
					tx,
					account,
					{
						...incomeRow(input.side, input.security),
						date: input.date,
						amount: input.amount,
						parentEntryId: null,
					},
					null,
					now,
				);

				return { id };
			}

			const security = await resolveSecurity(tx, input.security, account.currency, now);
			const quantity = signedQuantity(input.side, input.quantity);
			const amount = amountOf({ quantity, price: input.price, fee: input.fee }, account.currency);
			await refuseShortfall(tx, account.id, security.id, { date: input.date, quantity });

			const id = await insertTrade(
				deps,
				tx,
				account,
				{
					securityId: security.id,
					incomeKind: null,
					quantity,
					price: input.price,
					fee: input.fee,
					date: input.date,
					amount,
					parentEntryId: null,
				},
				security.row,
				now,
			);

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
			amount: entries.amount,
			parentEntryId: entries.parentEntryId,
			securityId: trades.securityId,
			// Read for a buy or a sale only, which is always in a security.
			orderSecurityId: tradedSecurityId,
			incomeKind: trades.incomeKind,
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

type CurrentTrade = Awaited<ReturnType<typeof tradeRow>>;

/** What an edit makes of a buy or a sale; an income field is refused. */
function nextOrder(
	current: CurrentTrade,
	patch: TradePatch,
	currency: string,
): { quantity: Micros; price: Micros; fee: MinorUnits; amount: MinorUnits } {
	if (patch.amount !== undefined) {
		throw invalidField("amount");
	}

	const quantity = signedQuantity(
		patch.side ?? sideOf(current.quantity),
		patch.quantity ?? toMicros(Math.abs(current.quantity)),
	);
	const price = patch.price ?? current.price;
	const fee = patch.fee ?? current.fee;

	return { quantity, price, fee, amount: amountOf({ quantity, price, fee }, currency) };
}

/** What an edit makes of an income: its amount alone; a buy or a sale's field is refused. */
function nextIncomeAmount(current: CurrentTrade, patch: TradePatch): MinorUnits {
	for (const field of ["side", "quantity", "price", "fee"] as const) {
		if (patch[field] !== undefined) {
			throw invalidField(field);
		}
	}

	const amount = patch.amount ?? toMinorUnits(current.amount);
	refuseIncomeAmount(amount);

	return amount;
}

/**
 * Changes a trade's date and figures, never its security or its kind, as
 * Sure's drawer: a buy or a sale its side, quantity, price and fee, an
 * income its amount. Recomputes from the earlier of its old and new dates.
 * A converted trade keeps its transaction's date and amount, or the edit is
 * `TRANSACTION_SPLIT`, as a split line's would be (AD-20).
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

			const figures =
				current.incomeKind === null
					? nextOrder(current, patch, account.currency)
					: {
							quantity: current.quantity,
							price: current.price,
							fee: current.fee,
							amount: nextIncomeAmount(current, patch),
						};

			if (
				current.parentEntryId !== null &&
				(date !== current.date || figures.amount !== current.amount)
			) {
				throw new AppError("TRANSACTION_SPLIT", "This trade keeps its transaction's figures.");
			}

			if (current.incomeKind === null) {
				await refuseShortfall(
					tx,
					account.id,
					current.orderSecurityId,
					{ date, quantity: figures.quantity },
					id,
				);
			} else if (date !== current.date) {
				// Checked when the income moves only: deleting the buy it relied on
				// leaves it, as Sure does, and its amount must stay editable.
				await refuseIncomeSecurity(tx, account.id, current.incomeKind, current.securityId, date);
			}

			await tx
				.update(entries)
				.set({ date, amount: figures.amount, updatedAt: Date.now() })
				.where(eq(entries.id, id));
			await tx
				.update(trades)
				.set({ quantity: figures.quantity, price: figures.price, fee: figures.fee })
				.where(eq(trades.entryId, id));
			await recomputeBalances(tx, account, minDate(current.date, date), deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes a trade and recomputes from its date. Refused when a later sale
 * would then sell more than the account holds. The security stays, a
 * history of prices with it. A converted trade's transaction comes back,
 * counted again, its exclusion still locked, as Sure's `unsplit!` leaves a
 * split's parent.
 */
export async function deleteTrade(
	deps: ServiceDeps,
	id: string,
	options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await tradeRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);

			if (current.incomeKind === null) {
				await refuseShortfall(tx, account.id, current.orderSecurityId, null, id);
			}

			await tx.delete(trades).where(eq(trades.entryId, id));
			await tx.delete(entries).where(eq(entries.id, id));

			if (current.parentEntryId !== null) {
				const parent = await splitRow(tx, current.parentEntryId);
				await tx
					.update(transactions)
					.set({
						excluded: false,
						lockedFields: lockedBy(options.origin, parent.lockedFields, ["excluded"]),
					})
					.where(eq(transactions.entryId, parent.id));
			}

			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Converts the transaction `id` into a trade, as Sure's
 * `create_trade_from_transaction`: the trade takes its date and its amount
 * exactly, a buy or a sale's fee being what is left of the amount once
 * `quantity × price` is taken out. The transaction becomes the trade's
 * parent (AD-20): excluded, its exclusion locked, kept with its keys so a
 * re-import finds it and writes nothing, and left out of every balance and
 * report by every reader that drops a split parent. Throws `NOT_FOUND` for
 * an unknown transaction, `NOT_AN_INVESTMENT_ACCOUNT` elsewhere than on an
 * investment account, `NOT_CONVERTIBLE` for a transfer side, a pending,
 * excluded or possibly duplicated transaction, or a split's parent or
 * child, and `VALIDATION_ERROR` on `side` for an amount of the wrong sign,
 * on `price` for a fee below zero, and as a new trade does on its date,
 * security and quantity.
 */
export async function convertTransaction(
	deps: ServiceDeps,
	id: string,
	input: ConversionInput,
	options: { origin: Origin },
): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			const source = await splitRow(tx, id);
			const account = await investmentAccount(tx, source.accountId);

			if (
				source.inTransfer ||
				source.pending ||
				source.excluded ||
				source.possibleDuplicate ||
				source.parentEntryId !== null ||
				source.isParent
			) {
				throw new AppError("NOT_CONVERTIBLE", "This transaction cannot be converted.");
			}

			refuseDate(account, source.date, deps.timeZone);

			const amount = toMinorUnits(source.amount);
			const now = Date.now();
			if (!signFits(input.side, amount)) {
				throw invalidField("side", "sign_mismatch");
			}

			let tradeId: string;

			if (isIncome(input)) {
				await refuseIncomeSecurity(
					tx,
					account.id,
					input.side,
					input.security?.id ?? null,
					source.date,
				);
				tradeId = await insertTrade(
					deps,
					tx,
					account,
					{
						...incomeRow(input.side, input.security),
						date: source.date,
						amount,
						parentEntryId: source.id,
					},
					null,
					now,
				);
			} else {
				const fee = conversionFee(input.side, input, amount, account.currency);

				if (fee === null) {
					throw invalidField("price", "amount_mismatch");
				}

				const security = await resolveSecurity(tx, input.security, account.currency, now);
				const quantity = signedQuantity(input.side, input.quantity);
				await refuseShortfall(tx, account.id, security.id, { date: source.date, quantity });
				tradeId = await insertTrade(
					deps,
					tx,
					account,
					{
						securityId: security.id,
						incomeKind: null,
						quantity,
						price: input.price,
						fee,
						date: source.date,
						amount,
						parentEntryId: source.id,
					},
					security.row,
					now,
				);
			}

			// After the trade, so the recompute it ran already drops the parent;
			// its exclusion moves no balance.
			await tx
				.update(transactions)
				.set({
					excluded: true,
					lockedFields: lockedBy(options.origin, source.lockedFields, ["excluded"]),
				})
				.where(eq(transactions.entryId, source.id));

			return { id: tradeId };
		},
		{ behavior: "immediate" },
	);
}

export type TradeRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	side: TradeType;
	/** Unsigned: `side` gives the sign; zero for an income. */
	quantity: Micros;
	price: Micros;
	fee: MinorUnits;
	/** The cash amount (AD-5): negative for a buy, positive for an income. */
	amount: MinorUnits;
	currency: string;
	/** `null` for interest on the account's cash. */
	security: {
		id: string;
		name: string;
		ticker: string | null;
		mic: string | null;
		isin: string | null;
	} | null;
	/** The transaction converted into this trade, `null` for one recorded as a trade. */
	convertedFrom: { id: string; label: string } | null;
};

const recordColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	quantity: trades.quantity,
	incomeKind: trades.incomeKind,
	price: trades.price,
	fee: trades.fee,
	security: {
		id: securities.id,
		name: securities.name,
		ticker: securities.ticker,
		mic: securities.mic,
		isin: securities.isin,
	},
	convertedFrom: { id: transactions.entryId, label: transactions.label },
};

type RecordRow = Omit<TradeRecord, "side" | "amount"> & {
	amount: number;
	incomeKind: IncomeKind | null;
};

function toRecord({ quantity, incomeKind, amount, ...row }: RecordRow): TradeRecord {
	return {
		...row,
		side: typeOf({ quantity, incomeKind }),
		quantity: toMicros(Math.abs(quantity)),
		amount: toMinorUnits(amount),
	};
}

function recordQuery(db: Pick<ServiceDeps["db"], "select">) {
	return db
		.select(recordColumns)
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.leftJoin(securities, eq(securities.id, trades.securityId))
		.leftJoin(transactions, eq(transactions.entryId, entries.parentEntryId));
}

/** One trade with its security, `null` when the id names none. */
export async function findTrade(deps: ServiceDeps, id: string): Promise<TradeRecord | null> {
	const row = await recordQuery(deps.db).where(eq(trades.entryId, id)).get();

	return row === undefined ? null : toRecord(row);
}

/**
 * A page of an account's trades, most recent first (AD-15), only those in
 * `securityId` when it is given, as a position's sheet lists them.
 */
export async function listTrades(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number; securityId?: string | undefined },
): Promise<{ items: TradeRecord[]; total: number }> {
	const where = and(
		eq(entries.accountId, accountId),
		eq(entries.kind, "trade"),
		page.securityId === undefined ? undefined : eq(trades.securityId, page.securityId),
	);
	const rows = await recordQuery(deps.db)
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db
		.select({ total: count() })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(where);

	return {
		items: rows.map(toRecord),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}

/**
 * Every traded security and the date of its first trade, on any account,
 * oldest first: a sold one too, since the past is valued from its prices, as
 * Sure's `MarketDataImporter` asks for prices from an account's first trade.
 * A dividend or interest asks for none.
 */
export async function tradedSecurities(
	db: Pick<ServiceDeps["db"], "select">,
): Promise<{ securityId: string; from: IsoDate }[]> {
	const first = sql<IsoDate>`min(${entries.date})`;

	return db
		.select({ securityId: tradedSecurityId, from: first })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(movesQuantity)
		.groupBy(trades.securityId)
		.orderBy(asc(first), asc(trades.securityId));
}
