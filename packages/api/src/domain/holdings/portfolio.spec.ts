import type { PortfolioRow } from "./portfolio.ts";

import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";

import { quantity as q, tradePrice } from "../../testing/decimals.ts";
import { historicalSaleGain } from "./historical-basis.ts";
import { returnOf, rollUp, topHoldings } from "./portfolio.ts";

const security = (id: string, name = id) => ({ id, name, ticker: null });

/** `quantity` units worth `amount` cents, bought at `cost` euros a unit, or without a cost basis. */
function row(id: string, quantity: string, amount: number, cost: number | null): PortfolioRow {
	return {
		security: security(id),
		quantity: q(quantity),
		amount: toMinorUnits(amount),
		costBasis: cost === null ? null : toMicros(cost * 1_000_000),
	};
}

describe("rollUp", () => {
	it("sums one security held in two accounts into one row, 3 000 € and 2 000 € making 5 000 €", () => {
		const rolled = rollUp([row("cw8", "30", 300_000, 90), row("cw8", "20", 200_000, 80)]);

		expect(rolled).toHaveLength(1);
		expect(rolled[0]).toMatchObject({ security: security("cw8"), amount: 500_000 });
		expect(rolled[0]?.rows).toHaveLength(2);
	});

	it("drops a row at or below zero before the sum, where it would net the good row down", () => {
		const rolled = rollUp([
			row("cw8", "30", 300_000, 90),
			row("cw8", "-5", -50_000, 100),
			row("cw8", "1", 0, 100),
			row("short", "-2", -20_000, 100),
		]);

		expect(rolled.map(({ security: { id }, amount, rows }) => [id, amount, rows.length])).toEqual([
			["cw8", 300_000, 1],
		]);
	});

	it("ranks two securities of the same value and name by id", () => {
		const rolled = rollUp([
			{ ...row("b", "1", 100, null), security: security("b", "Fonds") },
			{ ...row("a", "1", 100, null), security: security("a", "Fonds") },
		]);

		expect(rolled.map((each) => each.security.id)).toEqual(["a", "b"]);
	});

	it("ranks by value, largest first, then by name", () => {
		const rolled = rollUp([
			row("b", "1", 100, null),
			row("c", "1", 300, null),
			row("a", "1", 100, null),
		]);

		expect(rolled.map((each) => each.security.id)).toEqual(["c", "a", "b"]);
	});
});

