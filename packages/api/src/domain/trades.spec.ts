import { describe, expect, it } from "vitest";

import { MAX_MINOR_UNITS, toMinorUnits } from "@archant/data/money";

import {
	quantity as q,
	quantityFromMicros,
	tradePrice as p,
	tradePriceFromMicros,
} from "../testing/decimals.ts";
import {
	conversionFee,
	isIncome,
	isIncomeSide,
	isValidIsin,
	sideOf,
	signFits,
	signedQuantity,
	buyCostFits,
	tradeAmount,
	tradeValue,
	typeOf,
	unsignedQuantity,
} from "./trades.ts";

// Millionths, as these cases were written before AD-22 took Sure's decimals.
const micros = (value: number) => quantityFromMicros(value);
const priceMicros = (value: number) => tradePriceFromMicros(value);

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
				{ quantity: micros(quantity), price: priceMicros(price), fee: toMinorUnits(fee) },
				currency,
			),
		).toBe(expected);
	});

	it("never returns negative zero", () => {
		expect(
			Object.is(
				tradeAmount({ quantity: micros(-1), price: priceMicros(1), fee: toMinorUnits(0) }, "EUR"),
				0,
			),
		).toBe(true);
	});

	it("refuses an amount past MAX_MINOR_UNITS either way, and keeps the limit itself", () => {
		// 100,000 shares at 1,000,000 €: 100 billion euros, MAX_MINOR_UNITS cents.
		const quantity = micros(100_000_000_000);
		const price = priceMicros(1_000_000_000_000);

		expect(tradeAmount({ quantity, price, fee: toMinorUnits(0) }, "EUR")).toBe(-MAX_MINOR_UNITS);
		expect(tradeAmount({ quantity, price, fee: toMinorUnits(1) }, "EUR")).toBeNull();
		expect(
			tradeAmount({ quantity: micros(-200_000_000_000), price, fee: toMinorUnits(0) }, "EUR"),
		).toBeNull();
	});
});

describe("signedQuantity and sideOf", () => {
	it("signs a buy positive and a sale negative, and reads the side back", () => {
		expect(signedQuantity("buy", q("4"))).toBe("4");
		expect(signedQuantity("sell", q("4"))).toBe("-4");
		expect(signedQuantity("sell", q("0.000166666666666667"))).toBe("-0.000166666666666667");
		expect(sideOf(q("4"))).toBe("buy");
		expect(sideOf(q("-4"))).toBe("sell");
		expect(unsignedQuantity(q("-0.5"))).toBe("0.5");
		expect(unsignedQuantity(q("0.5"))).toBe("0.5");
	});
});

describe("Sure's decimals", () => {
	it("prices a buy of 0.000166666666666667 at 60 000 € at 10,00 €, exactly as typed", () => {
		expect(
			tradeAmount(
				{ quantity: q("0.000166666666666667"), price: p("60000"), fee: toMinorUnits(0) },
				"EUR",
			),
		).toBe(-1000);
	});

	it("multiplies eighteen decimals by ten without a float", () => {
		// 12 345.123456789012345678 × 0.0000000001 is 0.0000012345… €, no cent.
		expect(tradeValue(q("12345.123456789012345678"), p("0.0000000001"), "EUR")).toBe(0n);
		// 12 345.123456789012345678 × 1.0000000001 is 12 345.1234580235… €.
		expect(tradeValue(q("12345.123456789012345678"), p("1.0000000001"), "EUR")).toBe(1_234_512n);
		// A Bitcoin in yen, past what millionths of a price kept in a safe integer.
		expect(tradeValue(q("1"), p("987654321.0123456789"), "JPY")).toBe(987_654_321n);
	});

	it("rounds a value half to even to the minor unit", () => {
		// 0.5 × 0.01 € is half a cent: the tie goes to the even cent, zero.
		expect(tradeValue(q("0.5"), p("0.01"), "EUR")).toBe(0n);
		// 1.5 × 0.01 € is a cent and a half: up to two.
		expect(tradeValue(q("1.5"), p("0.01"), "EUR")).toBe(2n);
	});
});

