import { describe, expect, it } from "vitest";

import {
	addMonthsTo,
	dayHeading,
	frenchToIso,
	isoToFrench,
	ofMonth,
	toIsoMonth,
	yearsAgo,
} from "./dates.ts";

describe("frenchToIso", () => {
	it("reads a typed French date, padded or not", () => {
		expect(frenchToIso("15/09/2026")).toBe("2026-09-15");
		expect(frenchToIso("5/9/2026")).toBe("2026-09-05");
	});

	it("refuses a date that does not exist", () => {
		expect(frenchToIso("31/02/2026")).toBeNull();
	});

	it("refuses anything that is not a French date", () => {
		expect(frenchToIso("2026-09-15")).toBeNull();
		expect(frenchToIso("")).toBeNull();
	});
});

describe("isoToFrench", () => {
	it("round-trips with frenchToIso", () => {
		expect(isoToFrench("2026-09-15")).toBe("15/09/2026");
		expect(frenchToIso(isoToFrench("2028-02-29"))).toBe("2028-02-29");
	});
});

describe("dayHeading", () => {
	it("names today and yesterday, across a month boundary", () => {
		expect(dayHeading("2026-09-21", "2026-09-21")).toEqual({ kind: "today" });
		expect(dayHeading("2026-08-31", "2026-09-01")).toEqual({ kind: "yesterday" });
	});

	it("gives the weekday this year and the year otherwise", () => {
		expect(dayHeading("2026-09-14", "2026-09-21")).toEqual({
			kind: "date",
			text: "lundi 14 septembre",
		});
		expect(dayHeading("2025-09-15", "2026-09-21")).toEqual({
			kind: "date",
			text: "15 septembre 2025",
		});
	});
});

describe("yearsAgo", () => {
	it("is the same local day, years back", () => {
		expect(yearsAgo(2, new Date(2026, 8, 25, 23, 59))).toBe("2024-09-25");
		expect(yearsAgo(2, new Date(2026, 0, 1, 0, 1))).toBe("2024-01-01");
	});

	it("clamps 29 February to the 28th", () => {
		expect(yearsAgo(2, new Date(2028, 1, 29))).toBe("2026-02-28");
		expect(yearsAgo(4, new Date(2028, 1, 29))).toBe("2024-02-29");
	});
});

describe("toIsoMonth", () => {
	it("is the month of the local date", () => {
		expect(toIsoMonth(new Date(2026, 0, 31, 23, 59))).toBe("2026-01");
	});
});

describe("addMonthsTo", () => {
	it("moves by months across years in both directions", () => {
		expect(addMonthsTo("2026-09", -1)).toBe("2026-08");
		expect(addMonthsTo("2026-01", -1)).toBe("2025-12");
		expect(addMonthsTo("2026-12", 1)).toBe("2027-01");
		expect(addMonthsTo("2026-09", 0)).toBe("2026-09");
	});
});

describe("ofMonth", () => {
	it("follows a noun, eliding before a vowel", () => {
		expect(ofMonth("2026-09")).toBe("de septembre 2026");
		expect(ofMonth("2024-04")).toBe("d'avril 2024");
		expect(ofMonth("2024-08")).toBe("d'août 2024");
		expect(ofMonth("2024-10")).toBe("d'octobre 2024");
	});
});
