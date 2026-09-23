import { describe, expect, it } from "vitest";

import {
	MAX_MERCHANT_FILTER,
	compareAmountBounds,
	parseAmountBound,
	transactionFilterSchema,
	updateTransactionSchema,
} from "./transactions.ts";

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

describe("transactionFilterSchema", () => {
	it("reads a lone category as a list, and repeated ones in order", () => {
		expect(transactionFilterSchema.parse({ category: "none" }).category).toEqual(["none"]);
		expect(transactionFilterSchema.parse({ category: ["c1", "none"] }).category).toEqual([
			"c1",
			"none",
		]);
		expect(transactionFilterSchema.parse({}).category).toBeUndefined();
	});

	it("reads a lone merchant as a list, and repeated ones in order", () => {
		expect(transactionFilterSchema.parse({ merchant: "m1" }).merchant).toEqual(["m1"]);
		expect(transactionFilterSchema.parse({ merchant: ["m1", "m2"] }).merchant).toEqual([
			"m1",
			"m2",
		]);
		expect(transactionFilterSchema.parse({}).merchant).toBeUndefined();
	});

	it("refuses more merchants than the cap", () => {
		const merchant = Array.from({ length: MAX_MERCHANT_FILTER + 1 }, (_, index) => `m${index}`);

		expect(transactionFilterSchema.safeParse({ merchant }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ merchant: merchant.slice(1) }).success).toBe(true);
	});

	it("refuses an empty account, category or merchant rather than matching nothing", () => {
		expect(transactionFilterSchema.safeParse({ category: "" }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ merchant: ["m1", ""] }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ account: ["a1", ""] }).success).toBe(false);
	});
});

describe("updateTransactionSchema", () => {
	it("keeps a category id, a cleared category, and no category at all apart", () => {
		const schema = updateTransactionSchema("EUR");

		expect(schema.parse({ categoryId: "c1" })).toEqual({ categoryId: "c1" });
		expect(schema.parse({ categoryId: null })).toEqual({ categoryId: null });
		expect(schema.parse({})).toEqual({});
		expect(schema.safeParse({ categoryId: "" }).success).toBe(false);
	});

	it("keeps a merchant id, a cleared merchant, and no merchant at all apart", () => {
		const schema = updateTransactionSchema("EUR");

		expect(schema.parse({ merchantId: "m1" })).toEqual({ merchantId: "m1" });
		expect(schema.parse({ merchantId: null })).toEqual({ merchantId: null });
		expect(schema.safeParse({ merchantId: "" }).success).toBe(false);
	});
});
