import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";

import { positionFigures, weightOf } from "./positions.ts";

const total = toMinorUnits(1_000_000);

describe("positionFigures", () => {
	it("gives A of the two lines its weight, its book value and its gain", () => {
		// 100 shares bought at 50 € and worth 6 000 € in an account of 10 000 €.
		expect(
			positionFigures(
				{
					quantity: toMicros(100_000_000),
					amount: toMinorUnits(600_000),
					costBasis: toMicros(50_000_000),
				},
				total,
				"EUR",
			),
		).toEqual({ bookValue: 500_000, gain: 100_000, gainPercent: 20_000_000, weight: 60_000_000 });
	});

	it("gives a line worth nothing a zero weight and a loss of its whole cost", () => {
		expect(
			positionFigures(
				{ quantity: toMicros(3_000_000), amount: toMinorUnits(0), costBasis: toMicros(10_000_000) },
				total,
				"EUR",
			),
		).toEqual({ bookValue: 3000, gain: -3000, gainPercent: -100_000_000, weight: 0 });
	});

	it("counts a free share's whole value as gain, with no percentage", () => {
		expect(
			positionFigures(
				{ quantity: toMicros(2_000_000), amount: toMinorUnits(12_000), costBasis: toMicros(0) },
				total,
				"EUR",
			),
		).toEqual({ bookValue: 0, gain: 12_000, gainPercent: null, weight: 1_200_000 });
	});

	it("gives no book value, gain or percentage without a cost basis", () => {
		expect(
			positionFigures(
				{ quantity: toMicros(2_000_000), amount: toMinorUnits(12_000), costBasis: null },
				total,
				"EUR",
			),
		).toEqual({ bookValue: null, gain: null, gainPercent: null, weight: 1_200_000 });
	});

	it("rounds the percentages half to even to the millionth of a percent", () => {
		// 1 of 3: 33.3333333… %; a gain of 1 on 3.
		expect(
			positionFigures(
				{ quantity: toMicros(1_000_000), amount: toMinorUnits(4), costBasis: toMicros(30_000) },
				toMinorUnits(12),
				"EUR",
			),
		).toEqual({ bookValue: 3, gain: 1, gainPercent: 33_333_333, weight: 33_333_333 });
	});

	it("leaves every weight out when the account's total is not above zero", () => {
		// Cash of −7 000 € beside 6 000 € of holdings.
		const negative = positionFigures(
			{
				quantity: toMicros(100_000_000),
				amount: toMinorUnits(600_000),
				costBasis: toMicros(50_000_000),
			},
			toMinorUnits(-100_000),
			"EUR",
		);

		expect(negative.weight).toBeNull();
		expect(negative.gain).toBe(100_000);
		expect(weightOf(toMinorUnits(0), toMinorUnits(0))).toBeNull();
	});

	it("gives no book value, gain or percentage past what a balance can hold", () => {
		// A cost basis of ten million euros locked on a million units.
		expect(
			positionFigures(
				{
					quantity: toMicros(1_000_000_000_000),
					amount: toMinorUnits(600_000),
					costBasis: toMicros(10_000_000_000_000),
				},
				total,
				"EUR",
			),
		).toEqual({ bookValue: null, gain: null, gainPercent: null, weight: 60_000_000 });
	});

	it("gives no percentage past what a number holds exactly", () => {
		// A gain of a million euros on a book value of one cent.
		expect(
			positionFigures(
				{
					quantity: toMicros(1_000_000),
					amount: toMinorUnits(100_000_000),
					costBasis: toMicros(10_000),
				},
				toMinorUnits(1),
				"EUR",
			),
		).toEqual({ bookValue: 1, gain: 99_999_999, gainPercent: null, weight: null });
		expect(weightOf(toMinorUnits(-100_000_000), toMinorUnits(1))).toBeNull();
	});
});

describe("weightOf", () => {
	it("weighs the cash as a line, a negative cash below zero", () => {
		expect(weightOf(toMinorUnits(400_000), total)).toBe(40_000_000);
		expect(weightOf(toMinorUnits(-50_000), total)).toBe(-5_000_000);
	});
});
