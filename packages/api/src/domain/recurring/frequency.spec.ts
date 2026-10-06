import type { FrequencyChoice, ScheduleFields } from "./frequency.ts";
import type { RecurrenceRule } from "./schedule.ts";

import { describe, expect, it } from "vitest";

import { applyFrequency, detectFrequency, isValidInterval } from "./frequency.ts";

const monthly = (day: number, interval = 1): RecurrenceRule => ({
	frequency: "monthly",
	interval,
	dayOfMonth: day,
});

const weekly = (weekday: number, interval = 1): RecurrenceRule => ({
	frequency: "weekly",
	interval,
	weekday,
});

const yearly = (day: number, month: number, interval = 1): RecurrenceRule => ({
	frequency: "yearly",
	interval,
	dayOfMonth: day,
	monthOfYear: month,
});

const blank = {
	dayOfMonth: null,
	secondDayOfMonth: null,
	weekday: null,
	monthOfYear: null,
	interval: null,
	intervalUnit: null,
};

/** A plain monthly series on the 5th, last paid on Tuesday 8 September 2026. */
function series(overrides: Partial<ScheduleFields> = {}): ScheduleFields {
	return {
		rules: [monthly(5)],
		anchorDate: null,
		lastOccurrenceDate: "2026-09-08",
		expectedDayOfMonth: 5,
		...overrides,
	};
}

describe("detectFrequency", () => {
	it("reads one rule as its preset", () => {
		expect(detectFrequency([monthly(5)])).toEqual({ ...blank, key: "monthly", dayOfMonth: 5 });
		expect(detectFrequency([weekly(1)])).toEqual({ ...blank, key: "weekly", weekday: 1 });
		expect(detectFrequency([weekly(5, 2)])).toEqual({ ...blank, key: "biweekly", weekday: 5 });
		expect(detectFrequency([monthly(-1, 3)])).toEqual({
			...blank,
			key: "quarterly",
			dayOfMonth: -1,
		});
		expect(detectFrequency([monthly(10, 6)])).toEqual({
			...blank,
			key: "semiannual",
			dayOfMonth: 10,
		});
		expect(detectFrequency([yearly(15, 3)])).toEqual({
			...blank,
			key: "annual",
			dayOfMonth: 15,
			monthOfYear: 3,
		});
	});

	it("reads two monthly days as twice a month, the last day sorted last", () => {
		expect(detectFrequency([monthly(1), monthly(15)])).toEqual({
			...blank,
			key: "semimonthly",
			dayOfMonth: 1,
			secondDayOfMonth: 15,
		});
		expect(detectFrequency([monthly(-1), monthly(15)])).toEqual({
			...blank,
			key: "semimonthly",
			dayOfMonth: 15,
			secondDayOfMonth: -1,
		});
		expect(detectFrequency([monthly(20), monthly(20)])).toEqual({
			...blank,
			key: "monthly",
			dayOfMonth: 20,
		});
	});

	it("reads any other single rule as an interval", () => {
		expect(detectFrequency([monthly(10, 4)])).toEqual({
			...blank,
			key: "interval",
			interval: 4,
			intervalUnit: "monthly",
			dayOfMonth: 10,
		});
		expect(detectFrequency([weekly(3, 3)])).toEqual({
			...blank,
			key: "interval",
			interval: 3,
			intervalUnit: "weekly",
			weekday: 3,
		});
		expect(detectFrequency([yearly(1, 7, 2)])).toEqual({
			...blank,
			key: "interval",
			interval: 2,
			intervalUnit: "yearly",
			dayOfMonth: 1,
			monthOfYear: 7,
		});
	});

	it("reads a shape no preset expresses as custom", () => {
		const custom = { ...blank, key: "custom" };

		expect(detectFrequency([monthly(1, 2), monthly(15, 2)])).toEqual(custom);
		expect(detectFrequency([monthly(1), weekly(3)])).toEqual(custom);
		expect(detectFrequency([weekly(3), monthly(1)])).toEqual(custom);
		expect(detectFrequency([monthly(1), monthly(10), monthly(20)])).toEqual(custom);
		expect(detectFrequency([])).toEqual(custom);
	});
});

/** `choice` applied to `current`, then read back. */
function roundTrip(choice: FrequencyChoice, current = series()) {
	const change = applyFrequency(current, choice);

	return change === null ? null : { ...change, read: detectFrequency(change.rules) };
}

