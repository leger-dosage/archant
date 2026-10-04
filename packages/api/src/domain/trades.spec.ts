import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { MAX_MINOR_UNITS, toMinorUnits } from "@archant/data/money";

import { firstShortfall, isValidIsin, sideOf, signedQuantity, tradeAmount } from "./trades.ts";

const micros = (value: number) => toMicros(value);

describe("tradeAmount", () => {
	it.each([
		["a buy of 10 at 612.40 with 2.50 of fees", 10_000_000, 612_400_000, 250, "EUR", -612_650],
		["a sale of 4 at 650 without fees", -4_000_000, 650_000_000, 0, "EUR", 260_000],
		["a sale whose fee comes off what it brings", -4_000_000, 650_000_000, 250, "EUR", 259_750],
		// 1.000005 € is 100.0005 cents, 1.000035 € is 100.0035 cents: both round down.
		["3 at 0.333335, rounded to the cent", 3_000_000, 333_335, 0, "EUR", -100],
		["3 at 0.333345, rounded to the cent", 3_000_000, 333_345, 0, "EUR", -100],
		// 1.5 and 2.5 cents: a tie goes to the even cent, up then down.
		["1 at 0.015, a tie up to the even cent", 1_000_000, 15_000, 0, "EUR", -2],
		["1 at 0.025, a tie down to the even cent", 1_000_000, 25_000, 0, "EUR", -2],
		["a fraction of a share, its tie to the even cent", 500_000, 101_010_000, 0, "EUR", -5050],
		["a fraction of a share rounded up", 700_000, 10_010_000, 0, "EUR", -701],
		["a free share", 1_000_000, 0, 0, "EUR", 0],
		["a yen price, no minor unit", 2_000_000, 1_500_500_000, 0, "JPY", -3001],
		["a dinar price, three decimals", 1_000_000, 1_234_567, 0, "KWD", -1235],
		["a code outside ISO 4217, two decimals", 1_000_000, 1_234_567, 0, "XXX", -123],
	] as const)("%s", (_name, quantity, price, fee, currency, expected) => {
		expect(
			tradeAmount(
				{ quantity: micros(quantity), price: micros(price), fee: toMinorUnits(fee) },
				currency,
			),
		).toBe(expected);
	});

	it("never returns negative zero", () => {
		expect(
			Object.is(
				tradeAmount({ quantity: micros(-1), price: micros(1), fee: toMinorUnits(0) }, "EUR"),
				0,
			),
		).toBe(true);
	});

	it("refuses an amount past MAX_MINOR_UNITS either way, and keeps the limit itself", () => {
		// 100,000 shares at 1,000,000 €: 100 billion euros, MAX_MINOR_UNITS cents.
		const quantity = micros(100_000_000_000);
		const price = micros(1_000_000_000_000);

		expect(tradeAmount({ quantity, price, fee: toMinorUnits(0) }, "EUR")).toBe(-MAX_MINOR_UNITS);
		expect(tradeAmount({ quantity, price, fee: toMinorUnits(1) }, "EUR")).toBeNull();
		expect(
			tradeAmount({ quantity: micros(-200_000_000_000), price, fee: toMinorUnits(0) }, "EUR"),
		).toBeNull();
	});
});

describe("signedQuantity and sideOf", () => {
	it("signs a buy positive and a sale negative, and reads the side back", () => {
		expect(signedQuantity("buy", micros(4_000_000))).toBe(4_000_000);
		expect(signedQuantity("sell", micros(4_000_000))).toBe(-4_000_000);
		expect(sideOf(micros(4_000_000))).toBe("buy");
		expect(sideOf(micros(-4_000_000))).toBe("sell");
	});
});

const trade = (date: string, quantity: number) => ({ date, quantity: micros(quantity) });

describe("firstShortfall", () => {
	it("finds nothing short in a history that never sells more than it holds", () => {
		expect(firstShortfall([])).toBeNull();
		expect(
			firstShortfall([
				trade("2026-09-01", 10),
				trade("2026-09-05", -4),
				trade("2026-09-03", -6),
				trade("2026-09-06", 3),
			]),
		).toBeNull();
	});

	it("nets a day's trades before checking it, whatever their order", () => {
		expect(firstShortfall([trade("2026-09-01", -5), trade("2026-09-01", 5)])).toBeNull();
	});

	it("names the first day the running quantity falls below zero", () => {
		expect(firstShortfall([trade("2026-09-01", 10), trade("2026-09-02", -11)])).toBe("2026-09-02");
		// Buy 10 on day 1, sell 10 on day 5, sell 5 on day 3: day 5 is short.
		expect(
			firstShortfall([trade("2026-09-01", 10), trade("2026-09-05", -10), trade("2026-09-03", -5)]),
		).toBe("2026-09-05");
		// The buy gone, the first sale is short.
		expect(firstShortfall([trade("2026-09-05", -10)])).toBe("2026-09-05");
	});

	it("sums past what a number holds exactly", () => {
		expect(
			firstShortfall([
				trade("2026-09-01", Number.MAX_SAFE_INTEGER),
				trade("2026-09-02", Number.MAX_SAFE_INTEGER),
				trade("2026-09-03", -Number.MAX_SAFE_INTEGER),
				trade("2026-09-04", -Number.MAX_SAFE_INTEGER),
			]),
		).toBeNull();
	});
});

describe("isValidIsin", () => {
	it.each(["FR0000121014", "US0378331005", "FR0010315770", "IE00B4L5Y983", "LU0290358497"])(
		"accepts %s",
		(isin) => {
			expect(isValidIsin(isin)).toBe(true);
		},
	);

	it.each([
		"FR0000121015",
		"fr0000121014",
		"FR000012101",
		"FR00001210144",
		"120000121014",
		"FR000012101X",
		"",
	])("refuses %j", (isin) => {
		expect(isValidIsin(isin)).toBe(false);
	});
});
