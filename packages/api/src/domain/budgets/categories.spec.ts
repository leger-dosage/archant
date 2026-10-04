import type { CashFlowCategory, CashFlowRow } from "../cash-flow.ts";
import type { MonthRows } from "./categories.ts";

import { describe, expect, it } from "vitest";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import {
	averageOf,
	budgetCategories,
	parentAfterChildSave,
	parentAfterOwnSave,
	spentByCategory,
} from "./categories.ts";

const category = (id: string, overrides: Partial<CashFlowCategory> = {}): CashFlowCategory => ({
	id,
	name: id,
	kind: "expense",
	color: "#e99537",
	icon: "tag",
	parentId: null,
	...overrides,
});

const row = (categoryId: string | null, amount: number): CashFlowRow => ({
	categoryId,
	amount: toMinorUnits(amount),
});

const amounts = (entries: Record<string, number>) =>
	new Map(Object.entries(entries).map(([id, amount]) => [id, toMinorUnits(amount)]));

const minor = (value: number): MinorUnits => toMinorUnits(value);

const month = (value: string, rows: CashFlowRow[]): MonthRows => ({ month: value, rows });

/** Rollover on, with what came in, by category. */
const carried = (entries: Record<string, number>) =>
	new Map(
		Object.entries(entries).map(([id, amount]) => [
			id,
			{ enabled: true, carried: toMinorUnits(amount) },
		]),
	);

// « Maison » has two children: « Travaux » and « Jardin ».
const house = category("Maison");
const works = category("Travaux", { parentId: "Maison" });
const garden = category("Jardin", { parentId: "Maison" });
const groceries = category("Courses");
const salary = category("Salaire", { kind: "income" });

function budgetOf(
	input: Partial<Parameters<typeof budgetCategories>[0]> & { amounts?: Map<string, MinorUnits> },
) {
	return budgetCategories({
		categories: [house, works, garden, groceries, salary],
		amounts: new Map(),
		rollover: new Map(),
		rows: [],
		history: [],
		shown: "2026-09",
		current: "2026-09",
		budgetedSpending: minor(200_000),
		...input,
	});
}

const lineOf = (result: ReturnType<typeof budgetCategories>, id: string) => {
	const found = result.categories.find((line) => line.categoryId === id);

	if (found === undefined) {
		throw new Error(`No line for ${id}`);
	}

	return found;
};

