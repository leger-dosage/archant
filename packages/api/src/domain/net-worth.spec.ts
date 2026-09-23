import type { DailyBalance } from "./balances/forward.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { netWorthSeries } from "./net-worth.ts";

const point = (date: string, balance: number): DailyBalance => ({
	date,
	balance: toMinorUnits(balance),
});

describe("netWorthSeries", () => {
	it("adds assets and subtracts the amount owed on liabilities, day by day", () => {
		expect(
			netWorthSeries([
				{
					classification: "asset",
					points: [point("2026-09-20", 100000), point("2026-09-21", 90000)],
				},
				{
					classification: "liability",
					points: [point("2026-09-20", 30000), point("2026-09-21", 35000)],
				},
			]),
		).toEqual([point("2026-09-20", 70000), point("2026-09-21", 55000)]);
	});

	it("counts a late opener only from its first day", () => {
		expect(
			netWorthSeries([
				{
					classification: "asset",
					points: [point("2026-09-19", 1000), point("2026-09-20", 1000), point("2026-09-21", 1000)],
				},
				{ classification: "asset", points: [point("2026-09-21", 500)] },
			]),
		).toEqual([point("2026-09-19", 1000), point("2026-09-20", 1000), point("2026-09-21", 1500)]);
	});

	it("has no point before every account opened, whatever the input order", () => {
		expect(
			netWorthSeries([
				{ classification: "liability", points: [point("2026-09-21", 200)] },
				{ classification: "asset", points: [point("2026-09-20", 50), point("2026-09-21", 50)] },
			]),
		).toEqual([point("2026-09-20", 50), point("2026-09-21", -150)]);
	});

	it("goes below zero when debts outweigh assets", () => {
		expect(
			netWorthSeries([{ classification: "liability", points: [point("2026-09-21", 30000)] }]),
		).toEqual([point("2026-09-21", -30000)]);
	});

	it("is empty without an account or without a point", () => {
		expect(netWorthSeries([])).toEqual([]);
		expect(netWorthSeries([{ classification: "asset", points: [] }])).toEqual([]);
	});
});
