import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { formatRate, loanDetailsToInput, rateToText } from "./loan-details.ts";

describe("rateToText", () => {
	it("writes basis points back as the percentage typed", () => {
		expect(rateToText(345)).toBe("3,45");
		expect(rateToText(310)).toBe("3,10");
		expect(rateToText(305)).toBe("3,05");
		expect(rateToText(300)).toBe("3,00");
		expect(rateToText(0)).toBe("0,00");
		expect(rateToText(10_000)).toBe("100,00");
	});

	it("puts a non-breaking space before the percent sign", () => {
		expect(formatRate(345)).toBe("3,45 %");
	});
});

describe("loanDetailsToInput", () => {
	it("fills the fields from the stored details, blank where unknown", () => {
		expect(
			loanDetailsToInput(
				{ originalAmount: toMinorUnits(20_000_000), interestRate: 345, endDate: null },
				"EUR",
			),
		).toEqual({ originalAmount: "200000,00", interestRate: "3,45", endDate: "" });
		expect(loanDetailsToInput(null, "EUR")).toEqual({
			originalAmount: "",
			interestRate: "",
			endDate: "",
		});
	});
});
