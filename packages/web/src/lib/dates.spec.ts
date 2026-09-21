import { describe, expect, it } from "vitest";

import { dayHeading, frenchToIso, isoToFrench } from "./dates.ts";

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
