import type { Condition, LeafCondition, Rule, RuleCandidate } from "./matching.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { matches, planCategories } from "./matching.ts";

const candidate = (overrides: Partial<RuleCandidate> = {}): RuleCandidate => ({
	id: "e1",
	accountId: "a",
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	currency: "EUR",
	label: "CB CARREFOUR CITY 12/09",
	...overrides,
});

const rule = (conditions: Condition[], overrides: Partial<Rule> = {}): Rule => ({
	id: "r1",
	effectiveDate: null,
	conditions,
	actions: [{ type: "set_transaction_category", categoryId: "courses" }],
	...overrides,
});

const label = (operator: "like" | "=", value: string): LeafCondition => ({
	type: "transaction_name",
	operator,
	value,
});

const amount = (operator: "=" | ">" | ">=" | "<" | "<=" | "!=", value: number): LeafCondition => ({
	type: "transaction_amount",
	operator,
	value: toMinorUnits(value),
});

const account = (operator: "=", accountId: string | null): LeafCondition => ({
	type: "transaction_account",
	operator,
	accountId,
});

const matching = (conditions: Condition[], overrides: Partial<RuleCandidate> = {}) =>
	matches(rule(conditions), candidate(overrides), "EUR");

describe("matches on the label", () => {
	it("contains, case aside, once both sides are squished", () => {
		expect(matching([label("like", " carrefour  city ")])).toBe(true);
		expect(matching([label("like", "carrefour")], { label: "CB  Carrefour\tCity" })).toBe(true);
		expect(matching([label("like", "auchan")])).toBe(false);
	});

	it("counts accents, as Sure's ILIKE does", () => {
		expect(matching([label("like", "électricité")], { label: "PRLV ÉLECTRICITÉ" })).toBe(true);
		expect(matching([label("like", "electricite")], { label: "PRLV ÉLECTRICITÉ" })).toBe(false);
	});

	it("equals the whole label, case included", () => {
		expect(matching([label("=", "Loyer")], { label: "Loyer" })).toBe(true);
		expect(matching([label("=", " Loyer ")], { label: "Loyer  " })).toBe(true);
		expect(matching([label("=", "Loyer")], { label: "loyer" })).toBe(false);
		expect(matching([label("=", "Loyer")], { label: "Loyer septembre" })).toBe(false);
	});
});

describe("matches on the amount", () => {
	it("compares the absolute amount, whatever its sign", () => {
		expect(matching([amount(">", 5000)], { amount: toMinorUnits(-6000) })).toBe(true);
		expect(matching([amount(">", 5000)], { amount: toMinorUnits(6000) })).toBe(true);
		expect(matching([amount(">", 5000)], { amount: toMinorUnits(4000) })).toBe(false);
		expect(matching([amount(">", 5000)], { amount: toMinorUnits(5000) })).toBe(false);
	});

	it.each([
		["=", 5000, true],
		["=", 5001, false],
		[">=", 5000, true],
		[">=", 5001, false],
		["<", 5001, true],
		["<", 5000, false],
		["<=", 5000, true],
		["<=", 4999, false],
		["!=", 5001, true],
		["!=", 5000, false],
	] as const)("%s %i against 50,00", (operator, value, expected) => {
		expect(matching([amount(operator, value)], { amount: toMinorUnits(-5000) })).toBe(expected);
	});

	it("never matches a transaction in another currency", () => {
		expect(matching([amount(">", 5000)], { amount: toMinorUnits(-6000), currency: "USD" })).toBe(
			false,
		);
	});
});

describe("matches on the account", () => {
	it("is the account", () => {
		expect(matching([account("=", "a")])).toBe(true);
		expect(matching([account("=", "b")])).toBe(false);
	});

	it("matches nothing once the account is deleted", () => {
		expect(matching([account("=", null)])).toBe(false);
	});
});

describe("matches with groups", () => {
	const anyOf: Condition = {
		type: "compound",
		operator: "or",
		conditions: [label("like", "boulangerie"), amount("=", 1000)],
	};

	it("needs every top-level condition, and any condition of an `or` group", () => {
		expect(matching([account("=", "a"), anyOf], { label: "BOULANGERIE" })).toBe(true);
		expect(matching([account("=", "a"), anyOf], { amount: toMinorUnits(-1000) })).toBe(true);
		expect(matching([account("=", "a"), anyOf])).toBe(false);
		expect(matching([account("=", "b"), anyOf], { label: "BOULANGERIE" })).toBe(false);
	});

	it("needs every condition of an `and` group", () => {
		const allOf: Condition = { ...anyOf, operator: "and" };

		expect(matching([allOf], { label: "BOULANGERIE", amount: toMinorUnits(-1000) })).toBe(true);
		expect(matching([allOf], { label: "BOULANGERIE" })).toBe(false);
	});

	it("matches everything with an empty group, as Sure does", () => {
		expect(matching([{ type: "compound", operator: "or", conditions: [] }])).toBe(true);
	});
});

describe("matches on the start date", () => {
	it("reaches transactions dated on or after it, and every date without one", () => {
		const dated = rule([], { effectiveDate: "2026-09-01" });

		expect(matches(dated, candidate({ date: "2026-08-31" }), "EUR")).toBe(false);
		expect(matches(dated, candidate({ date: "2026-09-01" }), "EUR")).toBe(true);
		expect(matches(rule([]), candidate({ date: "2000-01-01" }), "EUR")).toBe(true);
	});
});

describe("planCategories", () => {
	it("gives every candidate to a rule without conditions", () => {
		const planned = planCategories(
			[rule([])],
			[candidate(), candidate({ id: "e2", label: "Loyer" })],
			"EUR",
		);

		expect([...planned]).toEqual([
			["e1", "courses"],
			["e2", "courses"],
		]);
	});

	it("lets a later matching rule overwrite an earlier one, and skips candidates no rule reaches", () => {
		const planned = planCategories(
			[
				rule([label("like", "carrefour")]),
				rule([label("like", "city")], {
					id: "r2",
					actions: [{ type: "set_transaction_category", categoryId: "loisirs" }],
				}),
			],
			[
				candidate(),
				candidate({ id: "e2", label: "CARREFOUR MARKET" }),
				candidate({ id: "e3", label: "Loyer" }),
			],
			"EUR",
		);

		expect([...planned]).toEqual([
			["e1", "loisirs"],
			["e2", "courses"],
		]);
	});

	it("keeps an earlier rule's category when a later one names a deleted category", () => {
		const planned = planCategories(
			[
				rule([]),
				rule([], { id: "r2", actions: [{ type: "set_transaction_category", categoryId: null }] }),
			],
			[candidate()],
			"EUR",
		);

		expect([...planned]).toEqual([["e1", "courses"]]);
	});
});
