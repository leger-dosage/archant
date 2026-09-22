import { describe, expect, it } from "vitest";

import { providerDate } from "./provider-date.ts";

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
