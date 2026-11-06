import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { toMinorUnits as m } from "@archant/data/money";

import fr from "../locales/fr.json";
import { monthLabel } from "./dates";
import {
	averageOf,
	cumulativeNet,
	periodLabelText,
	savingsRate,
	shareOf,
	shortMonth,
	sparklinePoints,
} from "./reports";

const i18n = createInstance();

beforeAll(async () => {
	await i18n.init({
		lng: "fr",
		resources: { fr: { translation: fr } },
		interpolation: { escapeValue: false },
	});
});

describe("averageOf", () => {
	it("rounds each figure's mean half away from zero, to the cent", () => {
		expect(averageOf([{ n: m(1) }, { n: m(2) }], (row) => row.n)).toBe(2);
		expect(averageOf([{ n: m(-1) }, { n: m(-2) }], (row) => row.n)).toBe(-2);
		expect(averageOf([{ n: m(1) }, { n: m(1) }, { n: m(2) }], (row) => row.n)).toBe(1);
	});

	it("reads 0 without a row", () => {
		expect(averageOf([], () => m(1))).toBe(0);
	});
});

describe("savingsRate", () => {
	it("rounds net over income to the asked decimals, half away from zero", () => {
		expect(savingsRate({ income: m(3), net: m(1) }, 1)).toBe(33.3);
		expect(savingsRate({ income: m(8), net: m(1) }, 1)).toBe(12.5);
		expect(savingsRate({ income: m(8), net: m(-1) }, 0)).toBe(-13);
	});

	it("reads 0 without income", () => {
		expect(savingsRate({ income: m(0), net: m(-500) }, 1)).toBe(0);
	});
});

describe("shareOf", () => {
	it("gives a line's share of its side, 0 for a side at zero", () => {
		expect(shareOf(m(1), m(3), 1)).toBe(33.3);
		expect(shareOf(m(1), m(3), 0)).toBe(33);
		expect(shareOf(m(5), m(0), 1)).toBe(0);
	});
});

describe("sparklinePoints", () => {
	it("draws nothing under two points or when every value is zero", () => {
		expect(sparklinePoints([5], 60, 20)).toBe("");
		expect(sparklinePoints([0, 0, 0], 60, 20)).toBe("");
	});

	it("spreads the points across the box, the highest at the top", () => {
		expect(sparklinePoints([0, 10], 60, 20)).toBe("0,19 60,1");
		expect(sparklinePoints([4, 4], 60, 20)).toBe("0,19 60,19");
	});
});

describe("cumulativeNet", () => {
	it("sums each month's net as it goes", () => {
		expect(cumulativeNet([{ net: m(10) }, { net: m(-4) }, { net: m(1) }])).toEqual([10, 6, 7]);
	});
});

describe("periodLabelText", () => {
	it("names a month by its month and year, a past year by its number", () => {
		expect(periodLabelText({ kind: "monthly", month: "2026-11" }, i18n.t)).toBe(
			monthLabel("2026-11"),
		);
		expect(periodLabelText({ kind: "past_year", year: 2025 }, i18n.t)).toBe("2025");
	});

	it("names a quarter, the year to date and six months as Sure", () => {
		expect(periodLabelText({ kind: "quarterly", quarter: 4, year: 2026 }, i18n.t)).toBe("Q4 2026");
		expect(periodLabelText({ kind: "ytd", year: 2026 }, i18n.t)).toBe(
			"Depuis le début de l'année 2026",
		);
		expect(
			periodLabelText({ kind: "last_6_months", from: "2026-06-01", to: "2026-11-30" }, i18n.t),
		).toBe(`${shortMonth("2026-06-01")} – ${shortMonth("2026-11-30")}`);
	});
});