describe("topHoldings", () => {
	it("keeps the five largest of six securities, largest first", () => {
		const rows = [1, 2, 3, 4, 5, 6].map((value) => row(`s${value}`, "1", value * 100, null));

		const top = topHoldings(rows, toMinorUnits(2_100), 5, "EUR");

		expect(top.map((each) => each.security.id)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
		// 600 of 2 100.
		expect(top[0]?.weight).toBe(28_571_429);
	});

	it("weighs over the holdings' total when cash below zero leaves the portfolio under it", () => {
		const top = topHoldings([row("cw8", "10", 100_000, null)], toMinorUnits(90_000), 5, "EUR");

		expect(top[0]?.weight).toBe(100_000_000);
	});

	it("weighs over the portfolio's value, cash included, when it is the larger", () => {
		const top = topHoldings([row("cw8", "10", 100_000, null)], toMinorUnits(400_000), 5, "EUR");

		expect(top[0]?.weight).toBe(25_000_000);
	});

	it("is empty without a row above zero", () => {
		expect(topHoldings([row("cw8", "-1", -100, 1)], toMinorUnits(0), 5, "EUR")).toEqual([]);
	});

	it("combines the return of a security's rows, one without a cost basis left out", () => {
		const top = topHoldings(
			[
				row("cw8", "30", 330_000, 100),
				row("cw8", "20", 180_000, 100),
				row("cw8", "5", 50_000, null),
			],
			toMinorUnits(560_000),
			5,
			"EUR",
		);

		// 5 100 € against 5 000 €: +100 €, +2 %.
		expect(top[0]?.return).toEqual({ gain: 10_000, percent: 2_000_000, trend: "up" });
	});

	it("gives no return to a security none of whose rows has a cost basis", () => {
		const top = topHoldings([row("cw8", "30", 300_000, null)], toMinorUnits(300_000), 5, "EUR");

		expect(top[0]?.return).toBeNull();
	});
});

describe("returnOf", () => {
	it("measures a loss against the book value: 900 € for 1 000 €", () => {
		expect(returnOf([row("cw8", "10", 90_000, 100)], "EUR")).toEqual({
			gain: -10_000,
			percent: -10_000_000,
			trend: "down",
		});
	});

	it("counts every row with a cost basis, a short one too, and leaves the others out", () => {
		expect(
			returnOf(
				[row("a", "10", 120_000, 100), row("b", "-1", -9_000, 100), row("c", "1", 5_000, null)],
				"EUR",
			),
		).toEqual({ gain: 21_000, percent: 23_333_333, trend: "up" });
	});

	it("measures a short position's gain against its book value's size", () => {
		// Sold short at 10 € a unit, bought back today for 9 €.
		expect(returnOf([row("short", "-10", -9_000, 10)], "EUR")).toEqual({
			gain: 1_000,
			percent: 10_000_000,
			trend: "up",
		});
	});

	it("is `null` when no row has a cost basis", () => {
		expect(returnOf([row("a", "10", 120_000, null)], "EUR")).toBeNull();
		expect(returnOf([], "EUR")).toBeNull();
	});

	it("is infinite on a zero book value, as Sure's `Trend#percent`", () => {
		expect(returnOf([row("airdrop", "10", 5_000, 0)], "EUR")).toEqual({
			gain: 5_000,
			percent: "+infinity",
			trend: "up",
		});
		expect(returnOf([row("airdrop", "-10", -5_000, 0)], "EUR")).toEqual({
			gain: -5_000,
			percent: "-infinity",
			trend: "down",
		});
	});

	it("is flat when the value equals the book value, a zero one included", () => {
		expect(returnOf([row("cw8", "10", 100_000, 100)], "EUR")).toEqual({
			gain: 0,
			percent: 0,
			trend: "flat",
		});
		expect(returnOf([row("free", "10", 0, 0)], "EUR")).toEqual({
			gain: 0,
			percent: 0,
			trend: "flat",
		});
	});
});

describe("historical purchase fallback", () => {
	it.each([
		["EUR", "0.004", "0.006", 6000, 0],
		["JPY", "0.4", "0.6", 600000, 0],
		["KWD", "0.0004", "0.0006", 600, 0],
		["EUR", "0.004", "0.009", 9000, 0],
		["JPY", "0.4", "0.9", 900000, 0],
		["KWD", "0.0004", "0.0009", 900, 0],
		["EUR", "0.004", "0.019", 19000, -2],
		["JPY", "0.4", "1.9", 1900000, -2],
		["KWD", "0.0004", "0.0019", 1900, -2],
	] as const)(
		"rounds the exact gain once in %s at sale %s and basis %s",
		(currency, price, purchasePrice, basis, expected) => {
			const sale = {
				quantity: q("-1"),
				price: tradePrice(price),
				costBasis: null,
				costBasisLocked: false,
				purchases: [{ quantity: q("1"), price: tradePrice(purchasePrice) }],
			};
			expect(historicalSaleGain(sale, currency)).toBe(expected);
			expect(historicalSaleGain({ ...sale, costBasis: toMicros(basis) }, currency)).toBe(expected);
		},
	);

	it("does not round a fractional millionth before multiplying by the sold quantity", () => {
		expect(
			historicalSaleGain(
				{
					quantity: q("-90000"),
					price: tradePrice("1"),
					costBasis: null,
					costBasisLocked: false,
					purchases: [
						{ quantity: q("1"), price: tradePrice("0.000001") },
						{ quantity: q("2"), price: tradePrice("0") },
					],
				},
				"EUR",
			),
		).toBe(8_999_997);
	});

	it("keeps the exact average until the final minor-unit rounding", () => {
		expect(
			historicalSaleGain(
				{
					quantity: q("-1"),
					price: tradePrice("1"),
					costBasis: null,
					costBasisLocked: false,
					purchases: [{ quantity: q("3"), price: tradePrice("0.00015") }],
				},
				"EUR",
			),
		).toBe(100);
	});
	it("distinguishes unknown, locked zero and free-purchase zero", () => {
		const sale = {
			quantity: q("-2"),
			price: tradePrice("20"),
			costBasis: null,
			costBasisLocked: false,
			purchases: [],
		};
		expect(historicalSaleGain(sale, "EUR")).toBeNull();
		expect(
			historicalSaleGain({ ...sale, costBasis: toMicros(0), costBasisLocked: true }, "EUR"),
		).toBe(4000);
		expect(
			historicalSaleGain(
				{ ...sale, purchases: [{ quantity: q("2"), price: tradePrice("0") }] },
				"EUR",
			),
		).toBe(4000);
	});
	it("includes all positive purchases, ignoring sales and fees in the fallback", () => {
		const purchases = [
			{ quantity: q("10"), price: tradePrice("10") },
			{ quantity: q("-10"), price: tradePrice("20") },
			{ quantity: q("10"), price: tradePrice("30") },
		];
		expect(
			historicalSaleGain(
				{
					quantity: q("-10"),
					price: tradePrice("30"),
					costBasis: null,
					costBasisLocked: false,
					purchases,
				},
				"EUR",
			),
		).toBe(10000);
	});
	it("uses a positive snapshot basis including purchase fees and gross sale proceeds", () => {
		expect(
			historicalSaleGain(
				{
					quantity: q("-2"),
					price: tradePrice("20"),
					costBasis: toMicros(11_000_000),
					costBasisLocked: false,
					purchases: [],
				},
				"EUR",
			),
		).toBe(1800);
	});
});
