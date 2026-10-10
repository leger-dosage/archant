import { describe, expect, it } from "vitest";

import { periodInterval, seriesDates, seriesPointCount, surePeriodRange } from "./sure-periods.ts";

describe("surePeriodRange", () => {
	// A Wednesday.
	const today = "2026-09-23";

	it("gives each of Sure's keys its days", () => {
		expect(surePeriodRange("last_day", today, null)).toEqual({ from: "2026-09-22", to: today });
		expect(surePeriodRange("current_week", today, null)).toEqual({ from: "2026-09-21", to: today });
		expect(surePeriodRange("last_7_days", today, null)).toEqual({ from: "2026-09-16", to: today });
		expect(surePeriodRange("current_month", today, null)).toEqual({
			from: "2026-09-01",
			to: today,
		});
		expect(surePeriodRange("last_month", today, null)).toEqual({
			from: "2026-08-01",
			to: "2026-08-31",
		});
		expect(surePeriodRange("last_30_days", today, null).from).toBe("2026-08-24");
		expect(surePeriodRange("last_90_days", today, null).from).toBe("2026-06-25");
		expect(surePeriodRange("current_year", today, null).from).toBe("2026-01-01");
		expect(surePeriodRange("last_365_days", today, null).from).toBe("2025-09-23");
		expect(surePeriodRange("last_5_years", today, null).from).toBe("2021-09-23");
		expect(surePeriodRange("last_10_years", today, null).from).toBe("2016-09-23");
	});

	it("starts all_time at the oldest entry, or five years back without one before today", () => {
		expect(surePeriodRange("all_time", today, "2019-03-04").from).toBe("2019-03-04");
		expect(surePeriodRange("all_time", today, null).from).toBe("2021-09-23");
		expect(surePeriodRange("all_time", today, today).from).toBe("2021-09-23");
	});

	it("takes Monday for the week's start, even on a Sunday", () => {
		expect(surePeriodRange("current_week", "2026-09-27", null).from).toBe("2026-09-21");
		expect(surePeriodRange("current_week", "2026-09-21", null).from).toBe("2026-09-21");
	});

	it("ends last_month on its last day, March into February", () => {
		expect(surePeriodRange("last_month", "2026-03-31", null)).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
	});
});

describe("seriesPointCount", () => {
	it("divides the days by the interval's, rounded down, as Sure's series_points", () => {
		expect(seriesPointCount({ from: "2025-08-17", to: "2026-09-20" }, "1 day")).toBe(400);
		expect(seriesPointCount({ from: "2025-08-16", to: "2026-09-20" }, "1 day")).toBe(401);
		expect(seriesPointCount({ from: "2026-01-01", to: "2026-01-13" }, "1 week")).toBe(1);
		expect(seriesPointCount({ from: "2016-01-01", to: "2026-12-31" }, "1 month")).toBe(133);
	});
});

describe("seriesDates", () => {
	it("steps from the first day and always ends on the last", () => {
		expect(seriesDates({ from: "2026-08-22", to: "2026-09-21" }, "1 week")).toEqual([
			"2026-08-22",
			"2026-08-29",
			"2026-09-05",
			"2026-09-12",
			"2026-09-19",
			"2026-09-21",
		]);
		expect(seriesDates({ from: "2026-09-19", to: "2026-09-21" }, "1 day")).toEqual([
			"2026-09-19",
			"2026-09-20",
			"2026-09-21",
		]);
		expect(seriesDates({ from: "2026-09-21", to: "2026-09-21" }, "1 month")).toEqual([
			"2026-09-21",
		]);
	});

	it("adds each month to the previous step, as PostgreSQL does", () => {
		expect(seriesDates({ from: "2026-01-31", to: "2026-04-30" }, "1 month")).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-28",
			"2026-04-28",
			"2026-04-30",
		]);
	});
});

describe("periodInterval", () => {
	it("steps by day up to a calendar year, by week up to five, by month beyond, as Sure's Period#interval", () => {
		expect(periodInterval({ from: "2025-09-21", to: "2026-09-21" })).toBe("1 day");
		expect(periodInterval({ from: "2025-09-21", to: "2026-09-22" })).toBe("1 week");
		expect(periodInterval({ from: "2021-09-21", to: "2026-09-21" })).toBe("1 week");
		expect(periodInterval({ from: "2021-09-21", to: "2026-09-22" })).toBe("1 month");
	});
});
