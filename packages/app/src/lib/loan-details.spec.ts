import { describe, expect, it } from "vitest";

import type { LoanDetails } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import {
	completeLoanInput,
	formatRate,
	loanDetailsToInput,
	proposedTerm,
	rateToText,
	termOf,
} from "./loan-details.ts";

const unknownTerms: LoanDetails = {
	originalAmount: null,
	downPayment: null,
	startDate: null,
	termMonths: null,
	rateType: null,
	interestRate: null,
	insuranceRate: null,
	insuranceRateType: null,
	rateChanges: [],
	endDate: null,
};

describe("rateToText", () => {
	it("writes millionths back as the percentage typed, two decimals at least", () => {
		expect(rateToText(18_200)).toBe("1,82");
		expect(rateToText(2917)).toBe("0,2917");
		expect(rateToText(18_250)).toBe("1,825");
		expect(rateToText(34_500)).toBe("3,45");
		expect(rateToText(31_000)).toBe("3,10");
		expect(rateToText(30_000)).toBe("3,00");
		expect(rateToText(0)).toBe("0,00");
		expect(rateToText(1_000_000)).toBe("100,00");
	});
});

describe("formatRate", () => {
	it("shows Sure's three decimals, a non-breaking space before the percent sign", () => {
		expect(formatRate(18_200)).toBe("1,820 %");
		expect(formatRate(31_250)).toBe("3,125 %");
		expect(formatRate(1_000_000)).toBe("100,000 %");
	});
});

describe("termOf", () => {
	it("names whole years, and months when years are not whole", () => {
		expect(termOf(300)).toEqual({ unit: "years", count: 25 });
		expect(termOf(12)).toEqual({ unit: "years", count: 1 });
		expect(termOf(30)).toEqual({ unit: "months", count: 30 });
		expect(termOf(1)).toEqual({ unit: "months", count: 1 });
	});
});

describe("proposedTerm", () => {
	it("counts whole calendar months, days ignored, within 1 to 1 200", () => {
		expect(proposedTerm("2020-12-05", "2045-12-05")).toBe(300);
		expect(proposedTerm("2020-12-31", "2021-01-01")).toBe(1);
		expect(proposedTerm("2020-12-05", "2020-12-20")).toBe(1);
		expect(proposedTerm("2020-12-05", "2019-01-01")).toBe(1);
		expect(proposedTerm("1950-01-01", "2150-01-01")).toBe(1200);
	});
});

describe("loanDetailsToInput", () => {
	it("fills the fields from the stored terms, blank where unknown", () => {
		expect(
			loanDetailsToInput(
				{
					...unknownTerms,
					originalAmount: toMinorUnits(13_000_000),
					downPayment: toMinorUnits(0),
					startDate: "2020-12-05",
					termMonths: 300,
					rateType: "variable",
					interestRate: 18_200,
					insuranceRate: 2917,
					insuranceRateType: "level_term",
					rateChanges: [{ effectiveDate: "2024-01-05", rate: 25_000 }],
				},
				"EUR",
				"2026-01-01",
			),
		).toEqual({
			originalAmount: "130000,00",
			downPayment: "0,00",
			startDate: "2020-12-05",
			termMonths: "300",
			rateType: "variable",
			interestRate: "1,82",
			insuranceRate: "0,2917",
			insuranceRateType: "level_term",
			rateChanges: [{ effectiveDate: "2024-01-05", rate: "2,50" }],
		});
		expect(loanDetailsToInput(null, "EUR", "2026-01-01")).toEqual(completeLoanInput(undefined));
		expect(loanDetailsToInput(unknownTerms, "EUR", "2026-01-01")).toEqual(
			completeLoanInput(undefined),
		);
	});

	it("proposes a migrated loan's term from its opening date to its end date", () => {
		const migrated = { ...unknownTerms, interestRate: 34_500, endDate: "2045-12-05" };

		expect(loanDetailsToInput(migrated, "EUR", "2020-12-05")).toMatchObject({
			termMonths: "300",
			interestRate: "3,45",
		});
		expect(
			loanDetailsToInput({ ...migrated, startDate: "2025-12-05" }, "EUR", "2020-12-05"),
		).toMatchObject({ termMonths: "240" });
		expect(loanDetailsToInput({ ...migrated, termMonths: 120 }, "EUR", "2020-12-05")).toMatchObject(
			{ termMonths: "120" },
		);
	});
});
