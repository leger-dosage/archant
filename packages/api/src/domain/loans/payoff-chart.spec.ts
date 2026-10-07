import type { DailyBalance } from "../balances/forward.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	chartDomain,
	payoffChartSeries,
	projectedSeries,
	scheduledSeries,
} from "./payoff-chart.ts";

const ing = {
	asOf: "2026-10-06",
	originationDate: "2020-12-05",
	scheduledPayoffDate: "2045-12-05",
};

const at = (date: string, balance: number): DailyBalance => ({
	date,
	balance: toMinorUnits(balance),
});

describe("chartDomain", () => {
	it("runs « Tout » from origination to the later payoff", () => {
		expect(chartDomain({ ...ing, months: "all", projectedPayoffDate: "2043-11-05" })).toEqual({
			from: "2020-12-05",
			to: "2045-12-05",
		});
		expect(chartDomain({ ...ing, months: "all", projectedPayoffDate: "2046-01-05" })).toEqual({
			from: "2020-12-05",
			to: "2046-01-05",
		});
	});

	it("never ends « Tout » before today, with or without a projected payoff", () => {
		const finished = { ...ing, scheduledPayoffDate: "2026-01-05" };

		expect(chartDomain({ ...finished, months: "all", projectedPayoffDate: null })).toEqual({
			from: "2020-12-05",
			to: "2026-10-06",
		});
		expect(chartDomain({ ...ing, months: "all", projectedPayoffDate: null }).to).toBe("2045-12-05");
	});

	it("ends a period today and opens it a number of months back", () => {
		expect(chartDomain({ ...ing, months: 12, projectedPayoffDate: "2045-12-05" })).toEqual({
			from: "2025-10-06",
			to: "2026-10-06",
		});
	});

	it("never opens a period before origination", () => {
		expect(
			chartDomain({ ...ing, months: 12, originationDate: "2026-03-05", projectedPayoffDate: null }),
		).toEqual({
			from: "2026-03-05",
			to: "2026-10-06",
		});
	});

	it("keeps a day of axis for a loan originated today", () => {
		expect(
			chartDomain({ ...ing, months: 1, originationDate: "2026-10-06", projectedPayoffDate: null }),
		).toEqual({
			from: "2026-10-06",
			to: "2026-10-07",
		});
	});
});

describe("scheduledSeries", () => {
	it("opens at origination with the amount borrowed", () => {
		const schedule = {
			originationDate: "2026-01-15",
			payments: [
				{
					number: 1,
					date: "2026-02-15",
					payment: 0n,
					principal: 0n,
					interest: 0n,
					endingBalance: 600n,
				},
				{
					number: 2,
					date: "2026-03-15",
					payment: 0n,
					principal: 0n,
					interest: 0n,
					endingBalance: 0n,
				},
			],
		};

		expect(scheduledSeries(schedule, 1_200n)).toEqual([
			at("2026-01-15", 1_200),
			at("2026-02-15", 600),
			at("2026-03-15", 0),
		]);
	});
});

describe("projectedSeries", () => {
	it("opens today at today's balance", () => {
		const projection = {
			converged: false as const,
			payments: [{ date: "2026-11-05", endingBalance: 400n }],
			balloon: 400n,
		};

		expect(projectedSeries("2026-10-06", 500n, projection)).toEqual([
			at("2026-10-06", 500),
			at("2026-11-05", 400),
		]);
	});

	it("is empty with nothing to project", () => {
		expect(projectedSeries("2026-10-06", 0n, null)).toEqual([]);
	});
});

describe("payoffChartSeries", () => {
	const domain = { from: "2026-01-01", to: "2026-12-31" };

	it("cuts each series to the domain, one point either side", () => {
		const scheduled = [
			at("2025-11-01", 900),
			at("2025-12-01", 800),
			at("2026-06-01", 500),
			at("2027-01-01", 100),
			at("2027-02-01", 0),
		];
		const series = payoffChartSeries({ actual: [], scheduled, projected: [] }, domain);

		expect(series.scheduled).toEqual([
			at("2025-12-01", 800),
			at("2026-06-01", 500),
			at("2027-01-01", 100),
		]);
	});

	it("names in the legend's order the series that draw a line in the domain", () => {
		const series = payoffChartSeries(
			{
				// Two points inside.
				actual: [at("2026-03-01", 500), at("2026-04-01", 450)],
				// Crossing it with no point inside.
				scheduled: [at("2025-06-01", 900), at("2027-06-01", 0)],
				// One point on its edge.
				projected: [at("2026-12-31", 450), at("2027-01-31", 400)],
			},
			domain,
		);

		expect(series.visible).toEqual(["actual", "scheduled"]);
	});

	it("draws nothing for an empty series or one that stays on one side", () => {
		const series = payoffChartSeries(
			{
				actual: [],
				scheduled: [at("2025-06-01", 900), at("2025-07-01", 800)],
				projected: [at("2027-06-01", 900), at("2027-07-01", 800)],
			},
			domain,
		);

		expect(series.visible).toEqual([]);
	});
});
