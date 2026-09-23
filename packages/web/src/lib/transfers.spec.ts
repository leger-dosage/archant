import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { transferCaption } from "./transfers";

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
