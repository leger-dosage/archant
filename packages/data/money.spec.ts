import { describe, expect, it } from "vitest";

import {
	CURRENCY_CODES,
	compareWithDecimal,
	formatMoney,
	isCurrencyCode,
	isDecimalString,
	MAX_MINOR_UNITS,
	minorUnitsOf,
	parseAmount,
	parseDecimalAmount,
	parseUnsignedDecimal,
	toDecimalString,
	toMinorUnits,
	toPlainDecimal,
} from "./money.ts";

const NNBSP = " ";
const NBSP = " ";
const MINUS = "−";

describe("parseAmount", () => {
	it.each([
		["1234,56", "EUR", 123456],
		["1 234,56", "EUR", 123456],
		[`1${NBSP}234,56`, "EUR", 123456],
		[`1${NNBSP}234,56`, "EUR", 123456],
		["-42,90", "EUR", -4290],
		[`${MINUS}42,90`, "EUR", -4290],
		["42.90", "EUR", 4290],
		["  42,9  ", "EUR", 4290],
		["42", "EUR", 4200],
		["0", "EUR", 0],
		["-0,00", "EUR", 0],
		["1 234 567,89", "EUR", 123456789],
		["1234", "JPY", 1234],
		["1 234", "JPY", 1234],
		["1,234", "KWD", 1234],
		["10.00", "USD", 1000],
	])("reads %j in %s as %i minor units", (text, currency, expected) => {
		expect(parseAmount(text, currency)).toBe(expected);
	});

	it("accepts up to MAX_MINOR_UNITS and refuses one more, so totals cannot overflow", () => {
		expect(parseAmount("100000000000", "EUR")).toBe(MAX_MINOR_UNITS);
		expect(parseAmount("-100000000000", "EUR")).toBe(-MAX_MINOR_UNITS);
		expect(parseAmount("100000000000,01", "EUR")).toBeNull();
		expect(parseAmount("10000000000001", "JPY")).toBeNull();
	});

	it("never returns negative zero", () => {
		expect(Object.is(parseAmount("-0", "EUR"), 0)).toBe(true);
	});

	it.each([
		["12,3,4", "EUR"],
		["1,234", "EUR"],
		["1,234", "JPY"],
		["1.5", "JPY"],
		["1,2345", "KWD"],
		["", "EUR"],
		["   ", "EUR"],
		["abc", "EUR"],
		["+42", "EUR"],
		["--42", "EUR"],
		["42,", "EUR"],
		[",5", "EUR"],
		["1.234,56", "EUR"],
		["12 34,56", "EUR"],
		["1  234", "EUR"],
		["1e3", "EUR"],
		["42 €", "EUR"],
		["99999999999999999", "EUR"],
		["42", "XYZ"],
	])("rejects %j in %s", (text, currency) => {
		expect(parseAmount(text, currency)).toBeNull();
	});
});

describe("parseDecimalAmount", () => {
	it.each([
		["12.5", "EUR", 1250],
		["-12.50", "EUR", -1250],
		["0", "EUR", 0],
		["1234", "JPY", 1234],
		["1.234", "KWD", 1234],
		// Half away from zero beyond the currency's decimals, read from the digits.
		["0.125", "EUR", 13],
		["0.135", "EUR", 14],
		["0.1250000001", "EUR", 13],
		["-0.125", "EUR", -13],
		["0.12499999999999999999", "EUR", 12],
		["2.5", "JPY", 3],
		["-2.5", "JPY", -3],
		["3.4", "JPY", 3],
		["100000000000", "EUR", MAX_MINOR_UNITS],
	])("reads %j in %s as %i minor units", (text, currency, expected) => {
		expect(parseDecimalAmount(text, currency)).toBe(expected);
	});

	it("never returns negative zero", () => {
		expect(Object.is(parseDecimalAmount("-0.001", "EUR"), 0)).toBe(true);
	});

	it.each([
		["", "EUR"],
		["abc", "EUR"],
		["1e3", "EUR"],
		["+1", "EUR"],
		["1 234.56", "EUR"],
		["1,5", "EUR"],
		[".5", "EUR"],
		["100000000000.01", "EUR"],
		["12", "XYZ"],
	])("refuses %j in %s", (text, currency) => {
		expect(parseDecimalAmount(text, currency)).toBeNull();
	});
});

describe("toDecimalString", () => {
	it.each([
		[-1250, "EUR", "-12.50"],
		[0, "EUR", "0.00"],
		[7, "EUR", "0.07"],
		[1234, "JPY", "1234"],
		[-5, "KWD", "-0.005"],
		[-1234, "ABC", "-12.34"],
	])("writes %i %s as %j", (amount, currency, expected) => {
		expect(toDecimalString({ amount: toMinorUnits(amount), currency })).toBe(expected);
	});

	it("refuses an amount that skipped toMinorUnits", () => {
		const money = { amount: toMinorUnits(15), currency: "EUR" };
		Reflect.set(money, "amount", 1.5);

		expect(() => toDecimalString(money)).toThrow(RangeError);
	});
});

