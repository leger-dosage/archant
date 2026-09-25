import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { showsCategory, transferCaption } from "./transfers";

const transfer = { counterpartAccountName: "Livret A" };

describe("transferCaption", () => {
	it("points the outflow to the other account and the inflow from it", () => {
		expect(transferCaption({ amount: toMinorUnits(-50000), transfer })).toEqual({
			key: "transactions.transfer.to",
			account: "Livret A",
		});
		expect(transferCaption({ amount: toMinorUnits(50000), transfer })).toEqual({
			key: "transactions.transfer.from",
			account: "Livret A",
		});
	});

	it("has nothing to say about a standard transaction", () => {
		expect(transferCaption({ amount: toMinorUnits(-50000), transfer: null })).toBeNull();
	});
});

describe("showsCategory", () => {
	it("shows the category of a standard transaction, spent or earned", () => {
		expect(showsCategory(toMinorUnits(-50000), null)).toBe(true);
		expect(showsCategory(toMinorUnits(50000), null)).toBe(true);
	});

	it.each([
		["internal_move", false, false],
		["credit_card_payment", false, false],
		["loan_payment", true, false],
		["investment_contribution", true, false],
	] as const)(
		"on a %s, shows it on the outflow: %s, on the inflow: %s",
		(kind, outflow, inflow) => {
			expect(showsCategory(toMinorUnits(-50000), { kind })).toBe(outflow);
			expect(showsCategory(toMinorUnits(50000), { kind })).toBe(inflow);
		},
	);
});
