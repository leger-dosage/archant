import type { ReverseInput } from "./reverse.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { reverseBalances } from "./reverse.ts";

const m = toMinorUnits;

// Checking opened on 2026-09-01 at 1 000,00, linked to its bank, which says
// 1 000,00 at the end of 2026-09-05.
const linked: ReverseInput = {
	from: "2026-09-01",
	anchor: { date: "2026-09-05", balance: m(100000) },
	opening: { date: "2026-09-01", balance: m(100000) },
	valuations: [],
	movements: [],
	until: "2026-09-05",
	classification: "asset",
};

const balances = (input: ReverseInput) => reverseBalances(input).map((row) => row.balance);

describe("reverseBalances", () => {
	it("carries the anchor back to the opening day when nothing moves", () => {
		expect(reverseBalances(linked)).toEqual([
			{ date: "2026-09-01", balance: 100000 },
			{ date: "2026-09-02", balance: 100000 },
			{ date: "2026-09-03", balance: 100000 },
			{ date: "2026-09-04", balance: 100000 },
			{ date: "2026-09-05", balance: 100000 },
		]);
	});

	it("takes each earlier day as the next day's balance less the next day's movements", () => {
		expect(
			balances({
				...linked,
				opening: { date: "2026-09-01", balance: m(113290) },
				movements: [
					{ date: "2026-09-05", amount: m(-4290) },
					{ date: "2026-09-05", amount: m(1000) },
					{ date: "2026-09-03", amount: m(-10000) },
				],
			}),
		).toEqual([113290, 113290, 103290, 103290, 100000]);
	});

	it("ignores the movements of the opening day, which no earlier day follows", () => {
		expect(balances({ ...linked, movements: [{ date: "2026-09-01", amount: m(-5000) }] })).toEqual([
			100000, 100000, 100000, 100000, 100000,
		]);
	});

	it("resets a reconciled day to its value, and derives the days before from it", () => {
		expect(
			balances({
				...linked,
				opening: { date: "2026-09-01", balance: m(53000) },
				valuations: [{ date: "2026-09-03", balance: m(50000) }],
				movements: [
					{ date: "2026-09-03", amount: m(-2000) },
					{ date: "2026-09-02", amount: m(-1000) },
				],
			}),
		).toEqual([53000, 52000, 50000, 100000, 100000]);
	});

	it("moves only the days between two bank figures for a line missing between them", () => {
		// The bank said 1 000,00 on the 2nd, then 900,00 on the 5th; the lines
		// it sent in between make 50,00 only.
		const movements = [
			{ date: "2026-09-02", amount: m(-700) },
			{ date: "2026-09-03", amount: m(-3000) },
			{ date: "2026-09-04", amount: m(-2000) },
		];
		const figures = (anchor: number) =>
			balances({
				...linked,
				anchor: { date: "2026-09-05", balance: m(anchor) },
				opening: { date: "2026-09-01", balance: m(100700) },
				valuations: [{ date: "2026-09-02", balance: m(100000) }],
				movements,
			});

		expect(figures(95000)).toEqual([100700, 100000, 97000, 95000, 95000]);
		expect(figures(90000)).toEqual([100700, 100000, 92000, 90000, 90000]);
	});

	it("keeps the anchor day at the anchor, a reconciliation on that day included", () => {
		expect(
			balances({
				...linked,
				opening: { date: "2026-09-01", balance: m(100100) },
				valuations: [{ date: "2026-09-05", balance: m(1) }],
				movements: [{ date: "2026-09-05", amount: m(-100) }],
			}),
		).toEqual([100100, 100100, 100100, 100100, 100000]);
	});

	it("lowers a liability's amount owed going back over a purchase", () => {
		expect(
			balances({
				...linked,
				anchor: { date: "2026-09-05", balance: m(30000) },
				opening: { date: "2026-09-01", balance: m(37000) },
				classification: "liability",
				movements: [
					{ date: "2026-09-04", amount: m(-3000) },
					{ date: "2026-09-02", amount: m(10000) },
				],
			}),
		).toEqual([37000, 27000, 27000, 30000, 30000]);
	});

	it("computes the days after the anchor forward from it", () => {
		expect(
			reverseBalances({
				...linked,
				from: "2026-09-04",
				until: "2026-09-08",
				valuations: [{ date: "2026-09-07", balance: m(70000) }],
				movements: [
					{ date: "2026-09-06", amount: m(-500) },
					{ date: "2026-09-08", amount: m(200) },
				],
			}),
		).toEqual([
			{ date: "2026-09-04", balance: 100000 },
			{ date: "2026-09-05", balance: 100000 },
			{ date: "2026-09-06", balance: 99500 },
			{ date: "2026-09-07", balance: 70000 },
			{ date: "2026-09-08", balance: 70200 },
		]);
	});

	// Sure's `use_opening_anchor_for_date?` and `opening_boundary_adjustment`.
	it("ends the opening day at the opening anchor, the next day bridging the gap", () => {
		const rows = balances({
			...linked,
			opening: { date: "2026-09-01", balance: m(50000) },
			movements: [{ date: "2026-09-02", amount: m(-2000) }],
		});

		expect(rows).toEqual([50000, 100000, 100000, 100000, 100000]);
		// Sure's cash adjustment on the day after: end - start - flows.
		expect(rows[1]! - rows[0]! - -2000).toBe(52000);
	});

	it("ends a liability's opening day at the amount owed it gives", () => {
		expect(
			balances({
				...linked,
				anchor: { date: "2026-09-05", balance: m(30000) },
				opening: { date: "2026-09-01", balance: m(10000) },
				classification: "liability",
				movements: [{ date: "2026-09-03", amount: m(-3000) }],
			}),
		).toEqual([10000, 27000, 30000, 30000, 30000]);
	});

	it("goes on past the opening date down to an older line, from the opening amount", () => {
		expect(
			reverseBalances({
				...linked,
				from: "2026-08-30",
				movements: [
					{ date: "2026-08-30", amount: m(-2000) },
					{ date: "2026-08-31", amount: m(-300) },
					// The opening day starts where it ends: undone for nothing.
					{ date: "2026-09-01", amount: m(-50) },
					{ date: "2026-09-03", amount: m(-500) },
				],
			}),
		).toEqual([
			{ date: "2026-08-30", balance: 100300 },
			{ date: "2026-08-31", balance: 100000 },
			{ date: "2026-09-01", balance: 100000 },
			{ date: "2026-09-02", balance: 100500 },
			{ date: "2026-09-03", balance: 100000 },
			{ date: "2026-09-04", balance: 100000 },
			{ date: "2026-09-05", balance: 100000 },
		]);
	});

	it("ends the anchor's own day at the opening amount when both share it", () => {
		expect(
			reverseBalances({
				...linked,
				from: "2026-09-03",
				until: "2026-09-07",
				opening: { date: "2026-09-05", balance: m(70000) },
				movements: [
					{ date: "2026-09-04", amount: m(-100) },
					{ date: "2026-09-05", amount: m(-40) },
					{ date: "2026-09-06", amount: m(-100) },
				],
			}),
		).toEqual([
			{ date: "2026-09-03", balance: 70100 },
			{ date: "2026-09-04", balance: 70000 },
			{ date: "2026-09-05", balance: 70000 },
			{ date: "2026-09-06", balance: 69900 },
			{ date: "2026-09-07", balance: 69900 },
		]);
	});

	it("ends an opening day after the anchor at its amount, going forward", () => {
		expect(
			reverseBalances({
				...linked,
				from: "2026-09-05",
				until: "2026-09-08",
				opening: { date: "2026-09-07", balance: m(70000) },
				movements: [
					{ date: "2026-09-06", amount: m(-500) },
					{ date: "2026-09-08", amount: m(200) },
				],
			}),
		).toEqual([
			{ date: "2026-09-05", balance: 100000 },
			{ date: "2026-09-06", balance: 99500 },
			{ date: "2026-09-07", balance: 70000 },
			{ date: "2026-09-08", balance: 70200 },
		]);
	});

	it("leaves out the days before the first day when the anchor precedes it", () => {
		expect(
			reverseBalances({
				...linked,
				from: "2026-09-07",
				until: "2026-09-08",
				movements: [{ date: "2026-09-08", amount: m(-100) }],
			}),
		).toEqual([
			{ date: "2026-09-07", balance: 100000 },
			{ date: "2026-09-08", balance: 99900 },
		]);
	});

	it("leaves out an anchor dated after the last day", () => {
		expect(reverseBalances({ ...linked, from: "2026-09-03", until: "2026-09-04" })).toEqual([
			{ date: "2026-09-03", balance: 100000 },
			{ date: "2026-09-04", balance: 100000 },
		]);
	});
});
