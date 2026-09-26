import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	formatSignedMoney,
	formatShortDate,
	formatSignedPercent,
	formatTableDate,
	formatTick,
	formatTooltipDate,
} from "./balance-change";

// Intl separates thousands and the currency with narrow no-break spaces.
const plain = (text: string) => text.replace(/[  ]/gu, " ");

describe("formatSignedMoney", () => {
	it("puts a plus sign on a rise and a true minus on a fall", () => {
		expect(plain(formatSignedMoney(toMinorUnits(1240), "EUR"))).toBe("+12,40 €");
		expect(plain(formatSignedMoney(toMinorUnits(-123456), "EUR"))).toBe("−1 234,56 €");
		expect(plain(formatSignedMoney(toMinorUnits(0), "EUR"))).toBe("0,00 €");
	});
});

describe("formatSignedPercent", () => {
	it("keeps one decimal and signs everything but zero", () => {
		expect(plain(formatSignedPercent(1))).toBe("+1,0 %");
		expect(plain(formatSignedPercent(-25))).toBe("−25,0 %");
		expect(plain(formatSignedPercent(0))).toBe("0,0 %");
	});
});

describe("dates", () => {
	it("formats the tooltip and the table in French, on the stored day", () => {
		expect(formatTooltipDate("2026-09-21")).toBe("lundi 21 septembre 2026");
		expect(formatTableDate("2026-09-01")).toBe("1 septembre 2026");
	});

	it("abbreviates the month where a sentence names a day", () => {
		expect(formatShortDate("2026-09-12")).toBe("12 sept. 2026");
	});

	it("shows the day on a short range and the year on a long one", () => {
		expect(formatTick("2026-09-21", false)).toBe("21 sept.");
		expect(formatTick("2025-09-21", true)).toBe("sept. 2025");
	});
});
