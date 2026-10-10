import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { decimalOf, formatMoney, percentage } from "./tool.ts";

const money = (amount: number, currency: string) => ({ amount: toMinorUnits(amount), currency });

describe("formatMoney", () => {
	it("writes Sure's French Money#format, grouped with no-break spaces", () => {
		expect(formatMoney(money(0, "EUR"))).toBe("0,00 €");
		expect(formatMoney(money(123_456, "EUR"))).toBe("1 234,56 €");
		expect(formatMoney(money(-123_456, "EUR"))).toBe("-1 234,56 €");
		expect(formatMoney(money(123_456_789, "EUR"))).toBe("1 234 567,89 €");
		expect(formatMoney(money(5, "EUR"))).toBe("0,05 €");
	});

	it("takes the currency's decimals and Sure's symbol, a dollar other than the US one prefixed", () => {
		expect(formatMoney(money(1235, "JPY"))).toBe("1 235 ¥");
		expect(formatMoney(money(1050, "CAD"))).toBe("10,50 CA$");
		expect(formatMoney(money(1050, "USD"))).toBe("10,50 $");
		expect(formatMoney(money(1500, "USN"))).toBe("15,00 USN");
	});
});

describe("percentage", () => {
	it("writes Rails' French number_to_percentage, rounded half up", () => {
		expect(percentage(12.345, 0)).toBe("12%");
		expect(percentage(12.345, 1)).toBe("12,3%");
		expect(percentage(12.345, 3)).toBe("12,345%");
		expect(percentage(1.005, 2)).toBe("1,01%");
		expect(percentage(0.125, 2)).toBe("0,13%");
		expect(percentage(-12.35, 1)).toBe("-12,4%");
		expect(percentage(1234.5, 0)).toBe("1235%");
		expect(percentage(0, 1)).toBe("0,0%");
	});
});

describe("decimalOf", () => {
	it("writes a BigDecimal as Rails' JSON does, one decimal kept", () => {
		expect(decimalOf(money(12_550, "EUR"))).toBe("125.5");
		expect(decimalOf(money(12_500, "EUR"))).toBe("125.0");
		expect(decimalOf(money(0, "EUR"))).toBe("0.0");
		expect(decimalOf(money(-1234, "EUR"))).toBe("-12.34");
		expect(decimalOf(money(1500, "TND"))).toBe("1.5");
		expect(decimalOf(money(1235, "JPY"))).toBe("1235.0");
	});
});
