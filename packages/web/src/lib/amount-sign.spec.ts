import { describe, expect, it } from "vitest";

import { parseAmount, toMinorUnits } from "@archant/data/money";

import { amountToText, initialNature, joinAmount, splitAmount } from "./amount-sign.ts";

describe("splitAmount", () => {
	it("keeps the toggle when no sign is typed", () => {
		expect(splitAmount("42,90", "expense")).toEqual({ nature: "expense", magnitude: "42,90" });
		expect(splitAmount("42,90", "income")).toEqual({ nature: "income", magnitude: "42,90" });
	});

	it("switches to Dépense on a leading minus, hyphen or true minus", () => {
		expect(splitAmount("-42,90", "income")).toEqual({ nature: "expense", magnitude: "42,90" });
		expect(splitAmount("−42,90", "income")).toEqual({ nature: "expense", magnitude: "42,90" });
		expect(splitAmount(" - 1 234,56", "income")).toEqual({
			nature: "expense",
			magnitude: "1 234,56",
		});
	});

	it("switches to Revenu on a leading plus", () => {
		expect(splitAmount("+1 500", "expense")).toEqual({ nature: "income", magnitude: "1 500" });
	});

	it("leaves an empty field empty", () => {
		expect(splitAmount("", "expense")).toEqual({ nature: "expense", magnitude: "" });
	});
});

describe("initialNature", () => {
	it("starts a new amount as an expense", () => {
		expect(initialNature("")).toBe("expense");
	});

	it("keeps the sign of an amount being edited", () => {
		expect(initialNature("-42,90")).toBe("expense");
		expect(initialNature("2000,00")).toBe("income");
		expect(joinAmount(splitAmount("2000,00", initialNature("2000,00")))).toBe("2000,00");
	});
});

describe("joinAmount", () => {
	it("signs an expense and leaves an income as typed", () => {
		expect(joinAmount({ nature: "expense", magnitude: "42,90" })).toBe("-42,90");
		expect(joinAmount({ nature: "income", magnitude: " 42,90 " })).toBe("42,90");
	});

	it("sends an empty expense as empty, not as a lone minus", () => {
		expect(joinAmount({ nature: "expense", magnitude: "  " })).toBe("");
	});

	it("round-trips through parseAmount", () => {
		const text = joinAmount(splitAmount("-42,90", "income"));

		expect(parseAmount(text, "EUR")).toBe(-4290);
	});
});

describe("amountToText", () => {
	it("writes minor units back as the French text the field accepts", () => {
		expect(amountToText(toMinorUnits(-4290), "EUR")).toBe("-42,90");
		expect(amountToText(toMinorUnits(5), "EUR")).toBe("0,05");
		expect(amountToText(toMinorUnits(123456), "EUR")).toBe("1234,56");
		expect(amountToText(toMinorUnits(1500), "JPY")).toBe("1500");
		expect(amountToText(toMinorUnits(1234), "BHD")).toBe("1,234");
	});

	it("round-trips through parseAmount in the same currency", () => {
		for (const [amount, currency] of [
			[-4290, "EUR"],
			[0, "EUR"],
			[1500, "JPY"],
			[-1234, "BHD"],
		] as const) {
			expect(parseAmount(amountToText(toMinorUnits(amount), currency), currency)).toBe(amount);
		}
	});
});
