import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { groupByDay } from "./transaction-days";

const row = (date: string, minorUnits: number, currency = "EUR") => ({
	date,
	amount: toMinorUnits(minorUnits),
	currency,
});

describe("groupByDay", () => {
	it("groups adjacent rows by day, in the page's order", () => {
		const days = groupByDay([
			row("2026-09-20", -100),
			row("2026-09-20", -200),
			row("2026-09-18", 50),
		]);

		expect(days.map((day) => [day.date, day.items.length])).toEqual([
			["2026-09-20", 2],
			["2026-09-18", 1],
		]);
	});

	it("sums only the rows of the page, so a day split across pages shows its part", () => {
		// Three of the day's five rows on page 1, two on page 2.
		const [first] = groupByDay([
			row("2026-09-20", -100),
			row("2026-09-20", -250),
			row("2026-09-20", 1000),
		]);

		expect(first?.items).toHaveLength(3);
		expect(first?.subtotals).toEqual([{ currency: "EUR", amount: 650 }]);
	});

	it("gives each currency its own subtotal", () => {
		const [day] = groupByDay([row("2026-09-20", -1000), row("2026-09-20", -500, "USD")]);

		expect(day?.subtotals).toEqual([
			{ currency: "EUR", amount: -1000 },
			{ currency: "USD", amount: -500 },
		]);
	});

	it("has no day for an empty page", () => {
		expect(groupByDay([])).toEqual([]);
	});
});
