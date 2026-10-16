import type { HoldingTrade, HoldingsInput, StoredPrice } from "./forward.ts";

import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";

import {
	quantity as q,
	quantityFromMicros,
	tradePrice as p,
	tradePriceFromMicros,
} from "../../testing/decimals.ts";
import { forwardHoldings } from "./forward.ts";

const micros = toMicros;

const LVMH = "lvmh";
const AIR = "air-liquide";

const trade = (
	date: string,
	quantity: number,
	price: number,
	securityId = LVMH,
	fee = 0,
): HoldingTrade => ({
	date,
	securityId,
	// Millionths, as these cases were written before AD-22 took Sure's decimals.
	quantity: quantityFromMicros(quantity),
	price: tradePriceFromMicros(price),
	fee: toMinorUnits(fee),
});

const price = (date: string, value: number, securityId = LVMH): StoredPrice => ({
	securityId,
	date,
	price: micros(value),
});

/** A trade at Sure's decimals, typed as plain decimal text. */
const exact = (date: string, quantity: string, value: string, fee = 0): HoldingTrade => ({
	date,
	securityId: LVMH,
	quantity: q(quantity),
	price: p(value),
	fee: toMinorUnits(fee),
});

// A buy of 10 LVMH at 612.40 € on 2026-09-10, the d of the I/O matrix.
const bought: HoldingsInput = {
	from: "2026-09-10",
	until: "2026-09-12",
	trades: [trade("2026-09-10", 10_000_000, 612_400_000)],
	prices: [],
	pricesBefore: new Map(),
	currency: "EUR",
};

/** Each row as `date quantity price amount costBasis`, for a compact expectation. */
const rows = (input: HoldingsInput) =>
	forwardHoldings(input).map(
		(row) =>
			`${row.date} ${row.securityId} ${row.quantity} ${row.price} ${row.amount} ${row.costBasis}`,
	);

