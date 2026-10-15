import type { IsoDate } from "../dates.ts";

import type { Micros } from "@archant/data/micros";
import { divideHalfEven, toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";
import { MICROS_SQUARED, marketValue, minorUnitsPerMajor } from "../trades.ts";

/**
 * A trade as holdings read it: its signed quantity, positive for a buy, its
 * price, and its fee in minor units of the account's currency.
 */
export type HoldingTrade = {
	date: IsoDate;
	securityId: string;
	quantity: Micros;
	price: Micros;
	fee: MinorUnits;
};

/** A `security_prices` row, provider or typed alike. */
export type StoredPrice = { securityId: string; date: IsoDate; price: Micros };

export type HoldingsInput = {
	/** First day to compute. */
	from: IsoDate;
	/** Last day to compute: the account's last balance day. */
	until: IsoDate;
	/**
	 * Every trade of the account, the ones before `from` included, in recording
	 * order: by date, then as they were recorded. Those before `from` give the
	 * state the first day starts from.
	 */
	trades: readonly HoldingTrade[];
	/** The stored prices of the account's securities from `from` to `until`. */
	prices: readonly StoredPrice[];
	/** Per security, the last stored price dated before `from`. */
	pricesBefore: ReadonlyMap<string, StoredPrice>;
	/** The account's: a trade is in its account's currency (AD-6). */
	currency: string;
};

export type DailyHolding = {
	securityId: string;
	date: IsoDate;
	quantity: Micros;
	price: Micros;
	/** `quantity × price`, rounded half to even to the minor unit (AD-22). */
	amount: MinorUnits;
	/**
	 * Weighted average price of the buys, each buy's fee in its cost, a
	 * sale's fee out, as Sure's `CostBasisTracker`: whatever the quantity's
	 * sign, `null` while the tracker holds nothing.
	 */
	costBasis: Micros | null;
};

type Position = {
	/** The position's quantity, below zero after a sale above what was held. */
	quantity: bigint;
	/**
	 * What Sure's `CostBasisTracker` holds, kept apart from the quantity: never
	 * below zero, a sale relieving at most this much.
	 */
	tracked: bigint;
	/** The tracker's average; `null` while it holds nothing. */
	costBasis: bigint | null;
	/** The price carried into the next day, and the day it was set. */
	price: Micros;
	pricedOn: IsoDate;
};

/**
 * Sure's `CostBasisTracker`: a buy adds `quantity × price + fee` to what it
 * holds, as Sure's `effective_trade_price`, and moves the average, rounded
 * half to even to the millionth; a sale relieves at the average, which it
 * leaves, at most what the tracker holds, and does nothing while it holds
 * nothing; the tracker emptied clears the average, so the next buy starts
 * over, as Sure's `reset`. The position's quantity follows every trade, below
 * zero included, as Sure's `ForwardCalculator`.
 */
function apply(position: Position, trade: HoldingTrade, feeScale: bigint): void {
	const quantity = BigInt(trade.quantity);

	if (quantity > 0n) {
		position.costBasis = divideHalfEven(
			position.tracked * (position.costBasis ?? 0n) +
				quantity * BigInt(trade.price) +
				BigInt(trade.fee) * feeScale,
			position.tracked + quantity,
		);
		position.tracked += quantity;
	} else if (quantity < 0n && position.tracked > 0n) {
		position.tracked -= -quantity < position.tracked ? -quantity : position.tracked;

		if (position.tracked === 0n) {
			position.costBasis = null;
		}
	}

	position.quantity += quantity;
	position.price = trade.price;
	position.pricedOn = trade.date;
}

/** Applies `trade` to its security's position, opening one on its first trade. */
function applyTo(positions: Map<string, Position>, trade: HoldingTrade, feeScale: bigint): void {
	const position = positions.get(trade.securityId) ?? {
		quantity: 0n,
		tracked: 0n,
		costBasis: null,
		price: trade.price,
		pricedOn: trade.date,
	};

	apply(position, trade, feeScale);
	positions.set(trade.securityId, position);
}

/**
 * One holding per security and day, from `from` to `until`, as Sure's
 * `Holding::ForwardCalculator`: a security from its first trade on, every
 * day after a full sale, to `until`, at quantity zero, and below zero after
 * a sale above what was held. A day's price is the stored price of that
 * day, a provider's or a typed one, else the day's last trade price, else
 * the day before's, carried. The day before `from` is replayed from every
 * earlier trade, its price the later of the last trade and the last stored
 * price, the stored one on the same day.
 */
export function forwardHoldings(input: HoldingsInput): DailyHolding[] {
	const positions = new Map<string, Position>();
	// A fee in minor units of the account's currency, as millionths squared,
	// the unit of `quantity × price`.
	const feeScale = MICROS_SQUARED / minorUnitsPerMajor(input.currency);
	const tradesOn = new Map<IsoDate, HoldingTrade[]>();

	for (const trade of input.trades) {
		if (trade.date < input.from) {
			applyTo(positions, trade, feeScale);
		} else {
			tradesOn.set(trade.date, [...(tradesOn.get(trade.date) ?? []), trade]);
		}
	}

	for (const [securityId, position] of positions) {
		const stored = input.pricesBefore.get(securityId);

		if (stored !== undefined && stored.date >= position.pricedOn) {
			position.price = stored.price;
		}
	}

	const stored = new Map(input.prices.map((row) => [`${row.securityId} ${row.date}`, row.price]));
	const rows: DailyHolding[] = [];

	for (let date = input.from; date <= input.until; date = addDays(date, 1)) {
		for (const trade of tradesOn.get(date) ?? []) {
			applyTo(positions, trade, feeScale);
		}

		for (const [securityId, position] of positions) {
			const quantity = toMicros(Number(position.quantity));
			position.price = stored.get(`${securityId} ${date}`) ?? position.price;
			rows.push({
				securityId,
				date,
				quantity,
				price: position.price,
				amount: toMinorUnits(Number(marketValue(quantity, position.price, input.currency))),
				costBasis: position.costBasis === null ? null : toMicros(Number(position.costBasis)),
			});
		}
	}

	return rows;
}