describe("buyCostFits", () => {
	it("refuses a buy whose cost per unit, its fee in it, passes a safe integer of millionths", () => {
		// 1 € over 10⁻¹⁸ of a unit is 10¹⁸ € a unit.
		expect(
			buyCostFits(
				{ quantity: q("0.000000000000000001"), price: p("0"), fee: toMinorUnits(100) },
				"EUR",
			),
		).toBe(false);
		expect(
			buyCostFits({ quantity: q("0.000001"), price: p("60000"), fee: toMinorUnits(100) }, "EUR"),
		).toBe(true);
		// A sale has no cost of its own.
		expect(
			buyCostFits(
				{ quantity: q("-0.000000000000000001"), price: p("0"), fee: toMinorUnits(100) },
				"EUR",
			),
		).toBe(true);
	});
});

describe("typeOf and isIncome", () => {
	it("reads an income's kind, else its quantity's side", () => {
		expect(typeOf({ quantity: micros(4_000_000), incomeKind: null })).toBe("buy");
		expect(typeOf({ quantity: micros(-4_000_000), incomeKind: null })).toBe("sell");
		expect(typeOf({ quantity: micros(0), incomeKind: "dividend" })).toBe("dividend");
		expect(typeOf({ quantity: micros(0), incomeKind: "interest" })).toBe("interest");
	});

	it("tells an income from a buy or a sale", () => {
		expect(isIncome({ side: "dividend" })).toBe(true);
		expect(isIncome({ side: "interest" })).toBe(true);
		expect(isIncome({ side: "buy" })).toBe(false);
		expect(isIncome({ side: "sell" })).toBe(false);
		expect(isIncomeSide("interest")).toBe(true);
		expect(isIncomeSide("buy")).toBe(false);
	});
});

describe("signFits", () => {
	it.each([
		["buy", -100, true],
		["buy", 0, true],
		["buy", 100, false],
		["sell", 100, true],
		["sell", 0, true],
		["sell", -100, false],
		["dividend", 100, true],
		["dividend", 0, false],
		["interest", -100, false],
	] as const)("a %s of %i fits: %s", (type, amount, fits) => {
		expect(signFits(type, toMinorUnits(amount))).toBe(fits);
	});
});

describe("conversionFee", () => {
	const ten = { quantity: q("10"), price: p("612.4") };

	it.each([
		["a buy of 10 at 612.40 for −6 126.50", "buy", ten, -612_650, 250],
		["a buy whose amount is exactly the value", "buy", ten, -612_400, 0],
		["a sale of 10 at 612.40 for 6 121.50", "sell", ten, 612_150, 250],
		["a sale whose amount is exactly the value", "sell", ten, 612_400, 0],
		// 3 × 0.333335 is 1.000005 €, one cent once rounded.
		["the value rounded as a trade's", "buy", { quantity: q("3"), price: p("0.333335") }, -101, 1],
	] as const)("leaves %s its fee", (_name, side, figures, amount, fee) => {
		expect(conversionFee(side, figures, toMinorUnits(amount), "EUR")).toBe(fee);
		// The trade it makes moves the transaction's amount exactly.
		expect(
			tradeAmount(
				{
					quantity: signedQuantity(side, figures.quantity),
					price: figures.price,
					fee: toMinorUnits(fee),
				},
				"EUR",
			),
		).toBe(amount);
	});

	it.each([
		["a buy above what the transaction paid", "buy", -600_000],
		["a sale below what the transaction brought", "sell", 612_500],
	] as const)("refuses %s", (_name, side, amount) => {
		expect(conversionFee(side, ten, toMinorUnits(amount), "EUR")).toBeNull();
	});

	it("refuses a fee past MAX_MINOR_UNITS", () => {
		expect(
			conversionFee(
				"sell",
				{ quantity: q("1000000"), price: p("1000000") },
				toMinorUnits(0),
				"EUR",
			),
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
