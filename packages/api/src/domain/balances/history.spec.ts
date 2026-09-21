import type { DailyBalance } from "./forward.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { balanceChange, fillDays, periodRange } from "./history.ts";

describe("periodRange", () => {
	it("goes back one, three, six or twelve calendar months from today", () => {
		expect(periodRange(1, "2026-09-21", "2026-01-10")).toEqual({
			from: "2026-08-21",
			to: "2026-09-21",
		});
		expect(periodRange(3, "2026-09-21", "2020-01-01")?.from).toBe("2026-06-21");
		expect(periodRange(6, "2026-09-21", "2020-01-01")?.from).toBe("2026-03-21");
		expect(periodRange(12, "2026-09-21", "2020-01-01")?.from).toBe("2025-09-21");
	});

	it("clamps to the end of a shorter month", () => {
		expect(periodRange(1, "2026-03-31", "2020-01-01")?.from).toBe("2026-02-28");
	});

	it("never starts before the opening date", () => {
		expect(periodRange(6, "2026-09-21", "2026-09-01")).toEqual({
			from: "2026-09-01",
			to: "2026-09-21",
		});
	});

	it("starts at the opening date for all", () => {
		expect(periodRange("all", "2026-09-21", "2024-02-29")).toEqual({
			from: "2024-02-29",
			to: "2026-09-21",
		});
	});

	it("holds a single day when the account opened today", () => {
		expect(periodRange(1, "2026-09-21", "2026-09-21")).toEqual({
			from: "2026-09-21",
			to: "2026-09-21",
		});
	});

	it("is empty when the account opens after today", () => {
		expect(periodRange("all", "2026-09-21", "2026-09-22")).toBeNull();
	});
});

const point = (date: string, balance: number): DailyBalance => ({
	date,
	balance: toMinorUnits(balance),
});

describe("balanceChange", () => {
	it("is the last point minus the first, with its share of the first", () => {
		expect(balanceChange([point("2026-09-01", 123456), point("2026-09-21", 124696)])).toEqual({
			amount: 1240,
			percent: 1,
		});
	});

	it("measures a fall against the size of a negative start", () => {
		expect(balanceChange([point("2026-09-01", -20000), point("2026-09-21", -25000)])).toEqual({
			amount: -5000,
			percent: -25,
		});
	});

	it("rounds the percentage to one decimal", () => {
		expect(balanceChange([point("2026-09-01", 30000), point("2026-09-21", 30100)])).toEqual({
			amount: 100,
			percent: 0.3,
		});
	});

	it("rounds a half away from zero, a fall like a rise", () => {
		expect(balanceChange([point("2026-09-01", 40000), point("2026-09-21", 40100)])?.percent).toBe(
			0.3,
		);
		expect(balanceChange([point("2026-09-01", 40000), point("2026-09-21", 39900)])?.percent).toBe(
			-0.3,
		);
	});

	it("has no percentage when the period starts at zero", () => {
		expect(balanceChange([point("2026-09-01", 0), point("2026-09-21", 10000)])).toEqual({
			amount: 10000,
			percent: null,
		});
	});

	it("is zero for a single point", () => {
		expect(balanceChange([point("2026-09-21", 5000)])).toEqual({ amount: 0, percent: 0 });
	});

	it("is null for an empty series", () => {
		expect(balanceChange([])).toBeNull();
	});
});

describe("fillDays", () => {
	it("carries a row from before the range over every day without one", () => {
		expect(fillDays([point("2026-08-01", 100)], "2026-09-19", "2026-09-21")).toEqual([
			point("2026-09-19", 100),
			point("2026-09-20", 100),
			point("2026-09-21", 100),
		]);
	});

	it("takes each stored day and carries it until the next", () => {
		expect(
			fillDays(
				[point("2026-09-18", 100), point("2026-09-20", 250), point("2026-09-21", 300)],
				"2026-09-19",
				"2026-09-22",
			),
		).toEqual([
			point("2026-09-19", 100),
			point("2026-09-20", 250),
			point("2026-09-21", 300),
			point("2026-09-22", 300),
		]);
	});

	it("leaves out the days before the first known row", () => {
		expect(fillDays([point("2026-09-20", 100)], "2026-09-19", "2026-09-20")).toEqual([
			point("2026-09-20", 100),
		]);
	});

	it("is empty without any row", () => {
		expect(fillDays([], "2026-09-19", "2026-09-21")).toEqual([]);
	});
});
