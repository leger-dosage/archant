import { describe, expect, it } from "vitest";

import { MAX_MINOR_UNITS } from "@archant/data/money";

import { amountBoundsFor, escapeLike } from "./transaction-filter.ts";

const decimal = (units: bigint, scale: number) => ({ units, scale });

describe("amountBoundsFor", () => {
	it("scales whole and decimal bounds to minor units", () => {
		expect(amountBoundsFor(decimal(20n, 0), decimal(429n, 1), "EUR")).toEqual({
			min: 2000,
			max: 4290,
		});
	});

	it("leaves an absent bound open", () => {
		expect(amountBoundsFor(decimal(40n, 0), undefined, "EUR")).toEqual({ min: 4000, max: null });
		expect(amountBoundsFor(undefined, decimal(50n, 0), "EUR")).toEqual({ min: null, max: 5000 });
		expect(amountBoundsFor(undefined, undefined, "EUR")).toEqual({ min: null, max: null });
	});

	it("rounds a bound finer than the minor unit inward", () => {
		// 10,005 to 20,009 euros: the cents between them are 10,01 to 20,00.
		expect(amountBoundsFor(decimal(10005n, 3), decimal(20009n, 3), "EUR")).toEqual({
			min: 1001,
			max: 2000,
		});
	});

	it("keeps an exact bound written with more decimals than needed", () => {
		expect(amountBoundsFor(decimal(10000n, 3), decimal(20000n, 3), "EUR")).toEqual({
			min: 1000,
			max: 2000,
		});
	});

	it("scales per currency: a yen has no decimals, a dinar three", () => {
		expect(amountBoundsFor(decimal(125n, 1), decimal(125n, 1), "JPY")).toBeNull();
		expect(amountBoundsFor(decimal(125n, 1), decimal(13n, 0), "JPY")).toEqual({
			min: 13,
			max: 13,
		});
		expect(amountBoundsFor(decimal(125n, 1), undefined, "KWD")).toEqual({
			min: 12500,
			max: null,
		});
	});

	it("is null when no minor unit fits between the bounds", () => {
		expect(amountBoundsFor(decimal(5n, 3), decimal(9n, 3), "EUR")).toBeNull();
	});

	it("is null when the lower bound is past every storable amount", () => {
		expect(amountBoundsFor(decimal(BigInt(MAX_MINOR_UNITS) + 1n, 2), undefined, "EUR")).toBeNull();
	});

	it("drops an upper bound past every storable amount", () => {
		expect(amountBoundsFor(decimal(1n, 0), decimal(10n ** 20n, 0), "EUR")).toEqual({
			min: 100,
			max: null,
		});
	});
});

describe("escapeLike", () => {
	it("escapes the wildcards and the escape character", () => {
		expect(escapeLike("50%")).toBe("50\\%");
		expect(escapeLike("a_b")).toBe("a\\_b");
		expect(escapeLike("c:\\temp")).toBe("c:\\\\temp");
	});

	it("leaves plain text alone", () => {
		expect(escapeLike("Carrefour")).toBe("Carrefour");
	});
});