describe("forwardHoldings", () => {
	it("values a buy at its own price when nothing is stored", () => {
		expect(forwardHoldings({ ...bought, until: "2026-09-10" })).toEqual([
			{
				securityId: LVMH,
				date: "2026-09-10",
				quantity: "10",
				price: 612_400_000,
				amount: 612_400,
				costBasis: 612_400_000,
			},
		]);
	});

	it("adds a buy's fee to its cost, as Sure's effective trade price", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-10",
				trades: [trade("2026-09-10", 10_000_000, 612_400_000, LVMH, 250)],
			}),
		).toEqual(["2026-09-10 lvmh 10 612400000 612400 612650000"]);
	});

	it("averages the buys with their fees, and leaves a sale's fee out", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-12",
				trades: [
					trade("2026-09-10", 10_000_000, 100_000_000, LVMH, 100),
					trade("2026-09-11", 10_000_000, 110_000_000, LVMH, 300),
					trade("2026-09-12", -5_000_000, 120_000_000, LVMH, 400),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 100000000 100000 100100000",
			"2026-09-11 lvmh 20 110000000 220000 105200000",
			"2026-09-12 lvmh 15 120000000 180000 105200000",
		]);
	});

	it("scales a fee from the account currency's minor unit, a yen fee without one", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-10",
				currency: "JPY",
				trades: [trade("2026-09-10", 3_000_000, 1_000_000_000, LVMH, 10)],
			}),
		).toEqual(["2026-09-10 lvmh 3 1000000000 3000 1003333333"]);
	});

	it("takes a provider's price, then carries it over a day without one", () => {
		expect(rows({ ...bought, prices: [price("2026-09-11", 650_000_000)] })).toEqual([
			"2026-09-10 lvmh 10 612400000 612400 612400000",
			"2026-09-11 lvmh 10 650000000 650000 612400000",
			"2026-09-12 lvmh 10 650000000 650000 612400000",
		]);
	});

	it("prefers the day's stored price to the day's trade", () => {
		expect(
			rows({ ...bought, until: "2026-09-10", prices: [price("2026-09-10", 640_000_000)] }),
		).toEqual(["2026-09-10 lvmh 10 640000000 640000 612400000"]);
	});

	it("weighs the average cost by quantity", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-11",
				trades: [
					trade("2026-09-10", 10_000_000, 100_000_000),
					trade("2026-09-11", 30_000_000, 200_000_000),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 100000000 100000 100000000",
			"2026-09-11 lvmh 40 200000000 800000 175000000",
		]);
	});

	it("leaves the cost basis where a sale finds it, valued at the sale's price", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-11",
				trades: [
					trade("2026-09-10", 10_000_000, 612_400_000),
					trade("2026-09-11", -4_000_000, 650_000_000),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 612400000 612400 612400000",
			"2026-09-11 lvmh 6 650000000 390000 612400000",
		]);
	});

	it("keeps writing a sold-out security at zero without a cost basis, and starts over on a rebuy", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-13",
				trades: [
					trade("2026-09-10", 10_000_000, 612_400_000),
					trade("2026-09-11", -10_000_000, 650_000_000),
					trade("2026-09-13", 5_000_000, 700_000_000),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 612400000 612400 612400000",
			"2026-09-11 lvmh 0 650000000 0 null",
			"2026-09-12 lvmh 0 650000000 0 null",
			"2026-09-13 lvmh 5 700000000 350000 700000000",
		]);
	});

	it("follows a day's trades in recording order, a sale before the buy that covers it included", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-11",
				trades: [
					trade("2026-09-10", 10_000_000, 612_400_000),
					trade("2026-09-11", -10_000_000, 650_000_000),
					trade("2026-09-11", 5_000_000, 700_000_000),
					// The quantity is the day's end, but the cost basis follows recording
					// order: a sale that empties the position resets it, as Sure's
					// `CostBasisTracker` does, and the next buy starts over at its price.
					trade("2026-09-11", -6_000_000, 710_000_000),
					trade("2026-09-11", 8_000_000, 720_000_000),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 612400000 612400 612400000",
			"2026-09-11 lvmh 7 720000000 504000 720000000",
		]);
	});

	describe("below zero, as Sure's tracker", () => {
		it("takes the quantity below zero on a sale above what is held, the cost basis cleared", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-11",
					trades: [
						trade("2026-09-10", 10_000_000, 612_400_000),
						trade("2026-09-11", -15_000_000, 650_000_000),
					],
				}),
			).toEqual([
				"2026-09-10 lvmh 10 612400000 612400 612400000",
				"2026-09-11 lvmh -5 650000000 -325000 null",
			]);
		});

		it("starts over from the rebuy's own price after a short position", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-12",
					trades: [
						trade("2026-09-10", 10_000_000, 612_400_000),
						trade("2026-09-11", -15_000_000, 650_000_000),
						trade("2026-09-12", 8_000_000, 700_000_000),
					],
				}).at(-1),
			).toBe("2026-09-12 lvmh 3 700000000 210000 700000000");
		});

		it("keeps the cost basis of what the tracker holds while the position stays below zero", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-13",
					trades: [
						trade("2026-09-10", 10_000_000, 612_400_000),
						trade("2026-09-11", -15_000_000, 650_000_000),
						trade("2026-09-12", 3_000_000, 700_000_000),
						trade("2026-09-13", 1_000_000, 800_000_000),
					],
				}).slice(2),
			).toEqual([
				"2026-09-12 lvmh -2 700000000 -140000 700000000",
				"2026-09-13 lvmh -1 800000000 -80000 725000000",
			]);
		});

		it("averages a day's buys after a sale recorded before them over what the tracker holds", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: [
						trade("2026-09-10", -5_000_000, 600_000_000),
						trade("2026-09-10", 3_000_000, 700_000_000),
						trade("2026-09-10", 4_000_000, 800_000_000),
					],
				}),
			).toEqual(["2026-09-10 lvmh 2 800000000 160000 757142857"]);
		});

		it("relieves a sale at the average, which it leaves, and does nothing while the tracker holds nothing", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-12",
					trades: [
						trade("2026-09-10", -5_000_000, 600_000_000),
						trade("2026-09-11", 8_000_000, 700_000_000),
						trade("2026-09-12", -2_000_000, 750_000_000),
					],
				}),
			).toEqual([
				"2026-09-10 lvmh -5 600000000 -300000 null",
				"2026-09-11 lvmh 3 700000000 210000 700000000",
				"2026-09-12 lvmh 1 750000000 75000 700000000",
			]);
		});
	});

	it("rounds the cost basis to the millionth and the amount to the cent, half to even", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-11",
				trades: [
					trade("2026-09-10", 1_000_000, 1_000_000),
					// (1.000000 + 1.000001) / 2 is a tie, and goes to the even millionth.
					trade("2026-09-10", 1_000_000, 1_000_001),
					// 3 at 0.005 € is 1.5 cents, a tie that goes up to the even cent.
					trade("2026-09-11", 1_000_000, 5_000, AIR),
					trade("2026-09-11", 2_000_000, 5_000, AIR),
				],
			}),
		).toEqual([
			"2026-09-10 lvmh 2 1000001 200 1000000",
			"2026-09-11 lvmh 2 1000001 200 1000000",
			"2026-09-11 air-liquide 3 5000 2 5000",
		]);
	});

	it("values in the account's currency, a yen amount without a minor unit", () => {
		expect(
			rows({
				...bought,
				until: "2026-09-10",
				currency: "JPY",
				trades: [trade("2026-09-10", 2_000_000, 1_500_500_000)],
			}),
		).toEqual(["2026-09-10 lvmh 2 1500500000 3001 1500500000"]);
	});

	it("starts each security on its own first trade, the others carried beside it", () => {
		expect(
			rows({
				...bought,
				trades: [
					trade("2026-09-10", 10_000_000, 612_400_000),
					trade("2026-09-11", 2_000_000, 180_000_000, AIR),
				],
				prices: [price("2026-09-12", 182_000_000, AIR)],
			}),
		).toEqual([
			"2026-09-10 lvmh 10 612400000 612400 612400000",
			"2026-09-11 lvmh 10 612400000 612400 612400000",
			"2026-09-11 air-liquide 2 180000000 36000 180000000",
			"2026-09-12 lvmh 10 612400000 612400 612400000",
			"2026-09-12 air-liquide 2 182000000 36400 180000000",
		]);
	});

	describe("from a later day", () => {
		const earlier: HoldingTrade[] = [
			trade("2026-09-02", 10_000_000, 100_000_000),
			trade("2026-09-05", 30_000_000, 200_000_000),
		];

		it("replays the trades before it for the quantity and the cost basis, at the last trade's price", () => {
			expect(rows({ ...bought, until: "2026-09-10", trades: earlier })).toEqual([
				"2026-09-10 lvmh 40 200000000 800000 175000000",
			]);
		});

		it("carries the last stored price when it is later than the last trade", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: earlier,
					pricesBefore: new Map([[LVMH, price("2026-09-08", 210_000_000)]]),
				}),
			).toEqual(["2026-09-10 lvmh 40 210000000 840000 175000000"]);
		});

		it("carries the stored price of the last trade's own day over that trade", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: earlier,
					pricesBefore: new Map([[LVMH, price("2026-09-05", 205_000_000)]]),
				}),
			).toEqual(["2026-09-10 lvmh 40 205000000 820000 175000000"]);
		});

		it("carries the last trade's price when it is later than the last stored one", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: earlier,
					pricesBefore: new Map([[LVMH, price("2026-09-04", 150_000_000)]]),
				}),
			).toEqual(["2026-09-10 lvmh 40 200000000 800000 175000000"]);
		});

		it("adds the day's trades to the replayed state", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: [...earlier, trade("2026-09-10", -40_000_000, 220_000_000)],
				}),
			).toEqual(["2026-09-10 lvmh 0 220000000 0 null"]);
		});
	});

	it("gives nothing when the start is past the end, or before any trade", () => {
		expect(forwardHoldings({ ...bought, from: "2026-09-13" })).toEqual([]);
		expect(forwardHoldings({ ...bought, trades: [] })).toEqual([]);
	});

	describe("at Sure's decimals", () => {
		it("values a buy of 0.000166666666666667 at 60 000 € at 10,00 €, the quantity as typed", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-10",
					trades: [exact("2026-09-10", "0.000166666666666667", "60000")],
				}),
			).toEqual(["2026-09-10 lvmh 0.000166666666666667 60000000000 1000 60000000000"]);
		});

		it("keeps eighteen decimals of a large quantity across buys and a sale", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-11",
					trades: [
						exact("2026-09-10", "12345.123456789012345678", "1"),
						exact("2026-09-11", "0.000000000000000001", "1"),
						exact("2026-09-11", "-0.5", "1"),
					],
				}),
			).toEqual([
				"2026-09-10 lvmh 12345.123456789012345678 1000000 1234512 1000000",
				"2026-09-11 lvmh 12344.623456789012345679 1000000 1234462 1000000",
			]);
		});

		it("rounds a day's last trade price half to even to the millionth its holdings keep", () => {
			expect(
				rows({
					...bought,
					until: "2026-09-11",
					trades: [
						exact("2026-09-10", "1000", "0.0000015"),
						exact("2026-09-11", "1000", "0.0000025"),
					],
				}),
			).toEqual([
				// The cost basis, a millionth and a half, ties to the even two.
				"2026-09-10 lvmh 1000 2 0 2",
				"2026-09-11 lvmh 2000 2 0 2",
			]);
		});
	});
});
