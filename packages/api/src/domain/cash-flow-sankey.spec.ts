import type { CashFlowCategory, CashFlowRow } from "./cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { cashFlowSankey } from "./cash-flow-sankey.ts";
import { grossCashFlow, netCashFlow } from "./cash-flow.ts";

const category = (id: string, color: string, parentId: string | null = null): CashFlowCategory => ({
	id,
	name: id,
	color,
	icon: "tag",
	parentId,
});

const row = (categoryId: string | null, amount: number): CashFlowRow => ({
	categoryId,
	amount: toMinorUnits(amount),
});

const salary = category("Salaire", "#22c55e");
const groceries = category("Courses", "#e99537");
const organic = category("Bio", "#4ea7fc", "Courses");
const rent = category("Loyer", "#805dee");
const all = [salary, groceries, organic, rent];

function sankeyOf(rows: readonly CashFlowRow[]) {
	const gross = grossCashFlow(rows, all);

	return cashFlowSankey(netCashFlow(gross), gross.subcategories, all);
}

const ids = (sankey: ReturnType<typeof sankeyOf>) => sankey.nodes.map((node) => node.id);

/** Each link as `source → target: amount`, by node id. */
const flows = (sankey: ReturnType<typeof sankeyOf>) =>
	sankey.links.map(
		(link) => `${sankey.nodes[link.source]?.id} → ${sankey.nodes[link.target]?.id}: ${link.amount}`,
	);

describe("cashFlowSankey", () => {
	it("flows 3 000 € of income through the centre into 2 000 € of expenses and a 1 000 € surplus, a third of income", () => {
		const sankey = sankeyOf([row("Salaire", 300_000), row("Loyer", -200_000)]);

		expect(flows(sankey)).toEqual([
			"income_Salaire → cash_flow_node: 300000",
			"cash_flow_node → expense_Loyer: 200000",
			"cash_flow_node → surplus_node: 100000",
		]);
		expect(sankey.nodes[0]).toEqual({
			id: "cash_flow_node",
			name: null,
			kind: "cash_flow",
			categoryId: null,
			color: "#10A861",
			amount: 300_000,
			share: 1,
		});
		expect(sankey.nodes.at(-1)).toMatchObject({ kind: "surplus", amount: 100_000, share: 1 / 3 });
		expect(sankey.links.at(-1)?.share).toBe(1 / 3);
		expect(sankey.nodes[1]).toMatchObject({ name: "Salaire", color: "#22c55e", share: 1 });
	});

	it("draws no surplus and no deficit node when expenses exceed income, as Sure", () => {
		const sankey = sankeyOf([row("Salaire", 100_000), row("Loyer", -150_000)]);

		expect(ids(sankey)).toEqual(["cash_flow_node", "income_Salaire", "expense_Loyer"]);
	});

	it("hangs a 120 € sub-category from its −300 € parent, 40 % of it", () => {
		const sankey = sankeyOf([
			row("Salaire", 100_000),
			row("Courses", -18_000),
			row("Bio", -12_000),
		]);

		expect(flows(sankey)).toEqual([
			"income_Salaire → cash_flow_node: 100000",
			"cash_flow_node → expense_Courses: 30000",
			"expense_Courses → expense_sub_Bio: 12000",
			"cash_flow_node → surplus_node: 70000",
		]);
		expect(sankey.nodes.find((node) => node.id === "expense_sub_Bio")).toMatchObject({
			name: "Bio",
			kind: "expense",
			categoryId: "Bio",
			color: "#4ea7fc",
			share: 0.4,
		});
	});

	it("nets a sub-category's refunds against its spending before hanging it", () => {
		const sankey = sankeyOf([row("Courses", -30_000), row("Bio", -12_000), row("Bio", 2_000)]);

		expect(sankey.nodes.find((node) => node.id === "expense_sub_Bio")?.amount).toBe(10_000);
	});

	it("stands a sub-category netted on the other side alone on that side, linked straight to the centre", () => {
		const sankey = sankeyOf([row("Salaire", 100_000), row("Courses", -30_000), row("Bio", 5_000)]);

		expect(flows(sankey)).toEqual([
			"income_Salaire → cash_flow_node: 100000",
			"cash_flow_node → expense_Courses: 25000",
			"income_sub_Bio → cash_flow_node: 5000",
			"cash_flow_node → surplus_node: 75000",
		]);
		// Over the income side it is drawn on, where Sure divides by its parent's side.
		expect(sankey.nodes.find((node) => node.id === "income_sub_Bio")).toMatchObject({
			kind: "income",
			share: 5_000 / 100_000,
		});
	});

	it("drops a sub-category whose parent nets to zero, and one that nets to zero itself", () => {
		const zeroParent = sankeyOf([row("Courses", 12_000), row("Bio", -12_000)]);
		const zeroChild = sankeyOf([row("Courses", -30_000), row("Bio", -4_000), row("Bio", 4_000)]);

		expect(ids(zeroParent)).toEqual(["cash_flow_node"]);
		expect(zeroParent.links).toEqual([]);
		expect(ids(zeroChild)).toEqual(["cash_flow_node", "expense_Courses"]);
	});

	it("keys « Sans catégorie » `uncategorised` in Sure's grey, without a name or a category", () => {
		const sankey = sankeyOf([row(null, 50_000), row(null, -80_000), row("Loyer", -10_000)]);

		expect(sankey.nodes.find((node) => node.id === "expense_uncategorised")).toEqual({
			id: "expense_uncategorised",
			name: null,
			kind: "expense",
			categoryId: null,
			color: "#737373",
			amount: 30_000,
			share: 0.75,
		});
	});

	it("hangs an income sub-category from its parent, flowing towards the centre, in its parent's colour when its own is unknown", () => {
		const bonus = category("Primes", "#22c55e", "Salaire");
		const gross = grossCashFlow([row("Salaire", 200_000), row("Primes", 50_000)], [salary, bonus]);
		const sankey = cashFlowSankey(netCashFlow(gross), gross.subcategories, [salary]);

		expect(flows(sankey)).toEqual([
			"income_Salaire → cash_flow_node: 250000",
			"income_sub_Primes → income_Salaire: 50000",
			"cash_flow_node → surplus_node: 250000",
		]);
		expect(sankey.nodes[2]).toMatchObject({ color: "#22c55e", share: 0.2 });
	});

	it("gives a standalone sub-category no share when its side has no other line, and its parent's colour when its own is unknown", () => {
		const gross = grossCashFlow([row("Courses", -30_000), row("Bio", 5_000)], all);
		const sankey = cashFlowSankey(netCashFlow(gross), gross.subcategories, [groceries]);

		expect(sankey.nodes.find((node) => node.id === "income_sub_Bio")).toMatchObject({
			share: 0,
			color: "#e99537",
		});
	});

	it("keeps the centre alone, without a link, for a period without a counted row", () => {
		const sankey = sankeyOf([]);

		expect(sankey.nodes).toEqual([
			{
				id: "cash_flow_node",
				name: null,
				kind: "cash_flow",
				categoryId: null,
				color: "#10A861",
				amount: 0,
				share: 1,
			},
		]);
		expect(sankey.links).toEqual([]);
	});
});
