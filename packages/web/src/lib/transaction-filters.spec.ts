import { describe, expect, it } from "vitest";

import {
	filterChips,
	filtersOf,
	hasFilters,
	operationsSearchSchema,
	toApiQuery,
	withoutFilter,
} from "./transaction-filters";

const t = (key: string, values?: Record<string, string>) =>
	values === undefined ? key : `${key} ${JSON.stringify(values)}`;

const accounts = new Map([
	["a", "Compte joint"],
	["b", "Carte"],
]);
const categories = new Map([["c", "Courses"]]);
const nameOf = {
	account: (id: string) => accounts.get(id),
	category: (id: string) => categories.get(id),
};

describe("operationsSearchSchema", () => {
	it("keeps every valid filter", () => {
		expect(
			operationsSearchSchema.parse({
				page: 2,
				account: ["a", "b"],
				from: "2026-09-01",
				to: "2026-09-10",
				amountMin: "20",
				amountMax: "42,90",
				q: "  carre ",
			}),
		).toEqual({
			page: 2,
			account: ["a", "b"],
			from: "2026-09-01",
			to: "2026-09-10",
			amountMin: "20",
			amountMax: "42,90",
			q: "carre",
		});
	});

	it("reads numbers the router parsed as JSON back as text", () => {
		expect(operationsSearchSchema.parse({ amountMin: 40, q: 2024 })).toEqual({
			amountMin: "40",
			q: "2024",
		});
	});

	it("drops each invalid param on its own and keeps the others", () => {
		expect(
			operationsSearchSchema.parse({
				page: 0,
				account: [],
				from: "10/09/2026",
				to: "2026-09-10",
				amountMin: "abc",
				amountMax: "-5",
				q: "   ",
			}),
		).toEqual({ to: "2026-09-10" });
	});
});

describe("operationsSearchSchema, across params", () => {
	it("drops an end date before the start, and keeps the start", () => {
		expect(operationsSearchSchema.parse({ from: "2026-09-10", to: "2026-09-01" })).toEqual({
			from: "2026-09-10",
			to: undefined,
		});
		expect(operationsSearchSchema.parse({ from: "2026-09-01", to: "2026-09-01" })).toEqual({
			from: "2026-09-01",
			to: "2026-09-01",
		});
	});

	it("drops a maximum below the minimum, and keeps the minimum", () => {
		expect(operationsSearchSchema.parse({ amountMin: "60", amountMax: "50" })).toEqual({
			amountMin: "60",
			amountMax: undefined,
		});
		expect(operationsSearchSchema.parse({ amountMin: "42,90", amountMax: "42.9" })).toEqual({
			amountMin: "42,90",
			amountMax: "42.9",
		});
	});

	it("reads a lone account id as a list of one", () => {
		expect(operationsSearchSchema.parse({ account: "a" })).toEqual({ account: ["a"] });
	});

	it("reads a lone category as a list of one, and drops an empty list", () => {
		expect(operationsSearchSchema.parse({ category: "none" })).toEqual({ category: ["none"] });
		expect(operationsSearchSchema.parse({ category: ["none", "c"] })).toEqual({
			category: ["none", "c"],
		});
		expect(operationsSearchSchema.parse({ category: [] })).toEqual({});
	});
});

describe("filtersOf and hasFilters", () => {
	it("leaves the page out, which is not a filter", () => {
		expect(filtersOf({ page: 3, q: "loyer" })).toEqual({ q: "loyer" });
		expect(hasFilters(filtersOf({ page: 3 }))).toBe(false);
		expect(hasFilters({ q: "loyer" })).toBe(true);
		expect(hasFilters({ from: undefined, to: "2026-09-01" })).toBe(true);
	});
});

describe("withoutFilter", () => {
	it("removes one filter's params and goes back to the first page", () => {
		const search = {
			page: 2,
			account: ["a"],
			from: "2026-09-01",
			to: "2026-09-10",
			amountMin: "20",
			q: "carre",
		};

		expect(withoutFilter(search, "period")).toEqual({
			page: undefined,
			account: ["a"],
			from: undefined,
			to: undefined,
			amountMin: "20",
			q: "carre",
		});
		expect(withoutFilter(search, "amount")).toMatchObject({
			amountMin: undefined,
			amountMax: undefined,
		});
		expect(withoutFilter(search, "account")).toMatchObject({ account: undefined });
		expect(withoutFilter({ ...search, category: ["c"] }, "category")).toMatchObject({
			category: undefined,
			account: ["a"],
		});
		expect(withoutFilter(search, "q")).toMatchObject({ q: undefined, account: ["a"] });
	});
});

describe("toApiQuery", () => {
	it("sends the page and only the filters that are set", () => {
		expect(toApiQuery({}, 1)).toEqual({ page: "1" });
		expect(
			toApiQuery(
				{
					account: ["a"],
					category: ["none", "c"],
					from: "2026-09-01",
					to: "2026-09-10",
					amountMin: "20",
					amountMax: "50",
					q: "carre",
				},
				3,
			),
		).toEqual({
			page: "3",
			account: ["a"],
			category: ["none", "c"],
			from: "2026-09-01",
			to: "2026-09-10",
			amountMin: "20",
			amountMax: "50",
			q: "carre",
		});
	});
});

describe("filterChips", () => {
	it("is empty without filters, and the text search has no chip", () => {
		expect(filterChips({ q: "loyer" }, nameOf, t)).toEqual([]);
	});

	it("names the accounts, an unknown one included", () => {
		expect(filterChips({ account: ["a", "b", "z"] }, nameOf, t)).toEqual([
			{ kind: "account", label: "Compte joint, Carte, operations.chips.unknownAccount" },
		]);
	});

	it("names the categories, « Sans catégorie » and an unknown one included", () => {
		expect(filterChips({ category: ["none", "c", "z"] }, nameOf, t)).toEqual([
			{
				kind: "category",
				label: "operations.chips.uncategorised, Courses, operations.chips.unknownCategory",
			},
		]);
	});

	it("labels a period by its ends, in French dates", () => {
		expect(filterChips({ from: "2026-09-01", to: "2026-09-10" }, nameOf, t)).toEqual([
			{
				kind: "period",
				label: 'operations.chips.periodBetween {"from":"01/09/2026","to":"10/09/2026"}',
			},
		]);
		expect(filterChips({ from: "2026-09-01" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.periodSince {"from":"01/09/2026"}',
		);
		expect(filterChips({ to: "2026-09-10" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.periodUntil {"to":"10/09/2026"}',
		);
	});

	it("labels an amount range by its bounds", () => {
		expect(filterChips({ amountMin: "20", amountMax: "50" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.amountBetween {"min":"20","max":"50"}',
		);
		expect(filterChips({ amountMin: "20" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.amountAtLeast {"min":"20"}',
		);
		expect(filterChips({ amountMax: "50" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.amountAtMost {"max":"50"}',
		);
	});

	it("orders the chips as the menu does", () => {
		expect(
			filterChips(
				{ amountMin: "1", from: "2026-09-01", category: ["c"], account: ["a"] },
				nameOf,
				t,
			).map((chip) => chip.kind),
		).toEqual(["account", "category", "period", "amount"]);
	});
});
