import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { interpretCreditCardBalance } from "./credit-card-balance.ts";

const m = toMinorUnits;
const on = (creditLimit: number | null) => ({
	creditLimit: creditLimit === null ? null : m(creditLimit),
	treatBalanceAsAvailableCredit: true,
});
const off = (creditLimit: number | null) => ({
	creditLimit: creditLimit === null ? null : m(creditLimit),
	treatBalanceAsAvailableCredit: false,
});

describe("interpretCreditCardBalance", () => {
	it("takes the debt as the bank limit less the reported credit, toggle on", () => {
		expect(interpretCreditCardBalance(m(90000), on(100000), null)).toEqual({
			balance: 10000,
			availableCredit: 100000,
		});
	});

	it("prefers the bank limit to a typed « Crédit disponible », toggle on", () => {
		expect(interpretCreditCardBalance(m(90000), on(100000), m(300000))).toEqual({
			balance: 10000,
			availableCredit: 100000,
		});
	});

	it("floors an overpaid card's debt at zero, toggle on", () => {
		expect(interpretCreditCardBalance(m(105000), on(100000), null)).toEqual({
			balance: 0,
			availableCredit: 100000,
		});
	});

	it("falls back on « Crédit disponible » without a bank limit, toggle on", () => {
		expect(interpretCreditCardBalance(m(90000), on(null), m(100000))).toEqual({
			balance: 10000,
			availableCredit: 100000,
		});
	});

	it("writes no balance and clears « Crédit disponible » without any limit, toggle on", () => {
		expect(interpretCreditCardBalance(m(90000), on(null), null)).toEqual({
			balance: null,
			availableCredit: null,
		});
		expect(interpretCreditCardBalance(m(90000), on(null), m(0))).toEqual({
			balance: null,
			availableCredit: null,
		});
	});

	it("keeps the reported debt and refreshes the credit left from a bank limit, toggle off", () => {
		expect(interpretCreditCardBalance(m(10000), off(100000), m(300000))).toEqual({
			balance: 10000,
			availableCredit: 90000,
		});
		expect(interpretCreditCardBalance(m(150000), off(100000), null)).toEqual({
			balance: 150000,
			availableCredit: 0,
		});
	});

	it("keeps « Crédit disponible » without a bank limit, toggle off", () => {
		expect(interpretCreditCardBalance(m(10000), off(null), m(300000))).toEqual({
			balance: 10000,
			availableCredit: 300000,
		});
		expect(interpretCreditCardBalance(m(10000), off(null), m(0))).toEqual({
			balance: 10000,
			availableCredit: 0,
		});
	});

	it("counts a bank limit of zero or less as none", () => {
		expect(interpretCreditCardBalance(m(10000), off(0), m(300000))).toEqual({
			balance: 10000,
			availableCredit: 300000,
		});
		expect(interpretCreditCardBalance(m(90000), on(-5), m(100000))).toEqual({
			balance: 10000,
			availableCredit: 100000,
		});
	});

	it("reads no bank side as the toggle off without a limit", () => {
		expect(interpretCreditCardBalance(m(10000), undefined, m(300000))).toEqual({
			balance: 10000,
			availableCredit: 300000,
		});
	});
});
