import type { Quantity, TradePrice } from "@archant/data/decimals";
import {
	formatQuantity,
	formatTradePrice,
	parseQuantity,
	parseTradePrice,
} from "@archant/data/decimals";

/** A quantity from its plain decimal text, such as `"0.5"`; throws on anything else. */
export function quantity(text: string): Quantity {
	const value = parseQuantity(text);

	if (value === null) {
		throw new Error(`${text} is no quantity.`);
	}

	return value;
}

/** A trade price from its plain decimal text, such as `"612.4"`; throws on anything else. */
export function tradePrice(text: string): TradePrice {
	const value = parseTradePrice(text);

	if (value === null) {
		throw new Error(`${text} is no trade price.`);
	}

	return value;
}

/** A quantity from millionths of a unit, as a fixture written before AD-22 took 18 decimals. */
export function quantityFromMicros(micros: number): Quantity {
	return formatQuantity(BigInt(micros) * 10n ** 12n);
}

/** A trade price from millionths, as a fixture written before AD-22 took 10 decimals. */
export function tradePriceFromMicros(micros: number): TradePrice {
	return formatTradePrice(BigInt(micros) * 10_000n);
}