describe("budgetCategories", () => {
	it("lists expense categories, parents by name with their children by name under them", () => {
		const result = budgetOf({});

		expect(result.categories.map((line) => [line.categoryId, line.parentId])).toEqual([
			["Courses", null],
			["Maison", null],
			["Jardin", "Maison"],
			["Travaux", "Maison"],
		]);
	});

	it("reads a category without a row as 0, and adds top-level amounts into the allocation", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 50_000, Maison: 100_000, Travaux: 30_000 }),
		});

		expect(lineOf(result, "Courses").budgetedSpending).toBe(50_000);
		expect(lineOf(result, "Jardin")).toMatchObject({ budgetedSpending: 0, shared: true });
		expect(lineOf(result, "Travaux")).toMatchObject({ budgetedSpending: 30_000, shared: false });
		expect(lineOf(result, "Maison").shared).toBe(false);
		// A child's amount is already inside its parent's.
		expect(result.allocated).toBe(150_000);
		expect(result.uncategorised.budgetedSpending).toBe(50_000);
	});

	it("gives each category what a move can take from it, as Sure's `movable_from`", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 50_000, Maison: 100_000, Travaux: 30_000 }),
		});

		expect(lineOf(result, "Courses").movable).toBe(50_000);
		// A parent keeps what its ring-fenced children hold.
		expect(lineOf(result, "Maison").movable).toBe(70_000);
		expect(lineOf(result, "Travaux").movable).toBe(30_000);
		expect(lineOf(result, "Jardin").movable).toBe(0);
	});

	it("gives nothing from a parent all held by its children, or stored below them", () => {
		const held = budgetOf({ amounts: amounts({ Maison: 30_000, Travaux: 30_000 }) });
		const below = budgetOf({ amounts: amounts({ Maison: 10_000, Travaux: 30_000 }) });

		expect(lineOf(held, "Maison").movable).toBe(0);
		expect(lineOf(below, "Maison").movable).toBe(0);
	});

	it("budgets « Sans catégorie » nothing once the allocation passes the total", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 20_000, Maison: 100_000 }),
			budgetedSpending: minor(100_000),
		});

		expect(result.allocated).toBe(120_000);
		expect(result.uncategorised).toMatchObject({ budgetedSpending: 0, budgeted: false });
	});

	it("budgets « Sans catégorie » nothing in a month not set up", () => {
		expect(budgetOf({ budgetedSpending: null }).uncategorised.budgetedSpending).toBe(0);
	});

	it("shares a parent between ring-fenced and shared children", () => {
		// Parent 1 000 holds A, ring-fenced at 300, which spent 100; B, shared,
		// spent 650; the parent itself spent nothing.
		const result = budgetOf({
			amounts: amounts({ Maison: 100_000, Travaux: 30_000 }),
			rows: [row("Travaux", -10_000), row("Jardin", -65_000)],
		});

		expect(lineOf(result, "Maison")).toMatchObject({
			spent: 75_000,
			available: 25_000,
			status: "onTrack",
			section: "onTrack",
		});
		expect(lineOf(result, "Travaux")).toMatchObject({
			spent: 10_000,
			available: 20_000,
			status: "onTrack",
			section: "onTrack",
		});
		// What the parent keeps beyond A, 700, against what it spent beyond A, 650.
		expect(lineOf(result, "Jardin")).toMatchObject({
			shared: true,
			budgeted: true,
			spent: 65_000,
			available: 5_000,
			percentSpent: (65_000 / 70_000) * 100,
			status: "near",
			section: "onTrack",
		});
	});

	it("never leaves a shared child below zero, and floors a negative shared budget", () => {
		// The children ring-fence more than the parent holds.
		const result = budgetOf({
			amounts: amounts({ Maison: 10_000, Travaux: 30_000 }),
			rows: [row("Jardin", -5_000)],
		});

		expect(lineOf(result, "Jardin")).toMatchObject({
			available: 0,
			percentSpent: 100,
			status: "near",
		});
	});

	it("hides a shared child until it spends", () => {
		const result = budgetOf({ amounts: amounts({ Maison: 100_000 }) });

		expect(lineOf(result, "Jardin")).toMatchObject({
			budgeted: true,
			spent: 0,
			status: "onTrack",
			section: null,
		});
	});

	it("files a shared child of an unbudgeted parent that spent as over", () => {
		const result = budgetOf({ rows: [row("Jardin", -2_000)] });

		// Sure's: no shared budget and something spent reads 100 %, near the limit.
		expect(lineOf(result, "Jardin")).toMatchObject({
			budgeted: false,
			available: 0,
			status: "near",
			section: "over",
		});
		expect(lineOf(result, "Maison")).toMatchObject({
			spent: 2_000,
			available: -2_000,
			status: "over",
			section: "over",
		});
	});

	it("reads a shared child with no shared budget and no spend as on track", () => {
		const result = budgetOf({ amounts: amounts({ Maison: 30_000, Travaux: 30_000 }) });

		expect(lineOf(result, "Jardin")).toMatchObject({ available: 0, status: "onTrack" });
	});

	it("is near the limit from 90 % spent", () => {
		const near = budgetOf({
			amounts: amounts({ Courses: 10_000 }),
			rows: [row("Courses", -9_000)],
		});
		const below = budgetOf({
			amounts: amounts({ Courses: 10_000 }),
			rows: [row("Courses", -8_999)],
		});

		expect(lineOf(near, "Courses")).toMatchObject({
			status: "near",
			section: "onTrack",
			percentSpent: 90,
		});
		expect(lineOf(below, "Courses")).toMatchObject({ status: "onTrack", available: 1_001 });
	});

	it("is over once it spends beyond its amount", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 10_000 }),
			rows: [row("Courses", -10_001)],
		});

		expect(lineOf(result, "Courses")).toMatchObject({
			budgeted: true,
			available: -1,
			status: "over",
			section: "over",
		});
	});

	it("files a category with no amount that spent as over", () => {
		const result = budgetOf({ rows: [row("Courses", -2_000)] });

		expect(lineOf(result, "Courses")).toMatchObject({
			budgeted: false,
			available: -2_000,
			status: "over",
			section: "over",
		});
	});

	it("hides a category neither budgeted nor spending", () => {
		expect(lineOf(budgetOf({}), "Courses")).toMatchObject({
			budgeted: false,
			spent: 0,
			status: "onTrack",
			section: null,
		});
	});

	it("lets a refund lower its category, never below zero", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 10_000, Maison: 10_000 }),
			rows: [row("Courses", -4_000), row("Courses", 1_000), row("Maison", 3_000)],
		});

		expect(lineOf(result, "Courses").spent).toBe(3_000);
		expect(lineOf(result, "Maison")).toMatchObject({ spent: 0, available: 10_000 });
	});

	it("spends the uncategorised outflow, an unknown category's included, never income", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 150_000 }),
			rows: [
				row(null, -30_000),
				row("Disparue", -10_000),
				row(null, 100_000),
				row("Salaire", -5_000),
			],
		});

		expect(result.uncategorised).toMatchObject({
			budgetedSpending: 50_000,
			budgeted: true,
			spent: 40_000,
			available: 10_000,
			status: "onTrack",
			section: "onTrack",
		});
	});

	it("files « Sans catégorie » as over once it spends beyond what is left", () => {
		const result = budgetOf({
			amounts: amounts({ Courses: 200_000 }),
			rows: [row(null, -1_500)],
		});

		expect(result.uncategorised).toMatchObject({
			budgetedSpending: 0,
			available: -1_500,
			status: "over",
			section: "over",
		});
	});

	it("lists « Sans catégorie » on track only beside an expense category", () => {
		const alone = budgetOf({ categories: [salary] });
		const over = budgetOf({ categories: [salary], rows: [row(null, -300_000)] });

		expect(alone.categories).toEqual([]);
		expect(alone.uncategorised).toMatchObject({ budgeted: true, section: null });
		expect(over.uncategorised.section).toBe("over");
		expect(budgetOf({}).uncategorised.section).toBe("onTrack");
	});

	describe("rollover", () => {
		it("counts what came in in what remains, never in the allocation or a move", () => {
			const result = budgetOf({
				amounts: amounts({ Courses: 10_000 }),
				rollover: carried({ Courses: 7_000 }),
				rows: [row("Courses", -15_000)],
			});

			expect(lineOf(result, "Courses")).toMatchObject({
				rolloverEnabled: true,
				rolledOver: 7_000,
				budgetedSpending: 10_000,
				movable: 10_000,
				available: 2_000,
				percentSpent: (15_000 / 17_000) * 100,
				status: "onTrack",
				section: "onTrack",
			});
			expect(result.allocated).toBe(10_000);
			expect(lineOf(result, "Jardin")).toMatchObject({ rolloverEnabled: false, rolledOver: 0 });
		});

		it("budgets a category funded only by what came in", () => {
			const result = budgetOf({
				rollover: carried({ Courses: 5_000 }),
				rows: [row("Courses", -1_000)],
			});

			expect(lineOf(result, "Courses")).toMatchObject({
				budgeted: true,
				available: 4_000,
				section: "onTrack",
			});
		});

		it("adds a parent's ring-fenced children's carry to its own, and shows a shared child its parent's", () => {
			const result = budgetOf({
				amounts: amounts({ Maison: 30_000, Travaux: 10_000 }),
				rollover: carried({ Maison: 15_000, Travaux: 8_000, Jardin: 0 }),
				rows: [row("Travaux", -2_000), row("Jardin", -40_000)],
			});

			expect(lineOf(result, "Maison")).toMatchObject({
				rolledOver: 23_000,
				available: 30_000 + 23_000 - 42_000,
			});
			expect(lineOf(result, "Travaux")).toMatchObject({ rolledOver: 8_000, available: 16_000 });
			// What the parent keeps beyond « Travaux », 200, with its own 150.
			expect(lineOf(result, "Jardin")).toMatchObject({
				shared: true,
				rolledOver: 15_000,
				available: 0,
				percentSpent: (40_000 / 35_000) * 100,
			});
		});
	});

	describe("medians and averages", () => {
		const history = [
			month("2026-05", [row("Courses", -10_000), row("Travaux", -4_000), row(null, 2_000)]),
			month("2026-06", [row("Courses", -30_000), row("Maison", -1_000), row(null, -500)]),
			month("2026-07", [row("Courses", -20_000), row("Courses", 25_000)]),
			month("2026-08", [row("Courses", -40_000), row(null, -1_500)]),
			month("2026-09", [row("Courses", -90_000)]),
		];

		it("take the months before both the shown and the current month that have a row", () => {
			const result = budgetOf({ history, shown: "2026-09", current: "2026-09" });

			// May to August: 100, 300, 0 (refunded beyond what it spent), 400.
			expect(lineOf(result, "Courses")).toMatchObject({ median: 20_000, average: 20_000 });
			// A parent's months include its children's: 40 in May, 10 in June.
			expect(lineOf(result, "Maison")).toMatchObject({ median: 2_500, average: 2_500 });
			expect(lineOf(result, "Travaux")).toMatchObject({ median: 4_000, average: 4_000 });
			expect(lineOf(result, "Jardin")).toMatchObject({ median: null, average: null });
			// Months with an uncategorised outflow only: 5 in June, 15 in August.
			expect(result.uncategorised).toMatchObject({ median: 1_000, average: 1_000 });
		});

		it("stop at the shown month when it comes earlier, and never take a later one", () => {
			expect(lineOf(budgetOf({ history, shown: "2026-07" }), "Courses")).toMatchObject({
				median: 20_000,
				average: 20_000,
			});
			expect(
				lineOf(budgetOf({ history, shown: "2027-01", current: "2026-09" }), "Courses").median,
			).toBe(20_000);
		});
	});
});

