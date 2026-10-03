import type { RuleInput } from "../schemas/rules.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { ruleConditions, ruleRuns, rules } from "@archant/data/schema/rules";
import { tags } from "@archant/data/schema/tags";

import { compileLabelPattern } from "../domain/rules/label-pattern.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { ingest } from "./ledger/ingest.ts";
import { ruleCandidates } from "./ledger/rule-plans.ts";
import { loadEnabledRules } from "./rule-reader.ts";
import {
	applyRules,
	createRule,
	deleteRule,
	listRuleRuns,
	listRules,
	previewRules,
	setRuleEnabled,
	updateRule,
} from "./rules.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeAll(async () => {
	temp = await createTempDatabase();
	await temp.db.insert(accounts).values(
		["a1", "a2"].map((id) => ({
			id,
			name: id,
			type: "depository" as const,
			subtype: "checking" as const,
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		})),
	);
	await temp.db.insert(categories).values(
		["courses", "loisirs"].map((id) => ({
			id,
			name: id,
			kind: "expense" as const,
			color: "#e99537",
			icon: "tag" as const,
			createdAt: 0,
			updatedAt: 0,
		})),
	);
	await temp.db
		.insert(merchants)
		.values({ id: "amazon", name: "Amazon", createdAt: 0, updatedAt: 0 });
	await temp.db.insert(tags).values({ id: "achats", name: "Achats", createdAt: 0, updatedAt: 0 });
});

afterAll(async () => {
	await temp.dispose();
});

beforeEach(async () => {
	await temp.db.delete(ruleRuns);
	await temp.db.delete(rules);
});

const action = (value = "courses") => ({ actionType: "set_transaction_category", value });

const grouped: RuleInput = {
	name: "  Courses du samedi ",
	effectiveDate: "2026-09-01",
	conditions: [
		{ conditionType: "transaction_account", operator: "=", value: "a1" },
		{
			conditionType: "compound",
			operator: "or",
			conditions: [
				{ conditionType: "transaction_name", operator: "like", value: " carrefour " },
				{ conditionType: "transaction_amount", operator: "=", value: "10,00" },
			],
		},
	],
	actions: [action()],
};

