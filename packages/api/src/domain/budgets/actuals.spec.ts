import type { CashFlowCategory, CashFlowLine, CashFlowRow } from "../cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { grossCashFlow, netCashFlow } from "../cash-flow.ts";
import { actualsOf, spendingSegments } from "./actuals.ts";

const line = (categoryId: string | null, amount: number): CashFlowLine => ({
	categoryId,
	name: categoryId,
	color: categoryId === null ? null : "#e99537",
	icon: categoryId === null ? null : "tag",
	amount: toMinorUnits(amount),
	share: null,
});

const categories: CashFlowCategory[] = ["courses", "clothes", "loyer", "salaire"].map((id) => ({
	id,
	name: id,
	kind: id === "salaire" ? "income" : "expense",
	color: "#e99537",
	icon: "tag",
	parentId: null,
}));

const row = (categoryId: string | null, amount: number): CashFlowRow => ({
	categoryId,
	amount: toMinorUnits(amount),
});

/** A month's two views, as `getCashFlowWithRows` builds them from its rows. */
const views = (rows: CashFlowRow[]) => {
	const gross = grossCashFlow(rows, categories);

	return { gross, net: netCashFlow(gross) };
};

describe("actualsOf", () => {
	it("adds what each category spent net and the uncategorised outflow", () => {
		const month = views([row("courses", -12_000), row(null, -3_000), row("loyer", -80_000)]);

		expect(actualsOf(month).spending).toBe(95_000);
	});

	it("lets a refund lower its category, and a category refunded beyond spend nothing, from the net view", () => {
		// `clothes` nets +30,00: refunded more than it spent this month.
		const month = views([row("courses", -4_000), row("clothes", -1_000), row("clothes", 4_000)]);

		expect(actualsOf(month).spending).toBe(4_000);
	});

	it("counts what an income-kind category spends, where it counted nowhere", () => {
		const month = views([row("salaire", -5_000), row(null, 250_000)]);

		expect(actualsOf(month)).toEqual({ spending: 5_000, income: 250_000 });
	});

	it("takes income from the gross view, a refund beyond spend included, where it netted it away", () => {
		const month = views([row("courses", -1_000), row("courses", 3_000), row(null, 1_000)]);

		expect(actualsOf(month)).toEqual({ spending: 0, income: 4_000 });
	});

	it("counts nothing in a month without a row", () => {
		expect(actualsOf(views([]))).toEqual({ spending: 0, income: 0 });
	});
});

describe("spendingSegments", () => {
	it("keeps the lines that spent, largest first, as positive amounts", () => {
		const segments = spendingSegments([
			line("courses", -4_000),
			line("clothes", 3_000),
			line(null, -9_000),
			line("loyer", -80_000),
		]);

		expect(segments.map((segment) => [segment.categoryId, segment.spent])).toEqual([
			["loyer", 80_000],
			[null, 9_000],
			["courses", 4_000],
		]);
		expect(segments[0]).toEqual({
			categoryId: "loyer",
			name: "loyer",
			color: "#e99537",
			icon: "tag",
			spent: 80_000,
		});
	});

	it("keeps the order it was given between lines of the same size", () => {
		const segments = spendingSegments([line("b", -1_000), line("a", -1_000)]);

		expect(segments.map((segment) => segment.categoryId)).toEqual(["b", "a"]);
	});
});
