import type { Condition, LeafCondition, Rule, RuleCandidate } from "./matching.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { matches, planActions } from "./matching.ts";

const candidate = (overrides: Partial<RuleCandidate> = {}): RuleCandidate => ({
	id: "e1",
	accountId: "a",
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	currency: "EUR",
	label: "CB CARREFOUR CITY 12/09",
	notes: null,
	merchantId: null,
	categoryId: null,
	tagIds: [],
	excluded: false,
	transfer: null,
	expectedTransferAccountId: null,
	lockedFields: [],
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

const reference = (
	type: "transaction_merchant" | "transaction_category" | "transaction_tag",
	id: string | null,
): LeafCondition => ({ type, operator: "=", id });

const empty = (
	type: "transaction_merchant" | "transaction_category" | "transaction_tag",
): LeafCondition => ({ type, operator: "is_null", id: null });

describe("matches on the merchant, the category and a tag", () => {
	it("is that merchant, or none with « est vide »", () => {
		expect(matching([reference("transaction_merchant", "amazon")], { merchantId: "amazon" })).toBe(
			true,
		);
		expect(matching([reference("transaction_merchant", "amazon")], { merchantId: "fnac" })).toBe(
			false,
		);
		expect(matching([reference("transaction_merchant", "amazon")])).toBe(false);
		expect(matching([empty("transaction_merchant")])).toBe(true);
		expect(matching([empty("transaction_merchant")], { merchantId: "amazon" })).toBe(false);
	});

	it("is that category only, never one of its children, as Sure", () => {
		expect(matching([reference("transaction_category", "food")], { categoryId: "food" })).toBe(
			true,
		);
		// « Courses » is a child of « Alimentation »: the row sits in the child.
		expect(matching([reference("transaction_category", "food")], { categoryId: "groceries" })).toBe(
			false,
		);
		expect(matching([empty("transaction_category")])).toBe(true);
		expect(matching([empty("transaction_category")], { categoryId: "food" })).toBe(false);
	});

	it("carries the tag among others, or no tag at all with « est vide »", () => {
		expect(matching([reference("transaction_tag", "b")], { tagIds: ["a", "b"] })).toBe(true);
		expect(matching([reference("transaction_tag", "b")], { tagIds: ["a"] })).toBe(false);
		expect(matching([empty("transaction_tag")])).toBe(true);
		expect(matching([empty("transaction_tag")], { tagIds: ["a"] })).toBe(false);
	});

	it("matches nothing once the named row is deleted", () => {
		expect(matching([reference("transaction_merchant", null)])).toBe(false);
		expect(matching([reference("transaction_category", null)])).toBe(false);
		expect(matching([reference("transaction_tag", null)], { tagIds: ["a"] })).toBe(false);
	});
});

const notes = (operator: "like" | "=", value: string): LeafCondition => ({
	type: "transaction_notes",
	operator,
	value,
});

describe("matches on the notes", () => {
	it("compares as the label does", () => {
		expect(matching([notes("like", "rembourser  PAUL")], { notes: "À rembourser paul " })).toBe(
			true,
		);
		expect(matching([notes("=", "Cadeau")], { notes: " Cadeau" })).toBe(true);
		expect(matching([notes("=", "Cadeau")], { notes: "cadeau" })).toBe(false);
		expect(matching([notes("like", "cadeau")])).toBe(false);
	});

	it("is empty without notes", () => {
		const isNull: LeafCondition = { type: "transaction_notes", operator: "is_null" };

		expect(matching([isNull])).toBe(true);
		expect(matching([isNull], { notes: "Cadeau" })).toBe(false);
	});
});

const type = (value: "income" | "expense" | "transfer"): LeafCondition => ({
	type: "transaction_type",
	operator: "=",
	value,
});

describe("matches on the type", () => {
	it("reads the sign of a row in no transfer", () => {
		expect(matching([type("expense")], { amount: toMinorUnits(-1000) })).toBe(true);
		expect(matching([type("expense")], { amount: toMinorUnits(1000) })).toBe(false);
		expect(matching([type("income")], { amount: toMinorUnits(1000) })).toBe(true);
	});

	it("never sees a transfer in a row outside one, as at ingestion", () => {
		expect(matching([type("transfer")])).toBe(false);
		expect(matching([type("transfer")], { transfer: { kind: "internal_move" } })).toBe(true);
	});

	it("calls the outflow of a loan payment an expense, as the list's filter does", () => {
		const loanPayment = {
			amount: toMinorUnits(-1000),
			transfer: { kind: "loan_payment" as const },
		};

		expect(matching([type("expense")], loanPayment)).toBe(true);
		expect(matching([type("transfer")], loanPayment)).toBe(false);
	});
});

const withActions = (actions: Rule["actions"], conditions: Condition[] = [], id = "r1"): Rule => ({
	id,
	effectiveDate: null,
	conditions,
	actions,
});

const plan = (rules: Rule[], candidates: RuleCandidate[] = [candidate()], maxTags = 20) => [
	...planActions(rules, candidates, "EUR", maxTags),
];

describe("planActions", () => {
	it("gives every candidate to a rule without conditions", () => {
		expect(plan([rule([])], [candidate(), candidate({ id: "e2", label: "Loyer" })])).toEqual([
			["e1", { categoryId: "courses" }],
			["e2", { categoryId: "courses" }],
		]);
	});

	it("lets a later matching rule overwrite an earlier one, and skips candidates no rule reaches", () => {
		expect(
			plan(
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
			),
		).toEqual([
			["e1", { categoryId: "loisirs" }],
			["e2", { categoryId: "courses" }],
		]);
	});

	it("keeps an earlier rule's category when a later one names a deleted category", () => {
		expect(
			plan([
				rule([]),
				rule([], { id: "r2", actions: [{ type: "set_transaction_category", categoryId: null }] }),
			]),
		).toEqual([["e1", { categoryId: "courses" }]]);
	});

	it("plans every action of a matching rule", () => {
		expect(
			plan([
				withActions([
					{ type: "set_transaction_merchant", merchantId: "amazon" },
					{ type: "set_transaction_tags", tagId: "achats" },
					{ type: "set_transaction_name", label: "Amazon" },
					{ type: "exclude_transaction" },
					{ type: "set_as_transfer_or_payment", accountId: "livret" },
				]),
			]),
		).toEqual([
			[
				"e1",
				{
					merchantId: "amazon",
					addTagIds: ["achats"],
					label: "Amazon",
					excluded: true,
					expectedTransferAccountId: "livret",
				},
			],
		]);
	});

	it("lets a later rule see what an earlier one planned", () => {
		const rules = [
			withActions(
				[{ type: "set_transaction_merchant", merchantId: "amazon" }],
				[label("like", "amzn")],
			),
			withActions(
				[{ type: "set_transaction_tags", tagId: "achats" }],
				[reference("transaction_merchant", "amazon")],
				"r2",
			),
			withActions(
				[{ type: "set_transaction_name", label: "Amazon" }],
				[empty("transaction_tag")],
				"r3",
			),
		];

		expect(plan(rules, [candidate({ label: "AMZN Mktp" })])).toEqual([
			["e1", { merchantId: "amazon", addTagIds: ["achats"] }],
		]);
	});

	it("drops an action on a locked field, so later rules see the value unchanged", () => {
		const rules = [
			withActions([
				{ type: "set_transaction_category", categoryId: "courses" },
				{ type: "set_transaction_merchant", merchantId: "amazon" },
				{ type: "set_transaction_tags", tagId: "achats" },
				{ type: "set_transaction_name", label: "Amazon" },
				{ type: "exclude_transaction" },
			]),
			withActions(
				[{ type: "set_as_transfer_or_payment", accountId: "livret" }],
				[label("=", "Saisie à la main")],
				"r2",
			),
		];
		const locked = candidate({
			label: "Saisie à la main",
			lockedFields: ["category", "merchant", "tags", "label", "excluded"],
		});

		// Rules add no lock: the transfer action has none to respect.
		expect(plan(rules, [locked])).toEqual([["e1", { expectedTransferAccountId: "livret" }]]);
	});

	it("adds a tag beside the others, once, and skips it at the cap", () => {
		const addB = withActions([{ type: "set_transaction_tags", tagId: "b" }]);

		expect(plan([addB], [candidate({ tagIds: ["a"] })])).toEqual([["e1", { addTagIds: ["b"] }]]);
		expect(plan([addB], [candidate({ tagIds: ["a", "b"] })])).toEqual([]);
		expect(plan([addB], [candidate({ tagIds: ["a", "c"] })], 2)).toEqual([]);
	});

	it("plans nothing for a value the row already holds, or a deleted reference", () => {
		const row = candidate({
			categoryId: "courses",
			merchantId: "amazon",
			excluded: true,
			expectedTransferAccountId: "livret",
		});

		expect(
			plan(
				[
					withActions([
						{ type: "set_transaction_category", categoryId: "courses" },
						{ type: "set_transaction_merchant", merchantId: "amazon" },
						{ type: "set_transaction_name", label: row.label },
						{ type: "exclude_transaction" },
						{ type: "set_as_transfer_or_payment", accountId: "livret" },
					]),
					withActions(
						[
							{ type: "set_transaction_merchant", merchantId: null },
							{ type: "set_transaction_tags", tagId: null },
							{ type: "set_as_transfer_or_payment", accountId: null },
						],
						[],
						"r2",
					),
				],
				[row],
			),
		).toEqual([]);
	});

	it("expects no counterpart on a row in a transfer, nor in the row's own account", () => {
		const expectLivret = withActions([{ type: "set_as_transfer_or_payment", accountId: "livret" }]);

		expect(plan([expectLivret], [candidate({ transfer: { kind: "internal_move" } })])).toEqual([]);
		expect(plan([expectLivret], [candidate({ accountId: "livret" })])).toEqual([]);
	});
});
