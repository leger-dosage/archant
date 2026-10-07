import { describe, expect, it } from "vitest";

import { rateResolver } from "./rate-resolver.ts";

const changes = [
	{ effectiveDate: "2026-04-01", rate: 180_000 },
	{ effectiveDate: "2026-07-01", rate: 95_000 },
];

describe("rateResolver", () => {
	it("reads the change in force, and the base rate before any", () => {
		const { accrualRateFor } = rateResolver({
			rateType: "variable",
			interestRate: 60_000,
			rateChanges: changes,
		});

		expect(accrualRateFor("2026-03-31")).toBe(60_000);
		expect(accrualRateFor("2026-04-01")).toBe(180_000);
		expect(accrualRateFor("2026-06-30")).toBe(180_000);
		expect(accrualRateFor("2026-07-01")).toBe(95_000);
	});

	it("re-amortises at the changes within its bounds, both inclusive", () => {
		const { reAmortisationEvents } = rateResolver({
			rateType: "adjustable",
			interestRate: 60_000,
			rateChanges: changes,
		});

		expect(reAmortisationEvents("2026-04-01", "2026-07-01")).toEqual([
			{ date: "2026-04-01", rate: 180_000 },
			{ date: "2026-07-01", rate: 95_000 },
		]);
		expect(reAmortisationEvents("2026-04-02", "2026-06-30")).toEqual([]);
	});

	it("answers a fixed loan's rate for every date and ignores the changes it keeps", () => {
		const resolver = rateResolver({
			rateType: "fixed",
			interestRate: 60_000,
			rateChanges: changes,
		});

		expect(resolver.accrualRateFor("2026-12-01")).toBe(60_000);
		expect(resolver.reAmortisationEvents("2026-01-01", "2027-01-01")).toEqual([]);
	});
});
