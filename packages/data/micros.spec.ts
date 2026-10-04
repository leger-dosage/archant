import { describe, expect, it } from "vitest";

import { divideHalfEven, formatMicros, parseMicros, readMicros, toMicros } from "./micros.ts";

describe("divideHalfEven", () => {
	it.each([
		[10n, 5n, 2n],
		[7n, 2n, 4n],
		[5n, 2n, 2n],
		[11n, 4n, 3n],
		[9n, 4n, 2n],
		[-5n, 2n, -2n],
		[-7n, 2n, -4n],
		[7n, -2n, -4n],
		[-7n, -2n, 4n],
		[-1n, 3n, 0n],
		[0n, 3n, 0n],
	])("rounds %i / %i to %i", (numerator, denominator, expected) => {
		expect(divideHalfEven(numerator, denominator)).toBe(expected);
	});

	it("refuses a zero denominator", () => {
		expect(() => divideHalfEven(1n, 0n)).toThrow(RangeError);
	});
});

describe("parseMicros", () => {
	it.each([
		["12", 12_000_000],
		["12.5", 12_500_000],
		["0.000001", 1],
		["123.456789", 123_456_789],
		["-0.5", -500_000],
		["0", 0],
		// Beyond six decimals, half to even: the tie goes to the even millionth.
		["0.0000005", 0],
		["0.0000015", 2],
		["0.00000151", 2],
		["0.0000025", 2],
		["123.45000457763672", 123_450_005],
		["-1.0000005", -1_000_000],
	])("reads %j as %i millionths", (text, expected) => {
		expect(parseMicros(text)).toBe(expected);
	});

	it("never returns negative zero", () => {
		expect(Object.is(parseMicros("-0.0000001"), 0)).toBe(true);
		expect(Object.is(parseMicros("-0"), 0)).toBe(true);
	});

	it("accepts the largest safe value and refuses one millionth more", () => {
		expect(parseMicros("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER);
		expect(parseMicros("-9007199254.740991")).toBe(-Number.MAX_SAFE_INTEGER);
		expect(parseMicros("9007199254.740992")).toBeNull();
	});

	it.each(["", "abc", "1,5", "1e-7", "1.5e+21", "+1", ".5", "1.", " 1", "1 000", "NaN"])(
		"refuses %j",
		(text) => {
			expect(parseMicros(text)).toBeNull();
		},
	);
});

describe("toMicros", () => {
	it("brands a safe integer, never as negative zero", () => {
		expect(toMicros(612_400_024)).toBe(612_400_024);
		expect(Object.is(toMicros(-0), 0)).toBe(true);
	});

	it.each([0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("refuses %d", (value) => {
		expect(() => toMicros(value)).toThrow(RangeError);
	});
});

describe("readMicros", () => {
	it.each([
		["10", 10_000_000],
		["612,40", 612_400_000],
		["612.4", 612_400_000],
		["0,333335", 333_335],
		["1 234,5", 1_234_500_000],
		["1\u00A0234,5", 1_234_500_000],
		["1\u202F234", 1_234_000_000],
		[" 2,5 ", 2_500_000],
		["-4", -4_000_000],
		["−0,5", -500_000],
		["0", 0],
		["9007199254,740991", Number.MAX_SAFE_INTEGER],
	])("reads %j as %i millionths", (text, expected) => {
		expect(readMicros(text)).toBe(expected);
	});

	it("never returns negative zero", () => {
		expect(Object.is(readMicros("-0,000"), 0)).toBe(true);
	});

	it.each([
		"",
		"abc",
		"1,2345678",
		"1e3",
		"+1",
		",5",
		"1.",
		"1 00",
		"12 3456",
		"9007199254,740992",
	])("refuses %j", (text) => {
		expect(readMicros(text)).toBeNull();
	});
});

describe("formatMicros", () => {
	it.each([
		[612_400_000, "612.4"],
		[10_000_000, "10"],
		[-4_000_000, "-4"],
		[1, "0.000001"],
		[-500_000, "-0.5"],
		[0, "0"],
		[333_335, "0.333335"],
		[Number.MAX_SAFE_INTEGER, "9007199254.740991"],
	])("writes %i millionths as %j, which reads back", (value, expected) => {
		const micros = toMicros(value);

		expect(formatMicros(micros)).toBe(expected);
		expect(parseMicros(formatMicros(micros))).toBe(value);
	});
});
