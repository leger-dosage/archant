import { describe, expect, it } from "vitest";

import { addDays, maxDate, minDate, today } from "./dates.ts";

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
