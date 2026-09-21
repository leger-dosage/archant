import { describe, expect, it } from "vitest";

import { compareAmountBounds, parseAmountBound } from "./transactions.ts";

describe("parseAmountBound", () => {
	it.each([
		["42,90", { units: 4290n, scale: 2 }],
		["42.90", { units: 4290n, scale: 2 }],
		["20", { units: 20n, scale: 0 }],
		["0,005", { units: 5n, scale: 3 }],
		[" 50 ", { units: 50n, scale: 0 }],
		["1 234,56", { units: 123456n, scale: 2 }],
		["1 234,56", { units: 123456n, scale: 2 }],
		["1 234 567.8", { units: 12345678n, scale: 1 }],
		["999999999999999", { units: 999999999999999n, scale: 0 }],
		["1,0123456789", { units: 10123456789n, scale: 10 }],
	])("reads %j exactly", (text, expected) => {
		expect(parseAmountBound(text)).toEqual(expected);
	});

	it.each([
		["42,"],
		[",5"],
		["-5"],
		["+5"],
		["−5"],
		["abc"],
		[""],
		["12 34"],
		["1 234 5"],
		["42,90,1"],
		// Sixteen integer digits, eleven decimals: past any amount or currency.
		["1234567890123456"],
		["1,01234567890"],
	])("refuses %j", (text) => {
		expect(parseAmountBound(text)).toBeNull();
	});
});

describe("compareAmountBounds", () => {
	it("compares values written with different numbers of decimals", () => {
		expect(compareAmountBounds({ units: 429n, scale: 1 }, { units: 4290n, scale: 2 })).toBe(0);
		expect(compareAmountBounds({ units: 429n, scale: 1 }, { units: 43n, scale: 0 })).toBe(-1);
		expect(compareAmountBounds({ units: 43n, scale: 0 }, { units: 42999n, scale: 3 })).toBe(1);
		expect(compareAmountBounds({ units: 60n, scale: 0 }, { units: 5000n, scale: 2 })).toBe(1);
	});
});
