import { describe, expect, it } from "vitest";

import { frenchToIso, isoToFrench } from "./dates.ts";

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
