import { describe, expect, it } from "vitest";

import { mergeReportsLayout, resolveReportsLayout } from "./reports-layout.ts";

describe("resolveReportsLayout", () => {
	it("reads Sure's default order, nothing collapsed, for a user who stored nothing", () => {
		expect(resolveReportsLayout(null)).toEqual({
			sectionOrder: ["trends_insights", "transactions_breakdown", "net_worth"],
			collapsedSections: {
				net_worth: false,
				trends_insights: false,
				transactions_breakdown: false,
			},
		});
		expect(resolveReportsLayout({}).sectionOrder).toEqual([
			"trends_insights",
			"transactions_breakdown",
			"net_worth",
		]);
	});

	it("drops a stored key the code no longer knows and appends the missing ones in base order", () => {
		const layout = resolveReportsLayout({
			sectionOrder: ["foo", "net_worth", "net_worth"],
			collapsedSections: { foo: true, net_worth: true },
		});

		expect(layout.sectionOrder).toEqual(["net_worth", "trends_insights", "transactions_breakdown"]);
		expect(layout.collapsedSections).toEqual({
			net_worth: true,
			trends_insights: false,
			transactions_breakdown: false,
		});
	});
});

describe("mergeReportsLayout", () => {
	it("merges collapsed sections key by key and keeps the stored order", () => {
		const stored = { sectionOrder: ["net_worth"], collapsedSections: { trends_insights: true } };

		expect(mergeReportsLayout(stored, { collapsedSections: { net_worth: true } })).toEqual({
			sectionOrder: ["net_worth"],
			collapsedSections: { trends_insights: true, net_worth: true },
		});
	});

	it("replaces the order and stores nothing for an order never given", () => {
		expect(
			mergeReportsLayout(
				{ sectionOrder: ["trends_insights"] },
				{ sectionOrder: ["transactions_breakdown", "net_worth"] },
			).sectionOrder,
		).toEqual(["transactions_breakdown", "net_worth"]);
		expect(mergeReportsLayout(null, { collapsedSections: { net_worth: false } })).toEqual({
			collapsedSections: { net_worth: false },
		});
	});
});
