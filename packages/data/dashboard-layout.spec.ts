import { describe, expect, it } from "vitest";

import { keepHiddenInOrder, mergeLayout, resolveLayout } from "./dashboard-layout.ts";
import { DEFAULT_DASHBOARD_ORDER } from "./dashboard-sections.ts";

describe("resolveLayout", () => {
	it("reads Sure's default for a user who stored nothing", () => {
		const layout = resolveLayout(null);

		expect(layout.sectionOrder).toEqual([
			"cashflow_sankey",
			"outflows_donut",
			"net_worth_chart",
			"balance_sheet",
			"money_flow",
			"spending_trend",
			"investment_summary",
			"goals",
		]);
		expect(layout.hiddenSections).toEqual([]);
		expect(Object.values(layout.collapsedSections).every((collapsed) => !collapsed)).toBe(true);
		expect(layout.sectionLayout.cashflow_sankey).toEqual({ height: "auto", colSpan: "full" });
		expect(layout.sectionLayout.net_worth_chart).toEqual({ height: "auto", colSpan: "single" });
	});

	it("drops a stored key the code no longer knows", () => {
		const layout = resolveLayout({
			sectionOrder: ["insights_feed", "balance_sheet"],
			hiddenSections: ["insights_feed"],
			collapsedSections: { insights_feed: true },
			sectionLayout: { insights_feed: { colSpan: "full" } },
		});

		expect(layout.sectionOrder).not.toContain("insights_feed");
		expect(layout.hiddenSections).toEqual([]);
		expect(Object.keys(layout.collapsedSections)).not.toContain("insights_feed");
		expect(Object.keys(layout.sectionLayout)).not.toContain("insights_feed");
	});

	it("appends a key the stored order misses, in the default order", () => {
		const layout = resolveLayout({ sectionOrder: ["goals", "balance_sheet"] });

		expect(layout.sectionOrder).toEqual([
			"goals",
			"balance_sheet",
			...DEFAULT_DASHBOARD_ORDER.filter((key) => key !== "goals" && key !== "balance_sheet"),
		]);
	});

	it("ignores a stored size the guardrails do not offer", () => {
		const layout = resolveLayout({
			sectionLayout: {
				outflows_donut: { colSpan: "full" },
				balance_sheet: { height: "tall" },
				net_worth_chart: { height: "tall", colSpan: "full" },
			},
		});

		expect(layout.sectionLayout.outflows_donut.colSpan).toBe("single");
		expect(layout.sectionLayout.balance_sheet.height).toBe("auto");
		expect(layout.sectionLayout.net_worth_chart).toEqual({ height: "tall", colSpan: "full" });
	});
});

describe("keepHiddenInOrder", () => {
	// Sure's `test "update_dashboard_preferences keeps hidden sections in place"`.
	it("puts a hidden widget back after the one it followed", () => {
		const previous = ["cashflow_sankey", "money_flow", "outflows_donut", "balance_sheet"];

		expect(
			keepHiddenInOrder(["outflows_donut", "cashflow_sankey", "balance_sheet"], previous, [
				"money_flow",
			]),
		).toEqual(["outflows_donut", "cashflow_sankey", "money_flow", "balance_sheet"]);
	});

	it("puts a hidden widget first when nothing shown preceded it", () => {
		expect(keepHiddenInOrder(["b", "c"], ["a", "b", "c"], ["a"])).toEqual(["a", "b", "c"]);
	});

	it("drops a hidden key the new order names, then puts it back in place", () => {
		expect(keepHiddenInOrder(["c", "a", "b"], ["a", "b", "c"], ["b"])).toEqual(["c", "a", "b"]);
	});
});

describe("mergeLayout", () => {
	it("keeps a widget's height when only its width changes", () => {
		const stored = mergeLayout(null, { sectionLayout: { net_worth_chart: { height: "compact" } } });
		const next = mergeLayout(stored, { sectionLayout: { net_worth_chart: { colSpan: "full" } } });

		expect(next.sectionLayout).toEqual({ net_worth_chart: { height: "compact", colSpan: "full" } });
	});

	it("merges collapsed widgets key by key", () => {
		const stored = mergeLayout(null, { collapsedSections: { balance_sheet: true } });
		const next = mergeLayout(stored, { collapsedSections: { money_flow: true } });

		expect(next.collapsedSections).toEqual({ balance_sheet: true, money_flow: true });
		expect(
			mergeLayout(next, { collapsedSections: { balance_sheet: false } }).collapsedSections,
		).toEqual({ balance_sheet: false, money_flow: true });
	});

	it("hides then shows one widget at a time, leaving another hidden", () => {
		const hidden = mergeLayout(null, { hiddenSections: { money_flow: true, goals: true } });
		const shown = mergeLayout(hidden, { hiddenSections: { money_flow: false } });

		expect(hidden.hiddenSections).toEqual(["money_flow", "goals"]);
		expect(shown.hiddenSections).toEqual(["goals"]);
	});

	it("keeps a hidden widget in place when the order omits it", () => {
		const hidden = mergeLayout(null, { hiddenSections: { money_flow: true } });
		const next = mergeLayout(hidden, {
			sectionOrder: [
				"balance_sheet",
				"cashflow_sankey",
				"outflows_donut",
				"net_worth_chart",
				"spending_trend",
				"investment_summary",
				"goals",
			],
		});

		expect(next.sectionOrder).toEqual([
			"balance_sheet",
			"money_flow",
			"cashflow_sankey",
			"outflows_donut",
			"net_worth_chart",
			"spending_trend",
			"investment_summary",
			"goals",
		]);
	});

	it("drops a stale stored key as it writes", () => {
		const next = mergeLayout(
			{ sectionOrder: ["insights_feed"], hiddenSections: ["insights_feed"] },
			{ collapsedSections: { goals: true } },
		);

		expect(next.sectionOrder).toEqual([]);
		expect(next.hiddenSections).toEqual([]);
	});
});
