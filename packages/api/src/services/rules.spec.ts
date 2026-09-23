import type { RuleInput } from "../schemas/rules.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { ruleConditions, rules } from "@archant/data/schema/rules";

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
