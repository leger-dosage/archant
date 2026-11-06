import type { Quantity, TradePrice } from "@archant/data/decimals";
import {
	QUANTITY_UNIT,
	TRADE_PRICE_UNIT,
	scaledQuantity,
	scaledTradePrice,
} from "@archant/data/decimals";
import type { Micros } from "@archant/data/micros";
import { divideHalfEven } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { minorUnitsPerMajor, unsignedQuantity } from "../trades.ts";

export type PurchaseAverage = { quantity: bigint; value: bigint };

/** Sure averages all positive purchases, including closed positions and the entire snapshot day. */
export function purchaseAverage(
	purchases: readonly { quantity: Quantity; price: TradePrice }[],
): PurchaseAverage {
	return purchases.reduce<PurchaseAverage>(
		(sum, purchase) => {
			const quantity = scaledQuantity(purchase.quantity);
			return quantity <= 0n
				? sum
				: {
						quantity: sum.quantity + quantity,
						value: sum.value + quantity * scaledTradePrice(purchase.price),
					};
		},
		{ quantity: 0n, value: 0n },
	);
}

/** Policy A: snapshot basis first, otherwise the exact historical purchase average without fees. */
export function historicalSaleGain(
	sale: {
		quantity: Quantity;
		price: TradePrice;
		costBasis: Micros | null;
		costBasisLocked: boolean;
		purchases: readonly { quantity: Quantity; price: TradePrice }[] | PurchaseAverage;
	},
	currency: string,
): MinorUnits | null {
	const quantity = scaledQuantity(unsignedQuantity(sale.quantity));
	const proceeds = scaledTradePrice(sale.price);
	let difference: bigint;
	let denominator = QUANTITY_UNIT * TRADE_PRICE_UNIT;
	if (sale.costBasis !== null && (sale.costBasis > 0 || sale.costBasisLocked)) {
		const cost = BigInt(sale.costBasis) * (TRADE_PRICE_UNIT / 1_000_000n);
		difference = quantity * (proceeds - cost);
	} else {
		const average = "value" in sale.purchases ? sale.purchases : purchaseAverage(sale.purchases);
		if (average.quantity === 0n) {
			return null;
		}
		difference = quantity * (proceeds * average.quantity - average.value);
		denominator *= average.quantity;
	}
	return toMinorUnits(
		Number(divideHalfEven(difference * minorUnitsPerMajor(currency), denominator)),
	);
}
