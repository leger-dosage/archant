import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { groupByDay, shownOrder } from "./transaction-days";

let next = 0;

const row = (
	date: string,
	minorUnits: number,
	currency = "EUR",
	overrides: {
		id?: string;
		parentEntryId?: string;
		transfer?: { counterpartTransactionId: string } | null;
	} = {},
) => ({
	id: overrides.id ?? `row-${String((next += 1))}`,
	date,
	amount: toMinorUnits(minorUnits),
	currency,
	parentEntryId: overrides.parentEntryId ?? null,
	transfer: overrides.transfer ?? null,
});

/** A side of a transfer whose other side is `counterpart`. */
const side = (id: string, counterpart: string, minorUnits: number, date = "2026-09-20") =>
	row(date, minorUnits, "EUR", { id, transfer: { counterpartTransactionId: counterpart } });

const line = (id: string, parentEntryId: string, minorUnits: number, date = "2026-09-20") =>
	row(date, minorUnits, "EUR", { id, parentEntryId });

/** What a day shows, a split as its parent's id and its lines' ids. */
const shown = (days: ReturnType<typeof groupByDay<ReturnType<typeof row>>>) =>
	days.map((day) => [
		day.date,
		day.entries.map((entry) =>
			entry.kind === "row" ? entry.row.id : [entry.parent.id, entry.children.map((c) => c.id)],
		),
	]);

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
		expect(days.map((day) => day.entries.map((entry) => entry.kind))).toEqual([
			["row", "row"],
			["row"],
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

	it("puts a split's parent where its first line is, its lines below in the order they were created", () => {
		const parent = row("2026-09-20", -10000, "EUR", { id: "parent" });
		// Newest first, as the page sorts them: « c » was created last.
		const days = groupByDay(
			[
				row("2026-09-20", -500, "EUR", { id: "after" }),
				line("c", "parent", -1000),
				line("b", "parent", -3000),
				row("2026-09-20", -700, "EUR", { id: "between" }),
				line("a", "parent", -6000),
				row("2026-09-18", -200, "EUR", { id: "older" }),
			],
			[parent],
		);

		expect(shown(days)).toEqual([
			["2026-09-20", ["after", ["parent", ["a", "b", "c"]], "between"]],
			["2026-09-18", ["older"]],
		]);
		// The parent counts in neither the count nor the subtotal: its lines do.
		expect(days[0]?.items).toHaveLength(5);
		expect(days[0]?.subtotals).toEqual([{ currency: "EUR", amount: -11200 }]);
	});

	it("keeps a line whose parent the page did not send as a row of its own", () => {
		const days = groupByDay([line("a", "missing", -6000), line("b", "missing", -4000)]);

		expect(shown(days)).toEqual([["2026-09-20", ["a", "b"]]]);
	});

	it("shows the parent above the lines a page holds, on each page the split spans", () => {
		const parent = row("2026-09-20", -10000, "EUR", { id: "parent" });

		const first = groupByDay(
			[row("2026-09-20", -1, "EUR", { id: "x" }), line("b", "parent", -4000)],
			[parent],
		);
		const second = groupByDay([line("a", "parent", -6000)], [parent]);

		expect(shown(first)).toEqual([["2026-09-20", ["x", ["parent", ["b"]]]]]);
		expect(shown(second)).toEqual([["2026-09-20", [["parent", ["a"]]]]]);
	});

	it("groups two splits of one day apart", () => {
		const days = groupByDay(
			[line("q", "two", -1), line("b", "one", -2), line("p", "two", -3), line("a", "one", -4)],
			[row("2026-09-20", -7, "EUR", { id: "one" }), row("2026-09-20", -4, "EUR", { id: "two" })],
		);

		expect(shown(days)).toEqual([
			[
				"2026-09-20",
				[
					["two", ["p", "q"]],
					["one", ["a", "b"]],
				],
			],
		]);
	});
});

describe("groupByDay and transfers", () => {
	it("shows a transfer whose two sides the page holds once, as its outflow, and leaves it out of the subtotal", () => {
		// −50 € of groceries beside a −500 € / +500 € loan payment.
		const days = groupByDay([
			row("2026-09-20", -5000, "EUR", { id: "groceries" }),
			side("inflow", "outflow", 50000),
			side("outflow", "inflow", -50000),
		]);

		expect(shown(days)).toEqual([["2026-09-20", ["groceries", "outflow"]]]);
		expect(days[0]?.items).toHaveLength(2);
		expect(days[0]?.subtotals).toEqual([{ currency: "EUR", amount: -5000 }]);
	});

	it("shows an inflow whose outflow is on another page, and never sums it", () => {
		const days = groupByDay([
			row("2026-09-20", -1200, "EUR", { id: "bakery" }),
			side("inflow", "elsewhere", 50000),
		]);

		expect(shown(days)).toEqual([["2026-09-20", ["bakery", "inflow"]]]);
		expect(days[0]?.subtotals).toEqual([{ currency: "EUR", amount: -1200 }]);
	});

	it("keeps both sides of a pair on two days of the page apart, the outflow alone shown", () => {
		const days = groupByDay([
			side("inflow", "outflow", 30000, "2026-09-20"),
			row("2026-09-20", -700, "EUR", { id: "coffee" }),
			side("outflow", "inflow", -30000, "2026-09-17"),
		]);

		expect(shown(days)).toEqual([
			["2026-09-20", ["coffee"]],
			["2026-09-17", ["outflow"]],
		]);
	});

	it("leaves a pending proposal out of the subtotal too", () => {
		// The matcher's proposal is a transfer until the owner rejects it.
		const [day] = groupByDay([
			side("proposed", "elsewhere", -20000),
			row("2026-09-20", -300, "EUR", { id: "bus" }),
		]);

		expect(day?.subtotals).toEqual([{ currency: "EUR", amount: -300 }]);
	});

	it("keeps no subtotal for a day of transfers alone", () => {
		const [day] = groupByDay([side("a", "b", 10000), side("b", "a", -10000), side("c", "z", -400)]);

		expect(day?.items.map((item) => item.id)).toEqual(["b", "c"]);
		expect(day?.subtotals).toEqual([]);
	});
});

describe("shownOrder", () => {
	it("leaves out an inflow the page also shows as its outflow", () => {
		const rows = shownOrder([side("in", "out", 100), side("out", "in", -100)], []);

		expect(rows.map((item) => item.id)).toEqual(["out"]);
	});

	it("lists the rows as the list shows them, a split's lines in their order", () => {
		const rows = shownOrder(
			[row("2026-09-20", -1, "EUR", { id: "x" }), line("b", "p", -2), line("a", "p", -3)],
			[row("2026-09-20", -5, "EUR", { id: "p" })],
		);

		expect(rows.map((item) => item.id)).toEqual(["x", "a", "b"]);
	});
});
