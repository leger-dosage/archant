import type { BudgetedCategory } from "./moves.ts";

import { describe, expect, it } from "vitest";

import type { CategoryKind } from "@archant/data/category-presets";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { copiedAmounts, moveAllocation } from "./moves.ts";

const amounts = (entries: Record<string, number>) =>
	new Map(Object.entries(entries).map(([id, amount]) => [id, toMinorUnits(amount)]));

const minor = (value: number): MinorUnits => toMinorUnits(value);

const category = (
	id: string,
	parentId: string | null = null,
	kind: CategoryKind = "expense",
): BudgetedCategory & { kind: CategoryKind } => ({ id, parentId, kind });

// Sure's fixture: « P » holds « A », ring-fenced at 300, and « B », shared;
// « Q » stands alone.
const P = category("P");
const A = category("A", "P");
const B = category("B", "P");
const Q = category("Q");
const expense = [P, A, B, Q];

function move(
	from: BudgetedCategory,
	to: BudgetedCategory,
	amount: number,
	stored: Record<string, number> = { P: 100_000, A: 30_000, Q: 20_000 },
) {
	return moveAllocation({
		categories: expense,
		amounts: amounts(stored),
		from,
		to,
		amount: minor(amount),
	});
}

/** The amounts a move leaves, the unchanged ones included. */
function after(result: ReturnType<typeof moveAllocation>, stored: Record<string, number>) {
	if (!("changes" in result)) {
		throw new Error(`Refused: ${JSON.stringify(result.refusal)}`);
	}

	return Object.fromEntries([...amounts(stored), ...result.changes]);
}

describe("moveAllocation", () => {
	const stored = { P: 100_000, A: 30_000, Q: 20_000 };

	it("moves between two parents, leaving the allocation as it was", () => {
		const result = move(P, Q, 5_000);

		expect(after(result, stored)).toEqual({ P: 95_000, A: 30_000, Q: 25_000 });
		expect("changes" in result && [...result.changes.keys()]).toEqual(["P", "Q"]);
	});

	it("never takes from a parent what its ring-fenced children hold", () => {
		expect(move(P, Q, 70_100)).toEqual({ refusal: { path: "amount", code: "insufficient_funds" } });
		expect(after(move(P, Q, 70_000), stored)).toEqual({ P: 30_000, A: 30_000, Q: 90_000 });
	});

	it("re-sums a subcategory's parent when it gives", () => {
		expect(after(move(A, Q, 10_000), stored)).toEqual({ P: 90_000, A: 20_000, Q: 30_000 });
	});

	it("leaves the parent as it was between two siblings", () => {
		const siblings = { P: 110_000, A: 30_000, B: 10_000, Q: 20_000 };

		expect(after(move(A, B, 5_000, siblings), siblings)).toEqual({
			P: 110_000,
			A: 25_000,
			B: 15_000,
			Q: 20_000,
		});
	});

	it("ring-fences a shared child that receives, and lifts its parent", () => {
		expect(after(move(Q, B, 5_000), stored)).toEqual({
			P: 105_000,
			A: 30_000,
			B: 5_000,
			Q: 15_000,
		});
	});

	it("lifts a receiving parent stored below its children", () => {
		const low = { P: 10_000, A: 30_000, Q: 20_000 };

		expect(after(move(Q, P, 5_000, low), low)).toEqual({ P: 30_000, A: 30_000, Q: 15_000 });
	});

	it("gives nothing from a shared child, or from a parent all held by its children", () => {
		expect(move(B, Q, 1)).toEqual({ refusal: { path: "amount", code: "insufficient_funds" } });
		expect(move(P, Q, 1, { P: 30_000, A: 30_000 })).toEqual({
			refusal: { path: "amount", code: "insufficient_funds" },
		});
	});

	it("refuses a move between a parent and its own child, either way", () => {
		const refusal = { refusal: { path: "toCategoryId", code: "parent_child" } };

		expect(move(P, A, 100)).toEqual(refusal);
		expect(move(A, P, 100)).toEqual(refusal);
	});

	it("refuses a move to the source itself", () => {
		expect(move(P, P, 100)).toEqual({ refusal: { path: "toCategoryId", code: "same_category" } });
	});
});

describe("copiedAmounts", () => {
	it("copies each amount of a category still an expense category", () => {
		const copied = copiedAmounts({
			categories: [P, A, B, Q, category("Salaire", null, "income")],
			source: amounts({ P: 100_000, A: 30_000, Q: 20_000, Salaire: 5_000, Disparue: 10_000 }),
		});

		expect(Object.fromEntries(copied)).toEqual({ P: 100_000, A: 30_000, Q: 20_000 });
	});

	it("lifts a parent to the children re-parented under it since", () => {
		const copied = copiedAmounts({
			categories: [P, category("C", "P")],
			source: amounts({ P: 20_000, C: 30_000 }),
		});

		expect(Object.fromEntries(copied)).toEqual({ P: 30_000, C: 30_000 });
	});

	it("gives a parent without an amount its children's", () => {
		const copied = copiedAmounts({
			categories: [P, A, Q],
			source: amounts({ A: 30_000 }),
		});

		expect(Object.fromEntries(copied)).toEqual({ P: 30_000, A: 30_000 });
	});
});