describe("formatMoney", () => {
	it("formats euros the French way, with narrow no-break spaces", () => {
		expect(formatMoney({ amount: toMinorUnits(123456), currency: "EUR" })).toBe(
			`1${NNBSP}234,56${NBSP}€`,
		);
	});

	it("uses a true minus sign", () => {
		expect(formatMoney({ amount: toMinorUnits(-4290), currency: "EUR" })).toBe(
			`${MINUS}42,90${NBSP}€`,
		);
	});

	it("names the dollar it means", () => {
		expect(formatMoney({ amount: toMinorUnits(1000), currency: "USD" })).toBe(`10,00${NBSP}$US`);
	});

	it("follows the currency's minor units", () => {
		expect(formatMoney({ amount: toMinorUnits(1234), currency: "JPY" })).toBe(
			`1${NNBSP}234${NBSP}JPY`,
		);
		expect(formatMoney({ amount: toMinorUnits(-5), currency: "KWD" })).toBe(
			`${MINUS}0,005${NBSP}KWD`,
		);
	});

	it("formats small amounts without losing the leading zero", () => {
		expect(formatMoney({ amount: toMinorUnits(7), currency: "EUR" })).toBe(`0,07${NBSP}€`);
	});

	it("keeps two decimals for a code outside ISO 4217", () => {
		expect(formatMoney({ amount: toMinorUnits(-1234), currency: "ABC" })).toBe(
			`${MINUS}12,34${NBSP}ABC`,
		);
	});

	it("refuses an amount that skipped toMinorUnits", () => {
		const money = { amount: toMinorUnits(15), currency: "EUR" };
		// What a value read past the brand would hold, such as a float from JSON.
		Reflect.set(money, "amount", 1.5);

		expect(() => formatMoney(money)).toThrow(RangeError);
	});

	it("honours another locale", () => {
		expect(formatMoney({ amount: toMinorUnits(123456), currency: "EUR" }, "en-US")).toBe(
			"€1,234.56",
		);
	});
});

describe("toMinorUnits", () => {
	it("refuses a fraction, which would be a float in disguise", () => {
		expect(() => toMinorUnits(1.5)).toThrow(RangeError);
	});

	it("refuses an integer beyond exact float range", () => {
		expect(() => toMinorUnits(2 ** 53)).toThrow(RangeError);
	});
});

describe("currencies", () => {
	it("recognises ISO 4217 codes only", () => {
		expect(isCurrencyCode("EUR")).toBe(true);
		expect(isCurrencyCode("eur")).toBe(false);
		expect(isCurrencyCode("XYZ")).toBe(false);
		expect(isCurrencyCode("toString")).toBe(false);
	});

	it("knows the minor units of each currency", () => {
		expect(minorUnitsOf("EUR")).toBe(2);
		expect(minorUnitsOf("JPY")).toBe(0);
		expect(minorUnitsOf("TND")).toBe(3);
	});

	it("lists codes in alphabetical order for the currency picker", () => {
		expect(CURRENCY_CODES).toEqual(CURRENCY_CODES.toSorted());
		expect(CURRENCY_CODES).toContain("EUR");
	});
});

describe("isDecimalString", () => {
	it.each(["0", "12", "-12", "12.5", "-0.001"])("accepts %s", (value) => {
		expect(isDecimalString(value)).toBe(true);
	});

	it.each(["", "12,5", "1e3", ".5", "12.", "+1", " 1", "abc"])("refuses %j", (value) => {
		expect(isDecimalString(value)).toBe(false);
	});
});

describe("parseUnsignedDecimal", () => {
	it.each([
		["50", { units: 50n, exponent: 0 }],
		[" 12.5 ", { units: 125n, exponent: 1 }],
		["12,50", { units: 1250n, exponent: 2 }],
		["0.001", { units: 1n, exponent: 3 }],
	])("reads %j from its digits", (text, expected) => {
		expect(parseUnsignedDecimal(text)).toEqual(expected);
	});

	it.each(["", "-5", "+5", "1e3", "1 000", "12.", ".5", "1.2.3", "abc"])("refuses %j", (text) => {
		expect(parseUnsignedDecimal(text)).toBeNull();
	});
});

describe("toPlainDecimal", () => {
	it.each([
		["50", "50"],
		["12,50", "12.50"],
		["007.5", "7.5"],
		["0.05", "0.05"],
		["0", "0"],
	])("writes %j as %j", (text, expected) => {
		const decimal = parseUnsignedDecimal(text);

		expect(decimal === null ? null : toPlainDecimal(decimal)).toBe(expected);
	});
});

const order = (amount: number, currency: string, text: string) => {
	const decimal = parseUnsignedDecimal(text);

	if (decimal === null) {
		throw new Error(text);
	}

	return compareWithDecimal({ amount: toMinorUnits(amount), currency }, decimal);
};

describe("compareWithDecimal", () => {
	it("scales both sides to the larger exponent, rounding neither", () => {
		expect(order(1235, "EUR", "12.345")).toBeGreaterThan(0);
		expect(order(1234, "EUR", "12.345")).toBeLessThan(0);
		expect(order(1250, "EUR", "12.5")).toBe(0);
		expect(order(50, "JPY", "50")).toBe(0);
		expect(order(50, "JPY", "50.5")).toBeLessThan(0);
		expect(order(12_345, "KWD", "12.345")).toBe(0);
		expect(order(5000, "XXX", "50")).toBe(0);
	});
});
