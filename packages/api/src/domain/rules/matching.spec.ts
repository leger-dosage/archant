import type { Condition, LeafCondition, Rule, RuleCandidate } from "./matching.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseUnsignedDecimal, toMinorUnits } from "@archant/data/money";
import type { TransactionExtra } from "@archant/data/schema/transactions";

import { compileLabelPattern } from "./label-pattern.ts";
import { matches, planActions } from "./matching.ts";

const candidate = (overrides: Partial<RuleCandidate> = {}): RuleCandidate => ({
	id: "e1",
	accountId: "a",
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	currency: "EUR",
	label: "CB CARREFOUR CITY 12/09",
	notes: null,
	extra: null,
	merchantId: null,
	categoryId: null,
	tagIds: [],
	excluded: false,
	transfer: null,
	expectedTransferAccountId: null,
	lockedFields: {},
	...overrides,
});

const rule = (conditions: Condition[], overrides: Partial<Rule> = {}): Rule => ({
	id: "r1",
	effectiveDate: null,
	conditions,
	actions: [{ type: "set_transaction_category", categoryId: "courses" }],
	...overrides,
});

const label = (operator: "like" | "not_like" | "=" | "!=", value: string): LeafCondition => ({
	type: "transaction_name",
	operator,
	value,
});

const amount = (operator: "=" | ">" | ">=" | "<" | "<=" | "!=", value: string): LeafCondition => {
	const decimal = parseUnsignedDecimal(value);

	if (decimal === null) {
		throw new Error(`Not a decimal: ${value}`);
	}

	return { type: "transaction_amount", operator, value: decimal };
};

const account = (
	operator: "=" | "!=" | "is_null" | "is_not_null",
	id: string | null,
): LeafCondition => ({ type: "transaction_account", operator, id });

const details = (operator: "like" | "=", value: string): LeafCondition => ({
	type: "transaction_details",
	operator,
	value,
});

const matching = (conditions: Condition[], overrides: Partial<RuleCandidate> = {}) =>
	matches(rule(conditions), candidate(overrides));

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

const eur = (minor: number) => ({ amount: toMinorUnits(-minor), currency: "EUR" });
const jpy = (yen: number) => ({ amount: toMinorUnits(-yen), currency: "JPY" });

