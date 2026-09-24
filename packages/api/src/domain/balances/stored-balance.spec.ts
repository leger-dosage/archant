import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { toStoredBalance, toStoredBankBalance } from "./stored-balance.ts";

const m = toMinorUnits;

describe("toStoredBalance", () => {
	it("keeps an asset's statement balance as it is", () => {
		expect(toStoredBalance({ type: "depository" }, m(240861))).toBe(240861);
		expect(toStoredBalance({ type: "depository" }, m(-5000))).toBe(-5000);
	});

	it("turns a card's negative statement balance into a positive amount owed", () => {
		expect(toStoredBalance({ type: "credit_card" }, m(-51230))).toBe(51230);
		// A positive card balance is a credit, per the OFX specification.
		expect(toStoredBalance({ type: "credit_card" }, m(1500))).toBe(-1500);
	});

	it("gives zero, never a signed zero", () => {
		expect(Object.is(toStoredBalance({ type: "credit_card" }, m(0)), 0)).toBe(true);
		expect(Object.is(toStoredBalance({ type: "depository" }, m(0)), 0)).toBe(true);
	});
});

describe("toStoredBankBalance", () => {
	it("keeps an asset's bank balance signed", () => {
		expect(toStoredBankBalance({ type: "depository" }, m(123456))).toBe(123456);
		expect(toStoredBankBalance({ type: "depository" }, m(-5000))).toBe(-5000);
	});

	it("owes a liability's bank balance whichever its sign", () => {
		expect(toStoredBankBalance({ type: "credit_card" }, m(-30000))).toBe(30000);
		expect(toStoredBankBalance({ type: "loan" }, m(15000000))).toBe(15000000);
	});
});