describe("createRule", () => {
	it("stores the rule enabled, trims values and keeps the amount in minor units", async () => {
		const rule = await createRule(deps(), grouped);

		expect(rule).toEqual({
			id: rule.id,
			name: "Courses du samedi",
			enabled: true,
			effectiveDate: "2026-09-01",
			conditions: [
				{ conditionType: "transaction_account", operator: "=", value: "a1", conditions: [] },
				{
					conditionType: "compound",
					operator: "or",
					value: null,
					conditions: [
						{
							conditionType: "transaction_name",
							operator: "like",
							value: "carrefour",
							conditions: [],
						},
						{ conditionType: "transaction_amount", operator: "=", value: "1000", conditions: [] },
					],
				},
			],
			actions: [{ actionType: "set_transaction_category", value: "courses" }],
		});
		await expect(
			temp.db.all(sql`select count(*) as count from rule_conditions where rule_id = ${rule.id}`),
		).resolves.toEqual([{ count: 4 }]);
	});

	it("gives a blank name and no start date as null", async () => {
		const rule = await createRule(deps(), { name: " ", conditions: [], actions: [action()] });

		expect(rule).toMatchObject({ name: null, effectiveDate: null, conditions: [] });
	});

	it("refuses an unknown account or category on the value that names it", async () => {
		await expect(
			createRule(deps(), {
				conditions: [
					{ conditionType: "transaction_account", operator: "=", value: "nope" },
					{
						conditionType: "compound",
						operator: "and",
						conditions: [{ conditionType: "transaction_account", operator: "=", value: "gone" }],
					},
				],
				actions: [action("nope")],
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [
				{ path: "conditions.0.value", code: "invalid_value" },
				{ path: "conditions.1.conditions.0.value", code: "invalid_value" },
				{ path: "actions.0.value", code: "invalid_value" },
			],
		});
		await expect(listRules(deps())).resolves.toEqual([]);
	});
});

// Story 8.2: the other conditions and actions.
const everyKind: RuleInput = {
	conditions: [
		{ conditionType: "transaction_merchant", operator: "=", value: "amazon" },
		{ conditionType: "transaction_category", operator: "is_null", value: "ignored" },
		{ conditionType: "transaction_tag", operator: "=", value: "achats" },
		{ conditionType: "transaction_notes", operator: "like", value: " cadeau " },
		{ conditionType: "transaction_notes", operator: "is_null" },
		{ conditionType: "transaction_type", operator: "=", value: "expense" },
	],
	actions: [
		{ actionType: "set_transaction_merchant", value: "amazon" },
		{ actionType: "set_transaction_tags", value: "achats" },
		{ actionType: "set_transaction_name", value: " Amazon " },
		{ actionType: "exclude_transaction" },
		{ actionType: "set_as_transfer_or_payment", value: "a2" },
	],
};

describe("createRule with Story 8.2's conditions and actions", () => {
	it("stores `is_null` and an exclusion without a value, and trims the rest", async () => {
		const rule = await createRule(deps(), everyKind);

		expect(rule.conditions.map((condition) => condition.value)).toEqual([
			"amazon",
			null,
			"achats",
			"cadeau",
			null,
			"expense",
		]);
		expect(rule.actions).toEqual([
			{ actionType: "set_transaction_merchant", value: "amazon" },
			{ actionType: "set_transaction_tags", value: "achats" },
			{ actionType: "set_transaction_name", value: "Amazon" },
			{ actionType: "exclude_transaction", value: null },
			{ actionType: "set_as_transfer_or_payment", value: "a2" },
		]);
	});

	it("refuses an unknown merchant, category, tag or account on the value that names it", async () => {
		await expect(
			createRule(deps(), {
				conditions: [
					{ conditionType: "transaction_merchant", operator: "=", value: "nope" },
					{ conditionType: "transaction_category", operator: "=", value: "nope" },
					{ conditionType: "transaction_tag", operator: "=", value: "nope" },
				],
				actions: [
					{ actionType: "set_transaction_merchant", value: "nope" },
					{ actionType: "set_transaction_tags", value: "nope" },
					{ actionType: "set_as_transfer_or_payment", value: "nope" },
				],
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [
				{ path: "conditions.0.value", code: "invalid_value" },
				{ path: "conditions.1.value", code: "invalid_value" },
				{ path: "conditions.2.value", code: "invalid_value" },
				{ path: "actions.0.value", code: "invalid_value" },
				{ path: "actions.1.value", code: "invalid_value" },
				{ path: "actions.2.value", code: "invalid_value" },
			],
		});
	});

	it.each([
		["an empty rename", { actionType: "set_transaction_name", value: "  " }, "too_small"],
		[
			"a rename over 200 characters",
			{ actionType: "set_transaction_name", value: "x".repeat(201) },
			"too_big",
		],
		["a value on an exclusion", { actionType: "exclude_transaction", value: "x" }, "invalid_value"],
		["a missing merchant", { actionType: "set_transaction_merchant" }, "too_small"],
	])("refuses %s on the action's value", async (_label, refused, code) => {
		await expect(createRule(deps(), { conditions: [], actions: [refused] })).rejects.toMatchObject({
			fields: [{ path: "actions.0.value", code }],
		});
	});

	it.each([
		[
			"an unknown type",
			{ conditionType: "transaction_type", operator: "=", value: "refund" },
			"value",
			"invalid_value",
		],
		[
			"notes over 200 characters",
			{ conditionType: "transaction_notes", operator: "=", value: "x".repeat(201) },
			"value",
			"too_big",
		],
		[
			"an empty notes value",
			{ conditionType: "transaction_notes", operator: "like", value: "" },
			"value",
			"too_small",
		],
		[
			"« est vide » on the label",
			{ conditionType: "transaction_name", operator: "is_null" },
			"operator",
			"invalid_value",
		],
	])("refuses %s on the condition", async (_label, condition, field, code) => {
		await expect(
			createRule(deps(), { conditions: [condition], actions: [action()] }),
		).rejects.toMatchObject({ fields: [{ path: `conditions.0.${field}`, code }] });
	});
});

describe("listRules", () => {
	it("lists the rules in creation order", async () => {
		const first = await createRule(deps(), { name: "B", conditions: [], actions: [action()] });
		const second = await createRule(deps(), { name: "A", conditions: [], actions: [action()] });
		await temp.db.update(rules).set({ createdAt: 1 }).where(eq(rules.id, first.id));
		await temp.db.update(rules).set({ createdAt: 2 }).where(eq(rules.id, second.id));

		const list = await listRules(deps());

		expect(list.map((rule) => rule.name)).toEqual(["B", "A"]);
	});
});

describe("updateRule", () => {
	it("replaces the name, start date, conditions and actions, keeping the switch", async () => {
		const rule = await createRule(deps(), grouped);
		await setRuleEnabled(deps(), rule.id, { enabled: false });

		const updated = await updateRule(deps(), rule.id, {
			conditions: [{ conditionType: "transaction_name", operator: "=", value: "Loyer" }],
			actions: [action("loisirs")],
		});

		expect(updated).toEqual({
			id: rule.id,
			name: null,
			enabled: false,
			effectiveDate: null,
			conditions: [
				{ conditionType: "transaction_name", operator: "=", value: "Loyer", conditions: [] },
			],
			actions: [{ actionType: "set_transaction_category", value: "loisirs" }],
		});
		await expect(
			temp.db.all(sql`select count(*) as count from rule_conditions where rule_id = ${rule.id}`),
		).resolves.toEqual([{ count: 1 }]);
	});

	it("answers NOT_FOUND for an unknown rule, on every write", async () => {
		const body = { conditions: [], actions: [action()] };

		await expect(updateRule(deps(), "nope", body)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(setRuleEnabled(deps(), "nope", { enabled: true })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(deleteRule(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteRule", () => {
	it("deletes the rule with its conditions and actions", async () => {
		const rule = await createRule(deps(), grouped);

		await expect(deleteRule(deps(), rule.id)).resolves.toEqual({ id: rule.id });

		await expect(listRules(deps())).resolves.toEqual([]);
		await expect(temp.db.select().from(ruleConditions)).resolves.toEqual([]);
	});
});

describe("loadEnabledRules", () => {
	it("gives nothing without an enabled rule", async () => {
		const rule = await createRule(deps(), grouped);
		await setRuleEnabled(deps(), rule.id, { enabled: false });

		await expect(loadEnabledRules(temp.db)).resolves.toEqual([]);
	});

	it("reads the enabled rules for the evaluator, groups included", async () => {
		const rule = await createRule(deps(), grouped);

		await expect(loadEnabledRules(temp.db)).resolves.toEqual([
			{
				id: rule.id,
				effectiveDate: "2026-09-01",
				conditions: [
					{ type: "transaction_account", operator: "=", accountId: "a1" },
					{
						type: "compound",
						operator: "or",
						conditions: [
							{ type: "transaction_name", operator: "like", value: "carrefour" },
							{ type: "transaction_amount", operator: "=", value: 1000 },
						],
					},
				],
				actions: [{ type: "set_transaction_category", categoryId: "courses" }],
			},
		]);
	});

	it("gives a deleted account or category as null", async () => {
		const rule = await createRule(deps(), {
			conditions: [{ conditionType: "transaction_account", operator: "=", value: "a2" }],
			actions: [action("loisirs")],
		});
		await temp.db
			.update(ruleConditions)
			.set({ value: "deleted-account" })
			.where(eq(ruleConditions.ruleId, rule.id));
		await temp.db.run(sql`update rule_actions set value = 'deleted-category'`);

		await expect(loadEnabledRules(temp.db)).resolves.toMatchObject([
			{
				conditions: [{ type: "transaction_account", accountId: null }],
				actions: [{ categoryId: null }],
			},
		]);
	});

	it("reads Story 8.2's conditions and actions for the evaluator", async () => {
		const rule = await createRule(deps(), everyKind);

		await expect(loadEnabledRules(temp.db)).resolves.toEqual([
			{
				id: rule.id,
				effectiveDate: null,
				conditions: [
					{ type: "transaction_merchant", operator: "=", id: "amazon" },
					{ type: "transaction_category", operator: "is_null", id: null },
					{ type: "transaction_tag", operator: "=", id: "achats" },
					{ type: "transaction_notes", operator: "like", value: "cadeau" },
					{ type: "transaction_notes", operator: "is_null" },
					{ type: "transaction_type", operator: "=", value: "expense" },
				],
				actions: [
					{ type: "set_transaction_merchant", merchantId: "amazon" },
					{ type: "set_transaction_tags", tagId: "achats" },
					{ type: "set_transaction_name", label: "Amazon" },
					{ type: "exclude_transaction" },
					{ type: "set_as_transfer_or_payment", accountId: "a2" },
				],
			},
		]);
	});

	it("gives a deleted merchant, category, tag or account as null", async () => {
		const rule = await createRule(deps(), {
			conditions: [
				{ conditionType: "transaction_merchant", operator: "=", value: "amazon" },
				{ conditionType: "transaction_category", operator: "=", value: "courses" },
				{ conditionType: "transaction_tag", operator: "=", value: "achats" },
			],
			actions: [
				{ actionType: "set_transaction_merchant", value: "amazon" },
				{ actionType: "set_transaction_tags", value: "achats" },
				{ actionType: "set_as_transfer_or_payment", value: "a2" },
			],
		});
		await temp.db
			.update(ruleConditions)
			.set({ value: "deleted" })
			.where(eq(ruleConditions.ruleId, rule.id));
		await temp.db.run(sql`update rule_actions set value = 'deleted'`);

		await expect(loadEnabledRules(temp.db)).resolves.toMatchObject([
			{
				conditions: [{ id: null }, { id: null }, { id: null }],
				actions: [{ merchantId: null }, { tagId: null }, { accountId: null }],
			},
		]);
	});

	it("refuses an action other than an exclusion stored without a value", async () => {
		await createRule(deps(), {
			conditions: [],
			actions: [{ actionType: "set_transaction_name", value: "Amazon" }],
		});
		await temp.db.run(sql`update rule_actions set value = null`);

		await expect(loadEnabledRules(temp.db)).rejects.toThrow(/malformed/u);
	});

	it("refuses a type stored with a value that is no direction", async () => {
		const rule = await createRule(deps(), {
			conditions: [{ conditionType: "transaction_type", operator: "=", value: "income" }],
			actions: [action()],
		});
		await temp.db
			.update(ruleConditions)
			.set({ value: "refund" })
			.where(eq(ruleConditions.ruleId, rule.id));

		await expect(loadEnabledRules(temp.db)).rejects.toThrow(/malformed/u);
	});

	it("refuses a condition stored in a shape the schema never writes", async () => {
		const rule = await createRule(deps(), {
			conditions: [{ conditionType: "compound", operator: "and", conditions: [] }],
			actions: [action()],
		});
		// No check ties a group's operator to it being a sub-condition, so a
		// group can be forced below another by hand.
		const [group] = await temp.db
			.select()
			.from(ruleConditions)
			.where(eq(ruleConditions.ruleId, rule.id));
		await temp.db.insert(ruleConditions).values({
			id: "nested",
			ruleId: rule.id,
			parentId: group?.id ?? null,
			position: 0,
			conditionType: "compound",
			operator: "and",
			value: null,
		});

		await expect(loadEnabledRules(temp.db)).rejects.toThrow(/malformed/u);
	});
});

// Story 8.3. Every test shares one database: each labels its rows with a
// word of its own, so a rule never reaches another test's rows.

async function rowsOf(labels: string[], date = "2026-09-10") {
	const account = await createAccount(
		deps(),
		{
			name: "Compte",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2026-05-01",
		},
		{ origin: "user" },
	);
	const result = await ingest(
		deps(),
		account.id,
		{
			transactions: labels.map((label) => ({
				externalId: null,
				date,
				amount: toMinorUnits(-1000),
				currency: "EUR",
				label,
				reference: null,
				notes: null,
				pending: false,
			})),
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "sync" },
	);

	return result.created;
}

const labelHas = (value: string) => ({
	conditionType: "transaction_name",
	operator: "like",
	value,
});

let ruleClock = 0;

/** A rule created after every earlier one, whatever the clock says. */
async function laterRule(input: RuleInput) {
	const rule = await createRule(deps(), input);
	ruleClock += 1;
	await temp.db.update(rules).set({ createdAt: ruleClock }).where(eq(rules.id, rule.id));

	return rule;
}

/** The rows of `ids`, in that order. */
async function candidatesOf(ids: readonly string[]) {
	const rows = await ruleCandidates(temp.db, null, { activeAccountsOnly: true });

	return ids.map((id) => rows.find((row) => row.id === id));
}

describe("previewRules and applyRules", () => {
	it("rewrite labels with a replacement, on rows already there and on a line imported after", async () => {
		const [terminal = "", plain = ""] = await rowsOf(["BKSL\\ANCENIS\\ FR", "BKSL IKEA"]);
		const rule = await createRule(deps(), {
			conditions: [labelHas("bksl")],
			actions: [{ actionType: "replace_in_transaction_name", value: "\\\\", replacement: " " }],
		});

		await expect(previewRules(deps(), rule.id)).resolves.toMatchObject({ changed: 1 });
		await applyRules(deps(), rule.id);

		const rows = await candidatesOf([terminal, plain]);

		expect(rows.map((row) => row?.label)).toEqual(["BKSL ANCENIS FR", "BKSL IKEA"]);

		// The run keeps the replacement, so a later edit of the rule does not rewrite it.
		await expect(listRuleRuns(deps(), { page: 1, pageSize: 10 })).resolves.toMatchObject({
			items: [
				{
					rule: {
						actions: [
							{ actionType: "replace_in_transaction_name", value: "\\\\", replacement: " " },
						],
					},
				},
			],
		});

		const [later = ""] = await rowsOf(["BKSL\\LILLE\\ FR"]);

		expect((await candidatesOf([later]))[0]?.label).toBe("BKSL LILLE FR");
	});

	it("count and change only rows neither locked nor already there, and record one run", async () => {
		const ids = await rowsOf(Array.from({ length: 6 }, (_, index) => `CB COMPTE1 ${index}`));
		const [locked = "", already = "", , , , other = ""] = ids;
		await updateTransaction(deps(), locked, { categoryId: "loisirs" }, { origin: "user" });
		await updateTransaction(deps(), already, { categoryId: "courses" }, { origin: "rule" });
		await updateTransaction(deps(), other, { label: "Autre" }, { origin: "user" });
		const rule = await createRule(deps(), {
			name: "Courses",
			conditions: [labelHas("compte1")],
			actions: [action()],
		});

		await expect(previewRules(deps(), rule.id)).resolves.toMatchObject({ changed: 3 });
		await expect(listRuleRuns(deps(), { page: 1, pageSize: 10 })).resolves.toMatchObject({
			total: 0,
		});

		const { changed, runs } = await applyRules(deps(), rule.id);

		expect(changed).toBe(3);
		expect(runs).toMatchObject([
			{
				ruleId: rule.id,
				rule: {
					name: "Courses",
					conditions: [
						{
							conditionType: "transaction_name",
							operator: "like",
							value: "compte1",
							conditions: [],
						},
					],
					actions: [{ actionType: "set_transaction_category", value: "courses" }],
				},
				matchedCount: 5,
				changedCount: 3,
			},
		]);
		const rows = await candidatesOf(ids);
		expect(rows.map((row) => row?.categoryId)).toEqual([
			"loisirs",
			"courses",
			"courses",
			"courses",
			"courses",
			null,
		]);
		// No lock added: only the user's edits hold one.
		expect(rows.map((row) => row?.lockedFields.includes("category"))).toEqual([
			true,
			false,
			false,
			false,
			false,
			false,
		]);
		await expect(previewRules(deps(), rule.id)).resolves.toMatchObject({ changed: 0 });
	});

	it("apply a disabled rule from its own menu, leaving its switch off", async () => {
		const [id = ""] = await rowsOf(["CB COMPTE2"]);
		const rule = await createRule(deps(), {
			conditions: [labelHas("compte2")],
			actions: [action()],
		});
		await setRuleEnabled(deps(), rule.id, { enabled: false });

		await expect(applyRules(deps(), rule.id)).resolves.toMatchObject({
			changed: 1,
			runs: [{ changedCount: 1 }],
		});
		await expect(candidatesOf([id])).resolves.toMatchObject([{ categoryId: "courses" }]);
		await expect(listRules(deps())).resolves.toMatchObject([{ enabled: false }]);
	});

	it("apply every enabled rule in order, each seeing the earlier ones, one run each", async () => {
		const [id = "", untouched = ""] = await rowsOf(["AMZN COMPTE3", "COMPTE3 LOYER"]);
		const merchant = await laterRule({
			conditions: [labelHas("amzn compte3")],
			actions: [{ actionType: "set_transaction_merchant", value: "amazon" }],
		});
		const tag = await laterRule({
			conditions: [{ conditionType: "transaction_merchant", operator: "=", value: "amazon" }],
			actions: [{ actionType: "set_transaction_tags", value: "achats" }],
		});
		const disabled = await laterRule({ conditions: [labelHas("compte3")], actions: [action()] });
		await setRuleEnabled(deps(), disabled.id, { enabled: false });

		await expect(previewRules(deps())).resolves.toMatchObject({ changed: 1 });

		const { changed, runs } = await applyRules(deps());

		// One row, changed by both rules: counted once overall, once per run.
		expect(changed).toBe(1);
		expect(runs).toMatchObject([
			{ ruleId: merchant.id, matchedCount: 1, changedCount: 1, position: 0 },
			{ ruleId: tag.id, matchedCount: 1, changedCount: 1, position: 1 },
		]);
		await expect(candidatesOf([id, untouched])).resolves.toMatchObject([
			{ merchantId: "amazon", tagIds: ["achats"], categoryId: null },
			{ merchantId: null, tagIds: [], categoryId: null },
		]);
	});

	it("reach only rows dated on or after the earliest start date", async () => {
		const [may = ""] = await rowsOf(["COMPTE4 MAI"], "2026-05-20");
		const [june = ""] = await rowsOf(["COMPTE4 JUIN"], "2026-06-10");
		const rule = await createRule(deps(), {
			effectiveDate: "2026-06-01",
			conditions: [labelHas("compte4")],
			actions: [action()],
		});

		await expect(previewRules(deps(), rule.id)).resolves.toMatchObject({ changed: 1 });
		await applyRules(deps());
		await expect(candidatesOf([may, june])).resolves.toMatchObject([
			{ categoryId: null },
			{ categoryId: "courses" },
		]);
	});

	it("reach every date when one of the rules applied has no start date", async () => {
		const [may = ""] = await rowsOf(["COMPTE6 MAI"], "2026-05-20");
		const [june = ""] = await rowsOf(["COMPTE7 JUIN"], "2026-06-10");
		await laterRule({
			effectiveDate: "2026-06-01",
			conditions: [labelHas("compte7")],
			actions: [action()],
		});
		await laterRule({ conditions: [labelHas("compte6")], actions: [action("loisirs")] });

		await expect(previewRules(deps())).resolves.toMatchObject({ changed: 2 });
		await expect(applyRules(deps())).resolves.toMatchObject({ changed: 2 });
		await expect(candidatesOf([may, june])).resolves.toMatchObject([
			{ categoryId: "loisirs" },
			{ categoryId: "courses" },
		]);
	});

	it("reach from the earliest of the rules' start dates", async () => {
		const [may = ""] = await rowsOf(["COMPTE8 MAI"], "2026-05-20");
		const [june = ""] = await rowsOf(["COMPTE9 JUIN"], "2026-06-10");
		await laterRule({
			effectiveDate: "2026-06-01",
			conditions: [labelHas("compte9")],
			actions: [action()],
		});
		await laterRule({
			effectiveDate: "2026-05-01",
			conditions: [labelHas("compte8")],
			actions: [action("loisirs")],
		});

		await expect(previewRules(deps())).resolves.toMatchObject({ changed: 2 });
		await expect(applyRules(deps())).resolves.toMatchObject({ changed: 2 });
		await expect(candidatesOf([may, june])).resolves.toMatchObject([
			{ categoryId: "loisirs" },
			{ categoryId: "courses" },
		]);
	});

	it("count nothing and record no run without an enabled rule", async () => {
		const rule = await createRule(deps(), { conditions: [], actions: [action()] });
		await setRuleEnabled(deps(), rule.id, { enabled: false });

		await expect(previewRules(deps())).resolves.toMatchObject({ changed: 0 });
		await expect(applyRules(deps())).resolves.toEqual({ changed: 0, runs: [] });
		await expect(listRuleRuns(deps(), { page: 1, pageSize: 10 })).resolves.toMatchObject({
			total: 0,
		});
	});

	it("answer NOT_FOUND for an unknown rule", async () => {
		await expect(previewRules(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(applyRules(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// Story 16.2: what an assistant previews before it saves or applies.

describe("previewRules on a draft, and its samples", () => {
	it("previews a draft without saving it, giving each changed label's current and new value", async () => {
		const [first = "", second = ""] = await rowsOf([
			"CB CARREFOUR DRAFT1",
			"CB CARREFOUR DRAFT1 B",
		]);

		const preview = await previewRules(deps(), {
			conditions: [labelHas("draft1")],
			actions: [{ actionType: "replace_in_transaction_name", value: "^CB ", replacement: "" }],
		});

		expect(preview.matched).toBe(2);
		expect(preview.changed).toBe(2);
		expect(preview.samples.map((sample) => sample.id).toSorted()).toEqual(
			[first, second].toSorted(),
		);
		const [candidate] = await candidatesOf([first]);
		expect(preview.samples.find((sample) => sample.id === first)).toEqual({
			id: first,
			date: "2026-09-10",
			label: "CB CARREFOUR DRAFT1",
			amount: -1000,
			currency: "EUR",
			accountId: candidate?.accountId,
			changes: { label: { from: "CB CARREFOUR DRAFT1", to: "CARREFOUR DRAFT1" } },
		});
		await expect(listRules(deps())).resolves.toEqual([]);
		await expect(candidatesOf([first])).resolves.toMatchObject([{ label: "CB CARREFOUR DRAFT1" }]);
		await expect(listRuleRuns(deps(), { page: 1, pageSize: 10 })).resolves.toMatchObject({
			total: 0,
		});
	});

	it("refuses a draft as a save would, on the field at fault", async () => {
		await expect(
			previewRules(deps(), {
				conditions: [{ conditionType: "transaction_name", operator: ">", value: "x" }],
				actions: [action()],
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "conditions.0.operator", code: "invalid_value" }],
		});
		await expect(
			previewRules(deps(), { conditions: [], actions: [action("missing")] }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "actions.0.value", code: "invalid_value" }],
		});
	});

	it("counts a locked row as matched, never as changed nor as a sample", async () => {
		const [locked = "", open = ""] = await rowsOf(["DRAFT2 LOCKED", "DRAFT2 OPEN"]);
		await updateTransaction(deps(), locked, { categoryId: "loisirs" }, { origin: "user" });

		const preview = await previewRules(deps(), {
			conditions: [labelHas("draft2")],
			actions: [action()],
		});

		expect(preview).toMatchObject({ matched: 2, changed: 1 });
		expect(preview.samples).toEqual([
			expect.objectContaining({
				id: open,
				changes: { category: { from: null, to: "courses" } },
			}),
		]);
	});

	it("gives at most 20 samples, the most recent first", async () => {
		const older = await rowsOf(
			Array.from({ length: 22 }, (_, index) => `DRAFT3 ${index}`),
			"2026-09-10",
		);
		const [newest = ""] = await rowsOf(["DRAFT3 NEW"], "2026-09-20");

		const preview = await previewRules(deps(), {
			conditions: [labelHas("draft3")],
			actions: [action()],
		});

		expect(preview).toMatchObject({ matched: 23, changed: 23 });
		expect(preview.samples).toHaveLength(20);
		expect(preview.samples[0]?.id).toBe(newest);
		expect(preview.samples.slice(1).every((sample) => older.includes(sample.id))).toBe(true);
	});

	it("gives every kind of field an action changes, with its current and new value", async () => {
		const [id = ""] = await rowsOf(["DRAFT4"]);

		const { samples } = await previewRules(deps(), {
			conditions: [labelHas("draft4")],
			actions: [
				action(),
				{ actionType: "set_transaction_merchant", value: "amazon" },
				{ actionType: "set_transaction_tags", value: "achats" },
				{ actionType: "set_transaction_name", value: "Courses" },
				{ actionType: "exclude_transaction" },
				{ actionType: "set_as_transfer_or_payment", value: "a1" },
			],
		});

		expect(samples).toEqual([
			expect.objectContaining({
				id,
				changes: {
					category: { from: null, to: "courses" },
					merchant: { from: null, to: "amazon" },
					tags: { from: [], to: ["achats"] },
					label: { from: "DRAFT4", to: "Courses" },
					excluded: { from: false, to: true },
					expectedTransferAccount: { from: null, to: "a1" },
				},
			}),
		]);
	});

	it("previews a saved rule by its id and every enabled rule alike, samples included", async () => {
		const [id = ""] = await rowsOf(["DRAFT5"]);
		const rule = await createRule(deps(), {
			conditions: [labelHas("draft5")],
			actions: [action()],
		});

		const byId = await previewRules(deps(), rule.id);

		expect(byId).toMatchObject({ matched: 1, changed: 1, samples: [{ id }] });
		await expect(previewRules(deps())).resolves.toEqual(byId);
	});
});

describe("applyRules with the count a preview gave", () => {
	it("writes nothing and records no run when the count changed, naming the count now", async () => {
		const ids = await rowsOf(["STALE1 A", "STALE1 B", "STALE1 C", "STALE1 D"]);
		const rule = await createRule(deps(), {
			conditions: [labelHas("stale1")],
			actions: [action()],
		});

		await expect(applyRules(deps(), rule.id, 3)).rejects.toMatchObject({
			code: "RULE_PREVIEW_STALE",
			status: 409,
			params: { changed: "4" },
		});
		await expect(candidatesOf(ids)).resolves.toMatchObject(ids.map(() => ({ categoryId: null })));
		await expect(listRuleRuns(deps(), { page: 1, pageSize: 10 })).resolves.toMatchObject({
			total: 0,
		});

		await expect(applyRules(deps(), rule.id, 4)).resolves.toMatchObject({ changed: 4 });
	});

	it("compares with none when no rule is enabled", async () => {
		await expect(applyRules(deps(), undefined, 2)).rejects.toMatchObject({
			code: "RULE_PREVIEW_STALE",
			params: { changed: "0" },
		});
		await expect(applyRules(deps(), undefined, 0)).resolves.toEqual({ changed: 0, runs: [] });
	});
});

describe("listRuleRuns", () => {
	it("pages the runs, latest first, and keeps what ran once the rule changes or goes", async () => {
		const rule = await createRule(deps(), {
			name: "Avant",
			conditions: [labelHas("compte5")],
			actions: [action()],
		});
		const { runs: first } = await applyRules(deps(), rule.id);
		await temp.db.update(ruleRuns).set({ executedAt: 1 });
		const { runs: second } = await applyRules(deps(), rule.id);
		await updateRule(deps(), rule.id, { name: "Après", conditions: [], actions: [action()] });
		await deleteRule(deps(), rule.id);

		await expect(listRuleRuns(deps(), { page: 1, pageSize: 1 })).resolves.toEqual({
			items: [{ ...second[0], ruleId: null }],
			page: 1,
			pageSize: 1,
			total: 2,
		});
		await expect(listRuleRuns(deps(), { page: 2, pageSize: 1 })).resolves.toMatchObject({
			items: [{ id: first[0]?.id, ruleId: null, rule: { name: "Avant" } }],
		});
	});
});

describe("listRuleRuns' order within one application", () => {
	it("lists the runs of one application in the order their rules applied", async () => {
		// One after the other, so each is created after the one before.
		await [1, 2, 3, 4].reduce(async (previous) => {
			await previous;
			await laterRule({ conditions: [labelHas("compte10")], actions: [action()] });
		}, Promise.resolve());

		const { runs } = await applyRules(deps());
		const listed = await listRuleRuns(deps(), { page: 1, pageSize: 10 });

		expect(runs.map((run) => run.ruleId)).toEqual((await listRules(deps())).map((rule) => rule.id));
		expect(listed.items.map((run) => run.ruleId)).toEqual(runs.map((run) => run.ruleId));
		expect(listed.items.map((run) => run.position)).toEqual([0, 1, 2, 3]);
	});
});

// Story 8.4: replace in the label.
const replacing = (value: string | null | undefined, replacement?: string | null) =>
	({
		conditions: [],
		actions: [{ actionType: "replace_in_transaction_name", value, replacement }],
	}) satisfies RuleInput;

describe("a replacement in the label", () => {
	it("stores the pattern and the replacement as typed, spaces included, and returns both", async () => {
		const rule = await createRule(deps(), replacing("^CARTE \\d{2}/\\d{2}/\\d{2} ", " "));

		expect(rule.actions).toEqual([
			{
				actionType: "replace_in_transaction_name",
				value: "^CARTE \\d{2}/\\d{2}/\\d{2} ",
				replacement: " ",
			},
		]);
		await expect(listRules(deps())).resolves.toMatchObject([
			{ id: rule.id, actions: rule.actions },
		]);
	});

	it("takes an empty replacement, which removes what the pattern matched", async () => {
		const rule = await createRule(deps(), replacing("CB\\*\\d{4}$", ""));
		const noReplacement = await createRule(deps(), replacing("-"));

		expect(rule.actions).toMatchObject([{ replacement: "" }]);
		expect(noReplacement.actions).toMatchObject([{ replacement: "" }]);
	});

	it("reads the compiled pattern for the evaluator", async () => {
		await createRule(deps(), replacing("\\\\", " "));

		const [loaded] = await loadEnabledRules(temp.db);

		expect(loaded?.actions).toEqual([
			{
				type: "replace_in_transaction_name",
				pattern: compileLabelPattern("\\\\"),
				replacement: " ",
			},
		]);
	});

	it.each([
		["a missing pattern", replacing(undefined, " "), "actions.0.value", "too_small"],
		["an empty pattern", replacing("", " "), "actions.0.value", "too_small"],
		[
			"a pattern over 200 characters",
			replacing("x".repeat(201), " "),
			"actions.0.value",
			"too_big",
		],
		["an unclosed group", replacing("(", " "), "actions.0.value", "invalid_pattern"],
		["a back reference", replacing("(a)\\1", " "), "actions.0.value", "invalid_pattern"],
		["a lookahead", replacing("(?=a)", " "), "actions.0.value", "invalid_pattern"],
		[
			"a replacement over 200 characters",
			replacing("a", "x".repeat(201)),
			"actions.0.replacement",
			"too_big",
		],
	])("refuses %s", async (_label, input, path, code) => {
		await expect(createRule(deps(), input)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code }],
		});
	});

	it("holds one replacement per rule, as every action type", async () => {
		await expect(
			createRule(deps(), {
				conditions: [],
				actions: [
					{ actionType: "replace_in_transaction_name", value: "a", replacement: "" },
					{ actionType: "replace_in_transaction_name", value: "b", replacement: "" },
				],
			}),
		).rejects.toMatchObject({ fields: [{ path: "actions.1", code: "duplicate_action" }] });
	});

	it("imports a line whose label would hold a backtracking engine at once", async () => {
		await createRule(deps(), replacing("(a+)+$", "x"));
		const started = performance.now();

		const [id = ""] = await rowsOf([`${"a".repeat(199)}!`]);

		expect((await candidatesOf([id]))[0]?.label).toBe(`${"a".repeat(199)}!`);
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it("refuses a replacement on any other action", async () => {
		await expect(
			createRule(deps(), {
				conditions: [],
				actions: [{ actionType: "set_transaction_name", value: "Amazon", replacement: "x" }],
			}),
		).rejects.toMatchObject({ fields: [{ path: "actions.0.replacement", code: "invalid_value" }] });
	});

	it.each(["(", ""])("reads a stored pattern of %j as malformed", async (stored) => {
		await createRule(deps(), replacing("a", " "));
		await temp.db.run(sql`update rule_actions set value = ${stored}`);

		await expect(loadEnabledRules(temp.db)).rejects.toThrow(/malformed/u);
	});
});
