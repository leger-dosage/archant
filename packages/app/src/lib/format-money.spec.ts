import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { formatWholeMoney } from "./format-money";

// Intl separates thousands and the currency with narrow no-break spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/gu, " ");

describe("formatWholeMoney", () => {
	it("rounds half up to the whole unit", () => {
		expect(plain(formatWholeMoney(toMinorUnits(2_500_050), "EUR"))).toBe("25 001 €");
		expect(plain(formatWholeMoney(toMinorUnits(2_500_049), "EUR"))).toBe("25 000 €");
	});

	it("rounds a negative amount away from zero, with a true minus", () => {
		expect(plain(formatWholeMoney(toMinorUnits(-5_050), "EUR"))).toBe("−51 €");
	});

	it("reads a currency without decimals in its own unit", () => {
		expect(plain(formatWholeMoney(toMinorUnits(1_234), "JPY"))).toBe("1 234 JPY");
	});
});