describe("applyFrequency", () => {
	it("writes each preset, which reads back as itself", () => {
		expect(roundTrip({ preset: "weekly", weekday: 2 })).toEqual({
			rules: [weekly(2)],
			expectedDayOfMonth: 8,
			anchorDate: null,
			read: { ...blank, key: "weekly", weekday: 2 },
		});
		expect(roundTrip({ preset: "biweekly", weekday: 5 })).toEqual({
			rules: [weekly(5, 2)],
			expectedDayOfMonth: 8,
			anchorDate: "2026-09-08",
			read: { ...blank, key: "biweekly", weekday: 5 },
		});
		expect(roundTrip({ preset: "semimonthly", dayOfMonth: 15, secondDayOfMonth: 1 })).toEqual({
			rules: [monthly(1), monthly(15)],
			expectedDayOfMonth: 1,
			anchorDate: null,
			read: { ...blank, key: "semimonthly", dayOfMonth: 1, secondDayOfMonth: 15 },
		});
		expect(roundTrip({ preset: "quarterly", dayOfMonth: -1 })).toEqual({
			rules: [monthly(-1, 3)],
			expectedDayOfMonth: 31,
			anchorDate: "2026-09-08",
			read: { ...blank, key: "quarterly", dayOfMonth: -1 },
		});
		expect(roundTrip({ preset: "semiannual" })).toEqual({
			rules: [monthly(5, 6)],
			expectedDayOfMonth: 5,
			anchorDate: "2026-09-08",
			read: { ...blank, key: "semiannual", dayOfMonth: 5 },
		});
		expect(roundTrip({ preset: "annual", dayOfMonth: 15, monthOfYear: 3 })).toEqual({
			rules: [yearly(15, 3)],
			expectedDayOfMonth: 15,
			anchorDate: null,
			read: { ...blank, key: "annual", dayOfMonth: 15, monthOfYear: 3 },
		});
		expect(roundTrip({ preset: "monthly", dayOfMonth: 20 })).toEqual({
			rules: [monthly(20)],
			expectedDayOfMonth: 20,
			anchorDate: null,
			read: { ...blank, key: "monthly", dayOfMonth: 20 },
		});
	});

	it("takes Sure's defaults for a day left out", () => {
		// The reference, the last date, is Tuesday 8 September.
		expect(applyFrequency(series(), { preset: "weekly" })?.rules).toEqual([weekly(2)]);
		expect(applyFrequency(series(), { preset: "semimonthly" })?.rules).toEqual([
			monthly(1),
			monthly(15),
		]);
		expect(applyFrequency(series(), { preset: "annual" })?.rules).toEqual([yearly(8, 9)]);
		expect(applyFrequency(series(), { preset: "quarterly" })?.rules).toEqual([monthly(5, 3)]);
		expect(
			applyFrequency(series(), { preset: "interval", interval: 2, unit: "yearly" })?.rules,
		).toEqual([yearly(8, 9, 2)]);
		expect(
			applyFrequency(series(), { preset: "interval", interval: 4, unit: "monthly" })?.rules,
		).toEqual([monthly(5, 4)]);
	});

	it("reads the anchor first, the last date else, and keeps an anchor already set", () => {
		const anchored = series({ anchorDate: "2026-02-10" });

		expect(applyFrequency(anchored, { preset: "weekly" })).toEqual({
			rules: [weekly(2)],
			expectedDayOfMonth: 10,
			anchorDate: "2026-02-10",
		});
		expect(applyFrequency(anchored, { preset: "quarterly", dayOfMonth: 10 })?.anchorDate).toBe(
			"2026-02-10",
		);
	});

	it("writes every N weeks, months or years, a named one as its preset", () => {
		expect(roundTrip({ preset: "interval", interval: 4, unit: "monthly", dayOfMonth: 10 })).toEqual(
			{
				rules: [monthly(10, 4)],
				expectedDayOfMonth: 10,
				anchorDate: "2026-09-08",
				read: {
					...blank,
					key: "interval",
					interval: 4,
					intervalUnit: "monthly",
					dayOfMonth: 10,
				},
			},
		);
		expect(roundTrip({ preset: "interval", interval: 3, unit: "weekly", weekday: 4 })).toEqual({
			rules: [weekly(4, 3)],
			expectedDayOfMonth: 8,
			anchorDate: "2026-09-08",
			read: { ...blank, key: "interval", interval: 3, intervalUnit: "weekly", weekday: 4 },
		});
		expect(
			roundTrip({
				preset: "interval",
				interval: 2,
				unit: "yearly",
				dayOfMonth: 1,
				monthOfYear: 7,
			}),
		).toMatchObject({ rules: [yearly(1, 7, 2)], expectedDayOfMonth: 1 });
		expect(roundTrip({ preset: "interval", interval: 3, unit: "monthly" })).toMatchObject({
			rules: [monthly(5, 3)],
			read: { key: "quarterly", dayOfMonth: 5 },
		});
	});

	it("is null for an unchanged cadence, a named interval included, and for custom", () => {
		expect(applyFrequency(series(), { preset: "monthly" })).toBeNull();
		expect(applyFrequency(series(), { preset: "monthly", dayOfMonth: 5 })).toBeNull();
		expect(
			applyFrequency(series(), { preset: "interval", interval: 1, unit: "monthly" }),
		).toBeNull();
		const quarterly = series({ rules: [monthly(5, 3)], anchorDate: "2026-06-05" });
		expect(
			applyFrequency(quarterly, { preset: "interval", interval: 3, unit: "monthly" }),
		).toBeNull();
		expect(
			applyFrequency(series({ rules: [monthly(1), monthly(15)] }), {
				preset: "semimonthly",
				dayOfMonth: 15,
				secondDayOfMonth: 1,
			}),
		).toBeNull();
		expect(applyFrequency(series(), { preset: "custom" })).toBeNull();
	});

	it("writes twice a month on one day as monthly", () => {
		expect(
			applyFrequency(series(), { preset: "semimonthly", dayOfMonth: 12, secondDayOfMonth: 12 }),
		).toEqual({ rules: [monthly(12)], expectedDayOfMonth: 12, anchorDate: null });
	});
});

describe("isValidInterval", () => {
	it("takes a whole number from 1 to 99", () => {
		expect(isValidInterval(1)).toBe(true);
		expect(isValidInterval(99)).toBe(true);
		expect(isValidInterval(0)).toBe(false);
		expect(isValidInterval(100)).toBe(false);
		expect(isValidInterval(2.5)).toBe(false);
	});
});
