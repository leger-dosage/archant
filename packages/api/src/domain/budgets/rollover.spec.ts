import type { TreeCategory } from "./categories.ts";
import type { RolloverMonth } from "./rollover.ts";

import { describe, expect, it } from "vitest";

import type { CategoryKind } from "@archant/data/category-presets";
import { toMinorUnits } from "@archant/data/money";

import { rolloverChain } from "./rollover.ts";

const category = (
	id: string,
	parentId: string | null = null,
	kind: CategoryKind = "expense",
): TreeCategory => ({ id, parentId, kind });

const A = category("A");
const P = category("P");
const C = category("C", "P");
const S = category("S", "P");

/** `rows` as `[amount, rollover on]`, `spending` as amounts, both in minor units. */
function month(
	value: string,
	rows: Record<string, [number, boolean]>,
	spending: Record<string, number> = {},
	currency = "EUR",
): RolloverMonth {
	return {
		month: value,
		currency,
		rows: new Map(
			Object.entries(rows).map(([id, [amount, rolloverEnabled]]) => [
				id,
				{ budgetedSpending: toMinorUnits(amount), rolloverEnabled },
			]),
		),
		spending: new Map(Object.entries(spending).map(([id, spent]) => [id, toMinorUnits(spent)])),
	};
}

/** What each row of each month received, as plain objects. */
function chainOf(months: RolloverMonth[], categories: TreeCategory[] = [A, P, C, S]) {
	return Object.fromEntries(
		[...rolloverChain({ categories, months })].map(([key, received]) => [
			key,
			Object.fromEntries(received),
		]),
	);
}

describe("rolloverChain", () => {
	it("carries a surplus into the next month set up", () => {
		expect(
			chainOf([
				month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
				month("2026-07", { A: [0, true] }),
			]),
		).toEqual({ "2026-06": { A: 0 }, "2026-07": { A: 7_000 } });
	});

	it("crosses a month never set up untouched", () => {
		expect(
			chainOf([
				month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
				month("2026-08", { A: [0, true] }),
			]),
		).toEqual({ "2026-06": { A: 0 }, "2026-08": { A: 7_000 } });
	});

	it("adds what came in to what the month leaves, months taken in order", () => {
		const chain = chainOf([
			month("2026-08", { A: [0, true] }),
			month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
			month("2026-07", { A: [5_000, true] }),
		]);

		expect(chain["2026-08"]).toEqual({ A: 12_000 });
	});

	it("carries nothing from an overspent month", () => {
		expect(
			chainOf([
				month("2026-06", { A: [10_000, true] }, { A: 13_000 }),
				month("2026-07", { A: [0, true] }),
			])["2026-07"],
		).toEqual({ A: 0 });
	});

	it("neither receives nor gives in a month switched off", () => {
		const chain = chainOf([
			month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
			month("2026-07", { A: [5_000, false] }),
			month("2026-08", { A: [0, true] }),
		]);

		expect(chain["2026-07"]).toEqual({ A: 0 });
		expect(chain["2026-08"]).toEqual({ A: 0 });
	});

	it("gives nothing to a month without the category's row, nor from it", () => {
		const chain = chainOf([
			month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
			month("2026-07", { P: [1_000, true] }),
			month("2026-08", { A: [0, true] }),
		]);

		expect(chain["2026-07"]).toEqual({ P: 0 });
		expect(chain["2026-08"]).toEqual({ A: 0 });
	});

	it("leaves a parent's ring-fenced children to carry their own", () => {
		// P 300 holds C, ring-fenced at 100, which spent 20; P itself spent 50.
		const chain = chainOf([
			month("2026-06", { P: [30_000, true], C: [10_000, true] }, { P: 7_000, C: 2_000 }),
			month("2026-07", { P: [30_000, true], C: [10_000, true] }),
		]);

		expect(chain["2026-07"]).toEqual({ P: 15_000, C: 8_000 });
	});

	it("gives a shared child nothing, its parent carrying what it spent from", () => {
		const chain = chainOf([
			month("2026-06", { P: [30_000, true], S: [0, true] }, { P: 4_000, S: 4_000 }),
			month("2026-07", { P: [30_000, true], S: [0, true] }),
		]);

		expect(chain["2026-07"]).toEqual({ P: 26_000, S: 0 });
	});

	it("starts from nothing after a change of currency", () => {
		const chain = chainOf([
			month("2026-06", { A: [10_000, true] }, { A: 3_000 }),
			month("2026-07", { A: [5_000, true] }, {}, "USD"),
			month("2026-08", { A: [0, true] }, {}, "USD"),
		]);

		expect(chain["2026-07"]).toEqual({ A: 0 });
		expect(chain["2026-08"]).toEqual({ A: 5_000 });
	});

	it("turns off a category deleted or no longer an expense category", () => {
		const chain = chainOf(
			[
				month("2026-06", { A: [10_000, true], B: [10_000, true] }),
				month("2026-07", { A: [0, true], B: [0, true] }),
			],
			[category("B", null, "income")],
		);

		expect(chain["2026-07"]).toEqual({ A: 0, B: 0 });
	});

	it("reads today's tree: a child re-parented since is ring-fenced under its new parent", () => {
		// « C » stood alone in June; today it sits under « P ».
		const chain = chainOf([
			month("2026-06", { P: [30_000, true], C: [10_000, true] }, { P: 0, C: 0 }),
			month("2026-07", { P: [5_000, true], C: [5_000, true] }),
		]);

		expect(chain["2026-07"]).toEqual({ P: 20_000, C: 10_000 });
	});
});