describe("spentByCategory", () => {
	it("counts each expense category's outflow net of refunds, a parent with its children", () => {
		expect(
			Object.fromEntries(
				spentByCategory(
					[row("Travaux", -3_000), row("Maison", -1_000), row("Courses", 2_000), row(null, -500)],
					[house, works, garden, groceries, salary],
				),
			),
		).toEqual({ Maison: 4_000, Travaux: 3_000, Courses: 0 });
	});
});

describe("parentAfterChildSave", () => {
	// Sure's fixture: parent 1 000, a child ring-fenced at 300, another shared.
	it("keeps the parent's reserve when a shared child is ring-fenced", () => {
		expect(
			parentAfterChildSave({
				parent: minor(100_000),
				siblings: minor(30_000),
				previousChild: minor(0),
				child: minor(20_000),
			}),
		).toBe(120_000);
	});

	it("lowers the parent when a ring-fenced child shares again", () => {
		expect(
			parentAfterChildSave({
				parent: minor(100_000),
				siblings: minor(0),
				previousChild: minor(30_000),
				child: minor(0),
			}),
		).toBe(70_000);
	});

	it("creates the parent's amount from its first ring-fenced child", () => {
		expect(
			parentAfterChildSave({
				parent: minor(0),
				siblings: minor(0),
				previousChild: minor(0),
				child: minor(20_000),
			}),
		).toBe(20_000);
	});

	it("never carries a negative reserve", () => {
		expect(
			parentAfterChildSave({
				parent: minor(5_000),
				siblings: minor(5_000),
				previousChild: minor(3_000),
				child: minor(2_000),
			}),
		).toBe(7_000);
	});
});

describe("parentAfterOwnSave", () => {
	it("stores what is typed above its ring-fenced children", () => {
		expect(parentAfterOwnSave({ typed: minor(100_000), children: minor(30_000) })).toBe(100_000);
	});

	it("never goes below what its ring-fenced children hold", () => {
		expect(parentAfterOwnSave({ typed: minor(10_000), children: minor(30_000) })).toBe(30_000);
		expect(parentAfterOwnSave({ typed: minor(0), children: minor(0) })).toBe(0);
	});
});

describe("averageOf", () => {
	it("rounds to the minor unit, and has nothing to say of nothing", () => {
		expect(averageOf([minor(1), minor(2)])).toBe(2);
		expect(averageOf([])).toBeNull();
	});
});
