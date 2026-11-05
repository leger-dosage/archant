import { describe, expect, it } from "vitest";

import { sankeyNodeHasChildren, zoomSankey } from "@/lib/sankey-zoom";

// Salaire → centre → Courses → Bio, and centre → Loyer.
const graph = {
	nodes: [
		{ id: "cash_flow_node" },
		{ id: "income_salaire" },
		{ id: "expense_courses" },
		{ id: "expense_sub_bio" },
		{ id: "expense_loyer" },
	],
	links: [
		{ source: 1, target: 0 },
		{ source: 0, target: 2 },
		{ source: 2, target: 3 },
		{ source: 0, target: 4 },
	],
};

describe("sankeyNodeHasChildren", () => {
	it("opens the centre and a parent away from the centre, never a leaf", () => {
		expect(sankeyNodeHasChildren(graph, "cash_flow_node")).toBe(true);
		expect(sankeyNodeHasChildren(graph, "expense_courses")).toBe(true);
		expect(sankeyNodeHasChildren(graph, "expense_sub_bio")).toBe(false);
		expect(sankeyNodeHasChildren(graph, "expense_loyer")).toBe(false);
		// An income line opens onto its sources, and Salaire has none.
		expect(sankeyNodeHasChildren(graph, "income_salaire")).toBe(false);
		expect(sankeyNodeHasChildren(graph, "unknown")).toBe(false);
	});
});

describe("zoomSankey", () => {
	it("keeps a parent and its descendants, re-indexed in their order", () => {
		expect(zoomSankey(graph, "expense_courses")).toEqual({
			nodes: [{ id: "expense_courses" }, { id: "expense_sub_bio" }],
			links: [{ source: 0, target: 1 }],
		});
	});

	it("keeps the centre's outflows from the centre, its inflows left out", () => {
		expect(zoomSankey(graph, "cash_flow_node").nodes.map((node) => node.id)).toEqual([
			"cash_flow_node",
			"expense_courses",
			"expense_sub_bio",
			"expense_loyer",
		]);
	});

	it("leaves the graph whole for a leaf", () => {
		expect(zoomSankey(graph, "expense_loyer")).toBe(graph);
	});
});