describe("matches on the amount", () => {
	it("compares the absolute amount, whatever its sign", () => {
		expect(matching([amount(">", "50")], { amount: toMinorUnits(-6000) })).toBe(true);
		expect(matching([amount(">", "50")], { amount: toMinorUnits(6000) })).toBe(true);
		expect(matching([amount(">", "50")], { amount: toMinorUnits(4000) })).toBe(false);
		expect(matching([amount(">", "50")], { amount: toMinorUnits(5000) })).toBe(false);
	});

	// 50 in each currency's minor units: cents for EUR and USD, yen for JPY.
	const fifty = { EUR: 5000, USD: 5000, JPY: 50 } as const;

	describe.each(["EUR", "USD", "JPY"] as const)("on a line in %s, against 50", (currency) => {
		it.each([
			["=", "50", true],
			["=", "51", false],
			[">", "49", true],
			[">", "50", false],
			[">=", "50", true],
			[">=", "51", false],
			["<", "51", true],
			["<", "50", false],
			["<=", "50", true],
			["<=", "49", false],
			["!=", "51", true],
			["!=", "50", false],
		] as const)("%s %s", (operator, value, expected) => {
			const line = { amount: toMinorUnits(-fifty[currency]), currency };

			expect(matching([amount(operator, value)], line)).toBe(expected);
		});
	});

	it("matches a line in any currency, as Sure", () => {
		for (const currency of ["EUR", "USD", "JPY", "XXX"]) {
			const line = { amount: toMinorUnits(currency === "JPY" ? -60 : -6000), currency };

			expect(matching([amount(">", "50")], line)).toBe(true);
		}
	});

	it("compares a value with more decimals than the line's currency without rounding either", () => {
		expect(matching([amount("<", "12.345")], eur(1235))).toBe(false);
		expect(matching([amount("<", "12.345")], eur(1234))).toBe(true);
		expect(matching([amount("=", "12.50")], eur(1250))).toBe(true);
		expect(matching([amount("=", "50.5")], jpy(50))).toBe(false);
		expect(matching([amount("=", "50.5")], jpy(51))).toBe(false);
		expect(matching([amount("!=", "50.5")], jpy(50))).toBe(true);
		expect(matching([amount("!=", "50.5")], jpy(51))).toBe(true);
		expect(matching([amount(">", "50.5")], jpy(51))).toBe(true);
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
		conditions: [label("like", "boulangerie"), amount("=", "10")],
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

		expect(matches(dated, candidate({ date: "2026-08-31" }))).toBe(false);
		expect(matches(dated, candidate({ date: "2026-09-01" }))).toBe(true);
		expect(matches(rule([]), candidate({ date: "2000-01-01" }))).toBe(true);
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

const notes = (operator: "like" | "not_like" | "=" | "!=", value: string): LeafCondition => ({
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

const notAmazon = (type: "transaction_merchant" | "transaction_category"): LeafCondition => ({
	type,
	operator: "!=",
	id: "amazon",
});

const isSet = (type: "transaction_merchant" | "transaction_category"): LeafCondition => ({
	type,
	operator: "is_not_null",
	id: null,
});

describe("matches on the bank's details", () => {
	const noDetails: LeafCondition = { type: "transaction_details", operator: "is_null" };
	const abroad = {
		extra: {
			enable_banking: {
				fx_rate: "1.0849",
				fx_unit_currency: "USD",
				merchant_category_code: "5411",
				pending: true as const,
			},
		},
	};

	it("contains a value, case aside, with « Contient »", () => {
		expect(matching([details("like", "usd")], abroad)).toBe(true);
		expect(matching([details("like", "541")], abroad)).toBe(true);
		expect(matching([details("like", "5812")], abroad)).toBe(false);
	});

	it("contains a value, case kept, with « Égal à », as Sure's LIKE '%value%'", () => {
		expect(matching([details("=", "USD")], abroad)).toBe(true);
		expect(matching([details("=", "usd")], abroad)).toBe(false);
		expect(matching([details("=", "1.08")], abroad)).toBe(true);
	});

	it("never matches a word that only names a key, nor a boolean", () => {
		expect(matching([details("like", "merchant")], abroad)).toBe(false);
		expect(matching([details("like", "enable_banking")], abroad)).toBe(false);
		expect(matching([details("like", "true")], abroad)).toBe(false);
	});

	it("reads string and number values at any depth, as `strict $.**`", () => {
		// Wider than Enable Banking's strings, as Sure's walk reads any provider's shape.
		const extra = z
			.custom<TransactionExtra>()
			.parse(JSON.parse('{"enable_banking":{"rates":[{"value":1.5},"EUR"]}}'));

		expect(matching([details("like", "1.5")], { extra })).toBe(true);
		expect(matching([details("like", "eur")], { extra })).toBe(true);
	});

	it("is empty without details, or with an empty object, and only then", () => {
		expect(matching([noDetails])).toBe(true);
		expect(matching([noDetails], { extra: {} })).toBe(true);
		expect(matching([noDetails], abroad)).toBe(false);
	});

	it("leaves a line without details to « Est vide » alone, as a hand-typed one", () => {
		expect(matching([details("like", "5411")])).toBe(false);
		expect(matching([details("=", "5411")])).toBe(false);
	});
});

describe("Sure's negative and empty operators", () => {
	const notEmpty: LeafCondition = { type: "transaction_notes", operator: "is_not_null" };

	it("does not contain, on the label and on notes, an empty field included", () => {
		expect(matching([label("not_like", "carrefour")])).toBe(false);
		expect(matching([label("not_like", "auchan")])).toBe(true);
		expect(matching([notes("not_like", "cadeau")], { notes: "Un CADEAU" })).toBe(false);
		expect(matching([notes("not_like", "cadeau")], { notes: "Loyer" })).toBe(true);
		expect(matching([notes("not_like", "cadeau")])).toBe(true);
	});

	it("is different from the whole text, an empty field included, as IS DISTINCT FROM", () => {
		expect(matching([label("!=", "Loyer")], { label: "Loyer" })).toBe(false);
		expect(matching([label("!=", "Loyer")], { label: "loyer" })).toBe(true);
		expect(matching([notes("!=", "Cadeau")], { notes: " Cadeau" })).toBe(false);
		expect(matching([notes("!=", "Cadeau")], { notes: "Loyer" })).toBe(true);
		expect(matching([notes("!=", "Cadeau")])).toBe(true);
	});

	it("is not empty, on notes and on the label", () => {
		expect(matching([notEmpty])).toBe(false);
		expect(matching([notEmpty], { notes: "Cadeau" })).toBe(true);
		expect(matching([{ type: "transaction_name", operator: "is_not_null" }])).toBe(true);
		expect(matching([{ type: "transaction_name", operator: "is_null" }])).toBe(false);
	});

	it("is a different merchant or category, none included", () => {
		expect(matching([notAmazon("transaction_merchant")], { merchantId: "amazon" })).toBe(false);
		expect(matching([notAmazon("transaction_merchant")], { merchantId: "fnac" })).toBe(true);
		expect(matching([notAmazon("transaction_merchant")])).toBe(true);
		expect(matching([notAmazon("transaction_category")], { categoryId: "amazon" })).toBe(false);
		expect(matching([notAmazon("transaction_category")])).toBe(true);
	});

	it("is a different deleted row for every row, since none holds it", () => {
		const deleted: LeafCondition = { type: "transaction_category", operator: "!=", id: null };

		expect(matching([deleted])).toBe(true);
		expect(matching([deleted], { categoryId: "food" })).toBe(true);
		expect(matching([account("!=", null)])).toBe(true);
	});

	it("has a merchant or a category with « N'est pas vide »", () => {
		expect(matching([isSet("transaction_merchant")])).toBe(false);
		expect(matching([isSet("transaction_merchant")], { merchantId: "amazon" })).toBe(true);
		expect(matching([isSet("transaction_category")])).toBe(false);
		expect(matching([isSet("transaction_category")], { categoryId: "food" })).toBe(true);
	});

	it("reads an account as never empty, as Sure's entries.account_id", () => {
		expect(matching([account("!=", "a")])).toBe(false);
		expect(matching([account("!=", "b")])).toBe(true);
		expect(matching([account("is_null", null)])).toBe(false);
		expect(matching([account("is_not_null", null)])).toBe(true);
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

	it("calls the outflow of a loan payment a transfer, as Sure's `TransactionType` condition, where it was an expense", () => {
		const loanPayment = {
			amount: toMinorUnits(-1000),
			transfer: { kind: "loan_payment" as const },
		};

		expect(matching([type("expense")], loanPayment)).toBe(false);
		expect(matching([type("transfer")], loanPayment)).toBe(true);
	});
});

const withActions = (actions: Rule["actions"], conditions: Condition[] = [], id = "r1"): Rule => ({
	id,
	effectiveDate: null,
	conditions,
	actions,
});

const plan = (rules: Rule[], candidates: RuleCandidate[] = [candidate()], maxTags = 20) => [
	...planActions(rules, candidates, maxTags).plan,
];

const tallies = (rules: Rule[], candidates: RuleCandidate[]) =>
	planActions(rules, candidates, 20).perRule;

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
					{ type: "set_transaction_tags", tagIds: ["achats"] },
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
				[{ type: "set_transaction_tags", tagIds: ["achats"] }],
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
				{ type: "set_transaction_tags", tagIds: ["achats"] },
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
			lockedFields: { category: 1, merchant: 1, tags: 1, label: 1, excluded: 1 },
		});

		// Rules add no lock: the transfer action has none to respect.
		expect(plan(rules, [locked])).toEqual([["e1", { expectedTransferAccountId: "livret" }]]);
	});

	it("adds a tag beside the others, once, and skips it at the cap", () => {
		const addB = withActions([{ type: "set_transaction_tags", tagIds: ["b"] }]);

		expect(plan([addB], [candidate({ tagIds: ["a"] })])).toEqual([["e1", { addTagIds: ["b"] }]]);
		expect(plan([addB], [candidate({ tagIds: ["a", "b"] })])).toEqual([]);
		expect(plan([addB], [candidate({ tagIds: ["a", "c"] })], 2)).toEqual([]);
	});

	it("adds every tag of one action after the row's own, keeping those it holds", () => {
		const addAB = withActions([{ type: "set_transaction_tags", tagIds: ["a", "b"] }]);

		expect(plan([addAB], [candidate({ tagIds: ["c"] })])).toEqual([
			["e1", { addTagIds: ["a", "b"] }],
		]);
		expect(plan([addAB], [candidate({ tagIds: ["b"] })])).toEqual([["e1", { addTagIds: ["a"] }]]);
		expect(plan([addAB], [candidate({ tagIds: ["a", "b"] })])).toEqual([]);
		expect(plan([addAB], [candidate({ tagIds: ["c"], lockedFields: { tags: 1 } })])).toEqual([]);
		// One place left: the first tag takes it.
		expect(plan([addAB], [candidate({ tagIds: ["c"] })], 2)).toEqual([
			["e1", { addTagIds: ["a"] }],
		]);
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
							{ type: "set_transaction_tags", tagIds: [] },
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

const replacing = (
	pattern: string,
	replacement: string,
	id = "r1",
	conditions: Condition[] = [],
) => {
	const compiled = compileLabelPattern(pattern);

	if (compiled === null) {
		throw new Error(`${pattern} does not compile`);
	}

	return withActions(
		[{ type: "replace_in_transaction_name", pattern: compiled, replacement }],
		conditions,
		id,
	);
};

describe("planActions' replacement in the label", () => {
	it("rewrites the label of a card terminal line", () => {
		expect(
			plan(
				[replacing("\\\\", " ")],
				[candidate({ label: "LECLERC SANS CONTAC\\ANCENIS-SAINT\\ FR" })],
			),
		).toEqual([["e1", { label: "LECLERC SANS CONTAC ANCENIS-SAINT FR" }]]);
	});

	it("plans nothing where the pattern does not match, and counts it as matched only", () => {
		const rules = [replacing("^CARTE ", "")];
		const rows = [candidate({ label: "CARTE PICARD" }), candidate({ id: "e2", label: "IKEA" })];

		expect(plan(rules, rows)).toEqual([["e1", { label: "PICARD" }]]);
		expect(tallies(rules, rows)).toEqual([{ ruleId: "r1", matched: 2, changed: 1 }]);
	});

	it("leaves a locked label alone", () => {
		expect(
			plan(
				[replacing("^CARTE ", "")],
				[candidate({ label: "CARTE PICARD", lockedFields: { label: 1 } })],
			),
		).toEqual([]);
	});

	it("lets a later rule read the label an earlier one wrote, so a prefix and a suffix both go", () => {
		const rules = [
			replacing("^CARTE \\d{2}/\\d{2}/\\d{2} ", "", "r1"),
			replacing("\\s*CB\\*\\d{4}$", "", "r2", [label("like", "picard sa 788 4 cb*")]),
		];

		expect(plan(rules, [candidate({ label: "CARTE 29/09/26 PICARD SA 788 4 CB*2769" })])).toEqual([
			["e1", { label: "PICARD SA 788 4" }],
		]);
	});

	it("applies after a rename of the same rule, in the order of its actions", () => {
		const rename = { type: "set_transaction_name", label: "Amazon" } as const;

		expect(plan([withActions([rename, ...replacing("ama", "AMA").actions])])).toEqual([
			["e1", { label: "AMAzon" }],
		]);
	});
});

describe("planActions' per-rule tallies", () => {
	it("counts matched rows and, among them, those a lock or a value already there leaves alone", () => {
		const courses = withActions(
			[{ type: "set_transaction_category", categoryId: "courses" }],
			[label("like", "carrefour")],
		);
		const rows = [
			candidate(),
			candidate({ id: "e2" }),
			candidate({ id: "e3" }),
			candidate({ id: "e4", categoryId: "loisirs", lockedFields: { category: null } }),
			candidate({ id: "e5", categoryId: "courses" }),
			candidate({ id: "e6", label: "Loyer" }),
		];

		expect(tallies([courses], rows)).toEqual([{ ruleId: "r1", matched: 5, changed: 3 }]);
		expect(plan([courses], rows)).toHaveLength(3);
	});

	it("counts each row any rule matched once, changed or not, and none no rule reaches", () => {
		const rules = [
			withActions([{ type: "set_transaction_category", categoryId: "courses" }]),
			withActions([{ type: "set_transaction_merchant", merchantId: "amazon" }], [], "r2"),
		];
		const rows = [
			candidate(),
			candidate({ id: "e2", categoryId: "courses", merchantId: "amazon" }),
		];

		expect(planActions(rules, rows, 20).matched).toBe(2);
		expect(planActions([withActions([], [label("like", "nothing")])], rows, 20).matched).toBe(0);
	});

	it("tallies a rule against what earlier rules planned, one tally per rule in order", () => {
		const rules = [
			withActions(
				[{ type: "set_transaction_merchant", merchantId: "amazon" }],
				[label("like", "amzn")],
			),
			withActions(
				[{ type: "set_transaction_tags", tagIds: ["achats"] }],
				[reference("transaction_merchant", "amazon")],
				"r2",
			),
			withActions([{ type: "exclude_transaction" }], [label("like", "nothing")], "r3"),
		];
		const rows = [
			candidate({ label: "AMZN Mktp" }),
			candidate({ id: "e2", label: "Amazon", merchantId: "amazon", tagIds: ["achats"] }),
		];

		expect(tallies(rules, rows)).toEqual([
			{ ruleId: "r1", matched: 1, changed: 1 },
			{ ruleId: "r2", matched: 2, changed: 1 },
			{ ruleId: "r3", matched: 0, changed: 0 },
		]);
	});

	it("counts a row a later rule overwrites once in the plan, and once for each rule", () => {
		const rules = [
			withActions([{ type: "set_transaction_category", categoryId: "courses" }]),
			withActions([{ type: "set_transaction_category", categoryId: "loisirs" }], [], "r2"),
		];

		expect(tallies(rules, [candidate()])).toEqual([
			{ ruleId: "r1", matched: 1, changed: 1 },
			{ ruleId: "r2", matched: 1, changed: 1 },
		]);
		expect(plan(rules, [candidate()])).toEqual([["e1", { categoryId: "loisirs" }]]);
	});
});
