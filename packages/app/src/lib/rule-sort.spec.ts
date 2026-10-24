import { describe, expect, it } from "vitest";

import { sortRules } from "./rule-sort.ts";

const rules = [
	{ id: "1", name: "épicerie", updatedAt: 30 },
	{ id: "2", name: null, updatedAt: 10 },
	{ id: "3", name: "Courses", updatedAt: 20 },
	{ id: "4", name: "Banque", updatedAt: 40 },
	{ id: "5", name: "banque", updatedAt: 5 },
];

const ids = (sorted: readonly { id: string }[]) => sorted.map((rule) => rule.id);

describe("sortRules", () => {
	it("sorts by name ignoring case and accents, an unnamed rule last, ties in creation order", () => {
		expect(ids(sortRules(rules, "name", "asc"))).toEqual(["4", "5", "3", "1", "2"]);
	});

	it("reverses the name order, an unnamed rule first, as PostgreSQL's NULL", () => {
		expect(ids(sortRules(rules, "name", "desc"))).toEqual(["2", "1", "3", "4", "5"]);
	});

	it("sorts by the last update either way", () => {
		expect(ids(sortRules(rules, "updated_at", "asc"))).toEqual(["5", "2", "3", "1", "4"]);
		expect(ids(sortRules(rules, "updated_at", "desc"))).toEqual(["4", "1", "3", "2", "5"]);
	});

	it("keeps the creation order between two rules updated at the same instant", () => {
		const tied = [
			{ id: "1", name: "B", updatedAt: 10 },
			{ id: "2", name: "A", updatedAt: 10 },
		];

		expect(ids(sortRules(tied, "updated_at", "asc"))).toEqual(["1", "2"]);
		expect(ids(sortRules(tied, "updated_at", "desc"))).toEqual(["1", "2"]);
	});

	it("reads digits as text, « Règle 10 » before « Règle 9 », as PostgreSQL", () => {
		const numbered = [
			{ id: "9", name: "Règle 9", updatedAt: 0 },
			{ id: "10", name: "Règle 10", updatedAt: 0 },
		];

		expect(ids(sortRules(numbered, "name", "asc"))).toEqual(["10", "9"]);
	});

	it("leaves the list it was given untouched", () => {
		sortRules(rules, "name", "asc");

		expect(ids(rules)).toEqual(["1", "2", "3", "4", "5"]);
	});
});
