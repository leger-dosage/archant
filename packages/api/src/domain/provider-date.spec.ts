import { describe, expect, it } from "vitest";

import { providerDate, providerIsoDate } from "./provider-date.ts";

describe("providerDate", () => {
	it("reads the literal date part, whatever time and zone follow", () => {
		expect(providerDate("20260912")).toBe("2026-09-12");
		expect(providerDate("20260912235959.000[+2:CEST]")).toBe("2026-09-12");
		expect(providerDate("20260101000000[-5:EST]")).toBe("2026-01-01");
	});

	it("accepts a leap day and refuses a day the month lacks", () => {
		expect(providerDate("20280229")).toBe("2028-02-29");
		expect(providerDate("20260229")).toBeNull();
		expect(providerDate("20260431")).toBeNull();
		expect(providerDate("20261301")).toBeNull();
		expect(providerDate("20260100")).toBeNull();
	});

	it("refuses text that does not start with eight digits", () => {
		expect(providerDate("")).toBeNull();
		expect(providerDate("2026-09-12")).toBeNull();
		expect(providerDate("2026091")).toBeNull();
		expect(providerDate(" 20260912")).toBeNull();
	});

	it("refuses a year before 1900, as account dates do", () => {
		expect(providerDate("18991231")).toBeNull();
		expect(providerDate("19000101")).toBe("1900-01-01");
	});
});

describe("providerIsoDate", () => {
	it("reads the date part of an ISO date or date-time, never through a zone", () => {
		expect(providerIsoDate("2026-09-12")).toBe("2026-09-12");
		expect(providerIsoDate("2026-09-12T23:30:00+02:00")).toBe("2026-09-12");
	});

	it("refuses anything else, and a day the month lacks", () => {
		expect(providerIsoDate("20260912")).toBeNull();
		expect(providerIsoDate("2026-09-123")).toBeNull();
		expect(providerIsoDate("12/09/2026")).toBeNull();
		expect(providerIsoDate("2026-02-30")).toBeNull();
	});
});
