import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { formatCompactMoney } from "./balance-change";
import { axisTicks, balanceDomain, goalDomain, loanDomain } from "./chart-axis";

/** Plain integers as the minor units the domains take. */
const minor = (values: readonly number[]) => values.map(toMinorUnits);

const rounded = ([low, high]: readonly [number, number]) => [Math.round(low), Math.round(high)];

/** The share of the chart's height the series' own move takes. */
const share = (values: number[]) => {
	const [low, high] = balanceDomain(minor(values), "EUR");

	return (Math.max(...values) - Math.min(...values)) / (high - low);
};

const labels = (values: number[], currency = "EUR") =>
	axisTicks(balanceDomain(minor(values), currency), currency, minor(values)).map((tick) =>
		// Narrow no-break spaces, read as plain ones.
		formatCompactMoney(toMinorUnits(tick), currency).replaceAll(/\s/gu, " "),
	);

describe("balanceDomain", () => {
	it("lets the 1.5 % floor win on a small move over a small balance", () => {
		expect(rounded(balanceDomain(minor([500_000, 505_000]), "EUR"))).toEqual([497_827, 507_173]);
		expect(share([500_000, 505_000])).toBeCloseTo(0.535, 2);
	});

	it("keeps a small move over a large balance near flat", () => {
		expect(rounded(balanceDomain(minor([10_000_000, 10_005_000]), "EUR"))).toEqual([
			9_909_477, 10_095_523,
		]);
		expect(share([10_000_000, 10_005_000])).toBeCloseTo(0.027, 2);
	});

	it("centres a flat series half its value either side", () => {
		expect(balanceDomain(minor([493_390, 493_390]), "EUR")).toEqual([246_695, 740_085]);
	});

	it("gives a flat series at zero 100 units either side", () => {
		expect(balanceDomain(minor([0, 0]), "EUR")).toEqual([-10_000, 10_000]);
		expect(balanceDomain(minor([0, 0]), "JPY")).toEqual([-100, 100]);
	});

	it("reaches below zero for a series near zero, as Sure's", () => {
		expect(rounded(balanceDomain(minor([0, 500_000]), "EUR"))).toEqual([-60_000, 560_000]);
	});

	it("fills about 80 % of the height with a large move", () => {
		expect(rounded(balanceDomain(minor([400_000, 500_000]), "EUR"))).toEqual([388_000, 512_000]);
		expect(share([400_000, 500_000])).toBeCloseTo(0.806, 2);
	});

	it("keeps a negative series far from zero to its own span", () => {
		expect(rounded(balanceDomain(minor([-500_000, -400_000]), "EUR"))).toEqual([
			-512_000, -388_000,
		]);
	});

	it("reaches zero from below for a negative series near it", () => {
		expect(rounded(balanceDomain(minor([-500_000, 0]), "EUR"))).toEqual([-560_000, 60_000]);
	});
});

describe("loanDomain", () => {
	it("runs from zero to 5 % above the highest balance", () => {
		expect(loanDomain(minor([0, 13_000_000, 10_472_454]), "EUR")).toEqual([0, 13_650_000]);
	});

	it("spans one unit when nothing is owed", () => {
		expect(loanDomain(minor([0, 0]), "EUR")).toEqual([0, 105]);
	});
});

describe("goalDomain", () => {
	it("leaves 5 % above the target", () => {
		expect(
			goalDomain(
				{ target: toMinorUnits(100_000), projections: minor([]), saved: minor([20_000, 40_000]) },
				"EUR",
			),
		).toEqual([0, 105_000]);
	});

	it("makes room for a saved line above the target, up to twice the goal's scale", () => {
		expect(
			goalDomain(
				{ target: toMinorUnits(100_000), projections: minor([]), saved: minor([150_000, 40_000]) },
				"EUR",
			),
		).toEqual([0, 157_500]);
		expect(
			goalDomain(
				{ target: toMinorUnits(70_000), projections: minor([]), saved: minor([1_000_000, 50_000]) },
				"EUR",
			),
		).toEqual([0, 147_000]);
	});

	it("follows a projection past the target and today's amount", () => {
		expect(
			goalDomain(
				{
					target: toMinorUnits(100_000),
					projections: minor([90_000, 200_000]),
					saved: minor([90_000]),
				},
				"EUR",
			),
		).toEqual([0, 200_000]);
		expect(
			goalDomain({ target: toMinorUnits(0), projections: minor([]), saved: minor([0]) }, "EUR"),
		).toEqual([0, 100]);
	});
});

describe("axisTicks", () => {
	it("lays round ticks inside the domain", () => {
		// DESIGN.md's mock: 274 269,28 € to 277 681,48 €.
		const mock = [27_426_928, 27_768_148];

		expect(axisTicks(balanceDomain(minor(mock), "EUR"), "EUR", minor(mock))).toEqual([
			27_400_000, 27_500_000, 27_600_000, 27_700_000, 27_800_000,
		]);
	});

	it("never repeats a label on a small move at 5 000 € or 100 000 €", () => {
		for (const values of [
			[500_000, 505_000],
			[10_000_000, 10_005_000],
			[493_390, 493_390],
			[12_345, 12_345],
		]) {
			const shown = labels(values);

			expect(shown.length).toBeGreaterThan(0);
			expect(new Set(shown).size).toBe(shown.length);
		}

		expect(labels([10_000_000, 10_005_000])).toEqual(["99,5 k€", "100 k€", "100,5 k€"]);
	});

	it("keeps every tick inside the domain", () => {
		for (const values of [
			[500_000, 505_000],
			[400_000, 500_000],
			[-500_000, 300_000],
		]) {
			const [low, high] = balanceDomain(minor(values), "EUR");

			for (const tick of axisTicks([low, high], "EUR", minor(values))) {
				expect(tick).toBeGreaterThanOrEqual(low);
				expect(tick).toBeLessThanOrEqual(high);
				expect(Number.isSafeInteger(tick)).toBe(true);
			}
		}
	});

	it("names one exact value, or none, when the domain is narrower than a label", () => {
		const small = [500_000, 505_000];

		expect(axisTicks(balanceDomain(minor(small), "EUR"), "EUR", minor(small))).toEqual([500_000]);
		expect(labels(small)).toEqual(["5 k€"]);

		// 1 011,82 € to 1 031,18 €: no multiple of 100 € inside, and « 1 k€ » would misread it.
		const narrow = [101_800, 102_500];

		expect(axisTicks(balanceDomain(minor(narrow), "EUR"), "EUR", minor(narrow))).toEqual([]);
	});

	it("never crosses zero on its own", () => {
		expect(
			axisTicks(balanceDomain(minor([0, 500_000]), "EUR"), "EUR", minor([0, 500_000])).at(0),
		).toBe(0);
		expect(
			axisTicks(balanceDomain(minor([-500_000, 0]), "EUR"), "EUR", minor([-500_000, 0])).at(-1),
		).toBe(0);
		expect(axisTicks(balanceDomain(minor([0, 0]), "EUR"), "EUR", minor([0, 0]))).toEqual([0]);
	});

	it("crosses zero when the series does", () => {
		const values = [-100_000, 300_000];
		const ticks = axisTicks(balanceDomain(minor(values), "EUR"), "EUR", minor(values));

		expect(ticks.at(0)).toBeLessThan(0);
		expect(ticks).toContain(0);
		expect(ticks.at(-1)).toBeGreaterThan(0);
	});
});
