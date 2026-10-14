import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { completeCreditCardInput, creditCardDetailsToInput } from "./credit-card-details.ts";

describe("completeCreditCardInput", () => {
	it("blanks every missing field and drops a loan's", () => {
		const typed = { apr: "15,99", interestRate: "3" };

		expect(completeCreditCardInput(typed)).toEqual({
			availableCredit: "",
			minimumPayment: "",
			apr: "15,99",
			expirationDate: "",
			annualFee: "",
		});
	});
});

describe("creditCardDetailsToInput", () => {
	it("writes stored details back as typed, in the account's currency", () => {
		expect(
			creditCardDetailsToInput(
				{
					availableCredit: toMinorUnits(300000),
					minimumPayment: toMinorUnits(2550),
					apr: 159900,
					expirationDate: "2028-04-30",
					annualFee: null,
				},
				"EUR",
			),
		).toEqual({
			availableCredit: "3000,00",
			minimumPayment: "25,50",
			apr: "15,99",
			expirationDate: "2028-04-30",
			annualFee: "",
		});
	});

	it("leaves a card saved before it had details blank", () => {
		expect(creditCardDetailsToInput(null, "EUR")).toEqual(completeCreditCardInput(undefined));
	});
});
