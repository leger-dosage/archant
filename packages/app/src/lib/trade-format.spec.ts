import { describe, expect, it } from "vitest";

import { decimalToText, formatPrice, formatQuantity, formatShare } from "./trade-format";

// `Intl` separates thousands and the currency with narrow and plain no-break spaces.
const spaced = (text: string) => text.replaceAll(/[  ]/gu, " ");

describe("formatQuantity", () => {
	it.each([
		["10", "10"],
		["2.5", "2,5"],
		["0.000001", "0,000001"],
		["1234.5", "1 234,5"],
		["abc", "abc"],
	])("shows %j as %j", (quantity, expected) => {
		expect(spaced(formatQuantity(quantity))).toBe(expected);
	});
});

describe("formatPrice", () => {
	it.each([
		["612.4", "EUR", "612,40 €"],
		["0.333335", "EUR", "0,333335 €"],
		["1500", "JPY", "1 500 JPY"],
		["1.5", "XXX", "1,50 ¤"],
		["abc", "EUR", "abc"],
	])("shows %j in %s as %j", (price, currency, expected) => {
		expect(spaced(formatPrice(price, currency))).toBe(expected);
	});
});

describe("decimalToText", () => {
	it("writes the decimal comma the form reads", () => {
		expect(decimalToText("612.4")).toBe("612,4");
		expect(decimalToText("10")).toBe("10");
	});
});

describe("formatShare", () => {
	it("writes a percentage with one decimal, a negative one with a true minus", () => {
		expect(spaced(formatShare("60"))).toBe("60,0 %");
		expect(spaced(formatShare("33.333333"))).toBe("33,3 %");
		expect(spaced(formatShare("-2.5"))).toBe("−2,5 %");
		expect(formatShare("n/a")).toBe("n/a");
	});
});
