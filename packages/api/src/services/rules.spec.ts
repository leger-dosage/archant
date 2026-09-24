import type { RuleInput } from "../schemas/rules.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { ruleConditions, rules } from "@archant/data/schema/rules";
import { tags } from "@archant/data/schema/tags";

import { createTempDatabase } from "../testing/temp-database.ts";
import {
	createRule,
	deleteRule,
	listRules,
	loadEnabledRules,
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
