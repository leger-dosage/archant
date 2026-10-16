import { describe, expect, it } from "vitest";

import {
	QUANTITY_UNIT,
	TRADE_PRICE_UNIT,
	formatQuantity,
	formatTradePrice,
	isQuantity,
	isTradePrice,
	parseQuantity,
	parseTradePrice,
	readQuantity,
	readTradePrice,
	scaledQuantity,
	scaledTradePrice,
	tradePriceToMicros,
} from "./decimals.ts";

/** A plain decimal read as a trade price, in millionths. */
const micros = (text: string) => tradePriceToMicros(parseTradePrice(text) ?? formatTradePrice(0n));

describe("parseQuantity", () => {
	it.each([
		["0.000166666666666667", "0.000166666666666667"],
		["12345.123456789012345678", "12345.123456789012345678"],
		["1.50", "1.5"],
		["007", "7"],
		["-4", "-4"],
		["-0", "0"],
		["0.000", "0"],
		["9999999999999999.999999999999999999", "9999999999999999.999999999999999999"],
	])("reads %s as %s", (text, expected) => {
		expect(parseQuantity(text)).toBe(expected);
	});

	it.each(["0.0000000000000000001", "10000000000000000", "1e-18", "+1", "1,5", "1 000", ".5", ""])(
		"refuses %j",
		(text) => {
			expect(parseQuantity(text)).toBeNull();
		},
	);
});

describe("readQuantity", () => {
	it.each([
		["0,000166666666666667", "0.000166666666666667"],
		["1 234,5", "1234.5"],
		["1 234,5", "1234.5"],
		["1234.50", "1234.5"],
		["  2  ", "2"],
		["−3", "-3"],
	])("reads %j as %s", (text, expected) => {
		expect(readQuantity(text)).toBe(expected);
	});

	it.each(["0,0000000000000000001", "12345678901234567", "1.2.3", "abc"])(
		"refuses %j: one decimal more is refused, never rounded",
		(text) => {
			expect(readQuantity(text)).toBeNull();
		},
	);
});

describe("trade prices", () => {
	it("reads ten decimals and nine integer digits, an eleventh decimal or a tenth digit refused", () => {
		expect(parseTradePrice("60000")).toBe("60000");
		expect(parseTradePrice("0.0000000001")).toBe("0.0000000001");
		expect(parseTradePrice("0.00000000001")).toBeNull();
		expect(parseTradePrice("1000000000")).toBeNull();
		expect(parseTradePrice("x")).toBeNull();
		expect(readTradePrice("612,4")).toBe("612.4");
		expect(readTradePrice("0,12345678901")).toBeNull();
		expect(readTradePrice("x")).toBeNull();
	});

	it("scales a price by 10¹⁰ and back", () => {
		const price = parseTradePrice("612.4");

		expect(price).not.toBeNull();
		expect(scaledTradePrice(price ?? formatTradePrice(0n))).toBe(6_124_000_000_000n);
		expect(formatTradePrice(6_124_000_000_000n)).toBe("612.4");
		expect(formatTradePrice(0n)).toBe("0");
		expect(TRADE_PRICE_UNIT).toBe(10_000_000_000n);
		expect(() => formatTradePrice(10n ** 19n)).toThrow(RangeError);
	});

	it("rounds a trade price half to even to the millionth, as holdings keep it", () => {
		expect(micros("612.4")).toBe(612_400_000);
		expect(micros("0.0000005")).toBe(0);
		expect(micros("0.0000015")).toBe(2);
		expect(micros("0.0000015001")).toBe(2);
	});

	it("tells its canonical form", () => {
		expect(isTradePrice("612.4")).toBe(true);
		expect(isTradePrice("612.40")).toBe(false);
	});
});

describe("quantities scaled", () => {
	it("scales by 10¹⁸, signed, and formats back to the canonical text", () => {
		expect(QUANTITY_UNIT).toBe(10n ** 18n);
		expect(scaledQuantity(formatQuantity(-1_500_000_000_000_000_000n))).toBe(
			-1_500_000_000_000_000_000n,
		);
		expect(formatQuantity(-1_500_000_000_000_000_000n)).toBe("-1.5");
		expect(formatQuantity(166_666_666_666_667n)).toBe("0.000166666666666667");
		expect(formatQuantity(0n)).toBe("0");
		expect(scaledQuantity(formatQuantity(7n * QUANTITY_UNIT))).toBe(7n * QUANTITY_UNIT);
	});

	it("refuses a value past sixteen integer digits", () => {
		expect(() => formatQuantity(10n ** 34n)).toThrow(RangeError);
		expect(() => formatQuantity(-(10n ** 34n))).toThrow(RangeError);
	});

	it("tells its canonical form: no exponent, no plus, no leading or trailing zero, no signed zero", () => {
		expect(isQuantity("1.5")).toBe(true);
		expect(isQuantity("-1.5")).toBe(true);
		expect(isQuantity("0")).toBe(true);
		for (const text of ["1.50", "01.5", "-0", "+1", "1e3", "1.", ""]) {
			expect(isQuantity(text)).toBe(false);
		}
	});
});
