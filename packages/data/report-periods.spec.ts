import { describe, expect, it } from "vitest";

import { defaultReportRange, quarterOf, reportNavigation, reportPeriod } from "./report-periods.ts";

const TODAY = "2026-11-06";

describe("reportPeriod", () => {
	it("reads the current month by default, its comparison ending the day before", () => {
		expect(reportPeriod("monthly", undefined, undefined, TODAY)).toEqual({
			type: "monthly",
			from: "2026-11-01",
			to: "2026-11-30",
			swapped: false,
			previous: { from: "2026-10-02", to: "2026-10-31" },
		});
	});

	it("gives each type Sure's default bounds", () => {
		expect(defaultReportRange("quarterly", TODAY)).toEqual({
			from: "2026-10-01",
			to: "2026-12-31",
		});
		expect(defaultReportRange("ytd", TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
		expect(defaultReportRange("last_6_months", TODAY)).toEqual({
			from: "2026-06-01",
			to: "2026-11-30",
		});
		expect(defaultReportRange("custom", TODAY)).toEqual({ from: "2026-10-06", to: TODAY });
		// One month before 31 March is the last day of February, as Rails' `1.month.ago`.
		expect(defaultReportRange("custom", "2026-03-31")).toEqual({
			from: "2026-02-28",
			to: "2026-03-31",
		});
	});

	it("keeps a given date and defaults the other one", () => {
		const period = reportPeriod("monthly", "2026-09-01", undefined, TODAY);

		expect([period.from, period.to]).toEqual(["2026-09-01", "2026-11-30"]);
	});

	it("swaps a reversed custom range and flags it", () => {
		const period = reportPeriod("custom", "2026-10-20", "2026-10-05", TODAY);

		expect(period).toMatchObject({ from: "2026-10-05", to: "2026-10-20", swapped: true });
		expect(period.previous).toEqual({ from: "2026-09-19", to: "2026-10-04" });
	});
});

describe("quarterOf", () => {
	it("numbers the quarters from January", () => {
		expect(["2026-01-01", "2026-03-31", "2026-04-01", "2026-12-31"].map(quarterOf)).toEqual([
			1, 1, 2, 4,
		]);
	});
});

const navigate = (type: Parameters<typeof reportPeriod>[0], from?: string, to?: string) =>
	reportNavigation(reportPeriod(type, from, to, TODAY), TODAY);

describe("reportNavigation", () => {
	it("steps a month either way, the next one disabled at the current month", () => {
		expect(navigate("monthly")).toEqual({
			previous: { from: "2026-10-01", to: "2026-10-31" },
			next: { from: "2026-12-01", to: "2026-12-31" },
			atLatest: true,
			label: { kind: "monthly", month: "2026-11" },
		});
		expect(navigate("monthly", "2026-01-01", "2026-01-31")).toMatchObject({
			previous: { from: "2025-12-01", to: "2025-12-31" },
			next: { from: "2026-02-01", to: "2026-02-28" },
			atLatest: false,
		});
	});

	it("steps a quarter across a year", () => {
		expect(navigate("quarterly")).toEqual({
			previous: { from: "2026-07-01", to: "2026-09-30" },
			next: { from: "2027-01-01", to: "2027-03-31" },
			atLatest: true,
			label: { kind: "quarterly", quarter: 4, year: 2026 },
		});
		expect(navigate("quarterly", "2026-01-01", "2026-03-31")).toMatchObject({
			previous: { from: "2025-10-01", to: "2025-12-31" },
			atLatest: false,
		});
	});

	it("steps a year to date back to a whole year, and forward to today", () => {
		expect(navigate("ytd")).toEqual({
			previous: { from: "2025-01-01", to: "2025-12-31" },
			next: { from: "2027-01-01", to: "2027-12-31" },
			atLatest: true,
			label: { kind: "ytd", year: 2026 },
		});
		expect(navigate("ytd", "2025-01-01", "2025-12-31")).toEqual({
			previous: { from: "2024-01-01", to: "2024-12-31" },
			next: { from: "2026-01-01", to: TODAY },
			atLatest: false,
			label: { kind: "past_year", year: 2025 },
		});
	});

	it("steps six months, snapping onto the six months ending this month", () => {
		expect(navigate("last_6_months")).toEqual({
			previous: { from: "2025-12-01", to: "2026-05-31" },
			next: { from: "2026-06-01", to: "2026-11-30" },
			atLatest: true,
			label: { kind: "last_6_months", from: "2026-06-01", to: "2026-11-30" },
		});
		expect(navigate("last_6_months", "2025-12-01", "2026-05-31")).toMatchObject({
			next: { from: "2026-06-01", to: "2026-11-30" },
			atLatest: false,
		});
		expect(navigate("last_6_months", "2025-01-01", "2025-06-30")).toMatchObject({
			next: { from: "2025-07-01", to: "2025-12-31" },
			atLatest: false,
		});
	});

	it("has no arrows for a custom range", () => {
		expect(navigate("custom")).toBeNull();
	});
});
