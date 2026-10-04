import type { IsoDate } from "../dates.ts";

import type { Micros } from "@archant/data/micros";
import { divideHalfEven, toMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";
import { marketValue } from "../trades.ts";

/** A trade as holdings read it: its signed quantity, positive for a buy, and its price. */
export type HoldingTrade = {
	date: IsoDate;
	securityId: string;
	quantity: Micros;
	price: Micros;
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
	/** Weighted average price of the buys, fees out; `null` while nothing is held. */
	costBasis: Micros | null;
};

type Position = {
	quantity: bigint;
	costBasis: bigint | null;
	/** The price carried into the next day, and the day it was set. */
	price: Micros;
	pricedOn: IsoDate;
};

/**
 * Sure's `CostBasisTracker`: a buy moves the weighted average, rounded half
 * to even to the millionth, its fee left out; a sale leaves it; nothing held
 * clears it, so the next buy starts over from its own price, as Sure's
 * `reset`.
 */
function apply(position: Position, trade: HoldingTrade): void {
	const quantity = BigInt(trade.quantity);

	if (quantity > 0n) {
		position.costBasis =
			position.costBasis === null
				? BigInt(trade.price)
				: divideHalfEven(
						position.quantity * position.costBasis + quantity * BigInt(trade.price),
						position.quantity + quantity,
					);
	}

	position.quantity += quantity;

	if (position.quantity <= 0n) {
		position.costBasis = null;
	}

	position.price = trade.price;
	position.pricedOn = trade.date;
}

/** Applies `trade` to its security's position, opening one on its first trade. */
function applyTo(positions: Map<string, Position>, trade: HoldingTrade): void {
	const position = positions.get(trade.securityId) ?? {
		quantity: 0n,
		costBasis: null,
		price: trade.price,
		pricedOn: trade.date,
	};

	apply(position, trade);
	positions.set(trade.securityId, position);
}

/**
 * One holding per security and day, from `from` to `until`, as Sure's
 * `Holding::ForwardCalculator`: a security from its first trade on, every
 * day after a full sale, to `until`, at quantity zero. A day's price is the stored
 * price of that day, a provider's or a typed one, else the day's last trade
 * price, else the day before's, carried. The day before `from` is replayed
 * from every earlier trade, its price the later of the last trade and the
 * last stored price, the stored one on the same day.
 */
export function forwardHoldings(input: HoldingsInput): DailyHolding[] {
	const positions = new Map<string, Position>();
	const tradesOn = new Map<IsoDate, HoldingTrade[]>();

	for (const trade of input.trades) {
		if (trade.date < input.from) {
			applyTo(positions, trade);
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
			applyTo(positions, trade);
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
