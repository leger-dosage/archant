import { describe, expect, it } from "vitest";

import {
	filterChips,
	filtersOf,
	hasFilters,
	operationsSearchSchema,
	toApiQuery,
	toTotalsQuery,
	withoutFilter,
} from "./transaction-filters";

const t = (key: string, values?: Record<string, string>) =>
	values === undefined ? key : `${key} ${JSON.stringify(values)}`;

const accounts = new Map([
	["a", "Compte joint"],
	["b", "Carte"],
]);
const categories = new Map([["c", "Courses"]]);
const merchants = new Map([["m", "Carrefour"]]);
const tags = new Map([["t", "Vacances"]]);
const nameOf = {
	account: (id: string) => accounts.get(id),
	category: (id: string) => categories.get(id),
	merchant: (id: string) => merchants.get(id),
	tag: (id: string) => tags.get(id),
};

describe("operationsSearchSchema", () => {
	it("keeps every valid filter", () => {
		expect(
			operationsSearchSchema.parse({
				page: 2,
				account: ["a", "b"],
				from: "2026-09-01",
				to: "2026-09-10",
				status: ["pending"],
				amount: "42,90",
				amountOperator: "greater",
				q: "  carre ",
			}),
		).toEqual({
			page: 2,
			account: ["a", "b"],
			from: "2026-09-01",
			to: "2026-09-10",
			status: ["pending"],
			amount: "42,90",
			amountOperator: "greater",
			q: "carre",
		});
	});

	it("reads numbers the router parsed as JSON back as text", () => {
		expect(operationsSearchSchema.parse({ amount: 40, q: 2024 })).toEqual({
			amount: "40",
			amountOperator: "equal",
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
				status: "booked",
				amount: "5-",
				q: "   ",
			}),
		).toEqual({ to: "2026-09-10" });
		expect(operationsSearchSchema.parse({ amount: "abc", amountOperator: "between" })).toEqual({});
	});

	it("drops the range of an old link, Sure's single amount having replaced it", () => {
		expect(operationsSearchSchema.parse({ amountMin: "40", amountMax: "50", q: "a" })).toEqual({
			q: "a",
		});
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

	it("drops an operator without an amount, which filters nothing", () => {
		expect(operationsSearchSchema.parse({ amountOperator: "less" })).toEqual({
			amountOperator: undefined,
		});
		expect(operationsSearchSchema.parse({ amount: "12", amountOperator: "less" })).toEqual({
			amount: "12",
			amountOperator: "less",
		});
	});

	it("reads a lone status as a list of one, and drops both, an empty list or an unknown one", () => {
		expect(operationsSearchSchema.parse({ status: "confirmed" })).toEqual({
			status: ["confirmed"],
		});
		expect(operationsSearchSchema.parse({ status: ["pending", "pending"] })).toEqual({
			status: ["pending"],
		});
		expect(operationsSearchSchema.parse({ status: ["confirmed", "pending"] })).toEqual({
			status: undefined,
		});
		expect(operationsSearchSchema.parse({ status: [] })).toEqual({});
		expect(operationsSearchSchema.parse({ status: ["pending", "booked"] })).toEqual({});
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

	it("reads a lone merchant as a list of one, and drops an empty list", () => {
		expect(operationsSearchSchema.parse({ merchant: "m" })).toEqual({ merchant: ["m"] });
		expect(operationsSearchSchema.parse({ merchant: ["m", "n"] })).toEqual({
			merchant: ["m", "n"],
		});
		expect(operationsSearchSchema.parse({ merchant: [] })).toEqual({});
	});

	it("reads a lone tag as a list of one, and drops an empty list", () => {
		expect(operationsSearchSchema.parse({ tag: "t" })).toEqual({ tag: ["t"] });
		expect(operationsSearchSchema.parse({ tag: ["t", "u"] })).toEqual({ tag: ["t", "u"] });
		expect(operationsSearchSchema.parse({ tag: [] })).toEqual({});
	});

	it("reads a lone direction as a list of one, drops repeats, and drops an unknown one", () => {
		expect(operationsSearchSchema.parse({ direction: "transfer" })).toEqual({
			direction: ["transfer"],
		});
		expect(operationsSearchSchema.parse({ direction: ["income", "expense", "income"] })).toEqual({
			direction: ["income", "expense"],
		});
		expect(operationsSearchSchema.parse({ direction: ["income", "refund"] })).toEqual({});
		expect(operationsSearchSchema.parse({ direction: [] })).toEqual({});
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
			amount: "20",
			amountOperator: "greater" as const,
			q: "carre",
		};

		expect(withoutFilter(search, "period")).toEqual({
			page: undefined,
			account: ["a"],
			from: undefined,
			to: undefined,
			amount: "20",
			amountOperator: "greater",
			q: "carre",
		});
		expect(withoutFilter(search, "amount")).toMatchObject({
			amount: undefined,
			amountOperator: undefined,
		});
		expect(withoutFilter({ ...search, status: ["pending"] }, "status")).toMatchObject({
			status: undefined,
			amount: "20",
		});
		expect(withoutFilter(search, "account")).toMatchObject({ account: undefined });
		expect(withoutFilter({ ...search, category: ["c"] }, "category")).toMatchObject({
			category: undefined,
			account: ["a"],
		});
		expect(withoutFilter({ ...search, merchant: ["m"] }, "merchant")).toMatchObject({
			merchant: undefined,
			account: ["a"],
		});
		expect(withoutFilter({ ...search, tag: ["t"] }, "tag")).toMatchObject({
			tag: undefined,
			account: ["a"],
		});
		expect(withoutFilter({ ...search, direction: ["transfer"] }, "direction")).toMatchObject({
			direction: undefined,
			account: ["a"],
		});
		expect(withoutFilter(search, "q")).toMatchObject({ q: undefined, account: ["a"] });
	});
});

describe("toTotalsQuery", () => {
	it("sends the filters that are set, and no page", () => {
		expect(toTotalsQuery({})).toEqual({});
		expect(toTotalsQuery({ q: "carre", direction: ["expense"] })).toEqual({
			q: "carre",
			direction: ["expense"],
		});
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
					merchant: ["m"],
					tag: ["t"],
					from: "2026-09-01",
					to: "2026-09-10",
					status: ["confirmed"],
					amount: "20",
					amountOperator: "less",
					q: "carre",
					direction: ["income", "transfer"],
				},
				3,
			),
		).toEqual({
			page: "3",
			account: ["a"],
			category: ["none", "c"],
			merchant: ["m"],
			tag: ["t"],
			from: "2026-09-01",
			to: "2026-09-10",
			status: ["confirmed"],
			amount: "20",
			amountOperator: "less",
			q: "carre",
			direction: ["income", "transfer"],
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

	it("names the merchants, an unknown one included", () => {
		expect(filterChips({ merchant: ["m", "z"] }, nameOf, t)).toEqual([
			{ kind: "merchant", label: "Carrefour, operations.chips.unknownMerchant" },
		]);
	});

	it("names the tags, an unknown one included", () => {
		expect(filterChips({ tag: ["t", "z"] }, nameOf, t)).toEqual([
			{ kind: "tag", label: "Vacances, operations.chips.unknownTag" },
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

	it("labels an amount by its operator, « égal à » when none is given", () => {
		expect(filterChips({ amount: "42,90" }, nameOf, t)).toEqual([
			{ kind: "amount", label: 'operations.chips.amountEqual {"amount":"42,90"}' },
		]);
		expect(filterChips({ amount: "20", amountOperator: "greater" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.amountGreater {"amount":"20"}',
		);
		expect(filterChips({ amount: "20", amountOperator: "less" }, nameOf, t)[0]?.label).toBe(
			'operations.chips.amountLess {"amount":"20"}',
		);
	});

	it("names the status", () => {
		expect(filterChips({ status: ["pending"] }, nameOf, t)).toEqual([
			{ kind: "status", label: "operations.chips.statuses.pending" },
		]);
	});

	it("names the directions", () => {
		expect(filterChips({ direction: ["expense", "transfer"] }, nameOf, t)).toEqual([
			{
				kind: "direction",
				label: "operations.chips.directions.expense, operations.chips.directions.transfer",
			},
		]);
	});

	it("orders the chips as the menu does", () => {
		expect(
			filterChips(
				{
					amount: "1",
					status: ["confirmed"],
					from: "2026-09-01",
					merchant: ["m"],
					tag: ["t"],
					category: ["c"],
					account: ["a"],
					direction: ["income"],
				},
				nameOf,
				t,
			).map((chip) => chip.kind),
		).toEqual([
			"account",
			"category",
			"tag",
			"merchant",
			"period",
			"status",
			"amount",
			"direction",
		]);
	});
});
