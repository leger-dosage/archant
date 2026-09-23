import { describe, expect, it } from "vitest";

import { addDays, addMonths, daysBetween, maxDate, minDate, monthRange, today } from "./dates.ts";

describe("today", () => {
	it("is the date in the given time zone, not in UTC", () => {
		const lateEvening = new Date("2026-09-21T22:30:00Z");

		expect(today("Europe/Paris", lateEvening)).toBe("2026-09-22");
		expect(today("UTC", lateEvening)).toBe("2026-09-21");
		expect(today("America/New_York", lateEvening)).toBe("2026-09-21");
	});

	it("defaults to now", () => {
		expect(today("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("addDays", () => {
	it("crosses months, years and leap days", () => {
		expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
	});

	it("is not shifted by a daylight-saving change", () => {
		expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
		expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
	});
});

describe("daysBetween", () => {
	it("counts whole days both ways, across months and a daylight-saving change", () => {
		expect(daysBetween("2026-09-03", "2026-09-05")).toBe(2);
		expect(daysBetween("2026-09-05", "2026-09-03")).toBe(-2);
		expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
		expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
		expect(daysBetween("2026-09-05", "2026-09-05")).toBe(0);
	});
});

describe("maxDate", () => {
	it("returns the later date whichever side it is on", () => {
		expect(maxDate("2026-09-01", "2026-09-21")).toBe("2026-09-21");
		expect(maxDate("2026-09-21", "2026-09-01")).toBe("2026-09-21");
	});
});

describe("minDate", () => {
	it("returns the earlier date whichever side it is on", () => {
		expect(minDate("2026-09-01", "2026-09-21")).toBe("2026-09-01");
		expect(minDate("2026-09-21", "2026-09-01")).toBe("2026-09-01");
	});
});

describe("addMonths", () => {
	it("moves by calendar months, across years in both directions", () => {
		expect(addMonths("2026-09-21", -1)).toBe("2026-08-21");
		expect(addMonths("2026-09-21", -12)).toBe("2025-09-21");
		expect(addMonths("2026-01-10", -3)).toBe("2025-10-10");
		expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
		expect(addMonths("2026-09-21", 0)).toBe("2026-09-21");
	});

	it("clamps a day the target month lacks to its last day", () => {
		expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
		expect(addMonths("2026-05-31", -1)).toBe("2026-04-30");
		expect(addMonths("2026-12-31", -6)).toBe("2026-06-30");
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
	});

	it("follows the leap-year rule, centuries included", () => {
		expect(addMonths("2028-03-31", -1)).toBe("2028-02-29");
		expect(addMonths("2024-02-29", -12)).toBe("2023-02-28");
		expect(addMonths("2000-03-30", -1)).toBe("2000-02-29");
		expect(addMonths("1900-03-30", -1)).toBe("1900-02-28");
	});
});

describe("monthRange", () => {
	it("spans a whole calendar month, February and December included", () => {
		expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
		expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
		expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
	});
});
