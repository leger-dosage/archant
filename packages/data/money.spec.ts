import { describe, expect, it } from "vitest";

import {
	CURRENCY_CODES,
	formatMoney,
	isCurrencyCode,
	MAX_MINOR_UNITS,
	minorUnitsOf,
	parseAmount,
	toMinorUnits,
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
