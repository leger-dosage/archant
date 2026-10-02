import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	buildApp,
	createCategory,
	createMerchant,
	createTag,
	creditAgricole,
	errorBody,
	expense,
	openAccount,
	postTransaction,
	request,
	temp,
	uniqueCategory,
	uploaded,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

// Story 8.1: categorisation rules.

const labelRule = (value: string, categoryId: string) => ({
	conditions: [{ conditionType: "transaction_name", operator: "like", value }],
	actions: [{ actionType: "set_transaction_category", value: categoryId }],
});

const ruleLeaf = (conditionType: string, operator: string, value: string | null) => ({
	conditionType,
	operator,
	value,
});

const categoryAction = (value: string) => ({ actionType: "set_transaction_category", value });

async function categoriesOf(accountId: string) {
	const rows = await temp.db.all<{
		label: string;
		category: string | null;
		origin: string | null;
	}>(
		sql`select t.label as label, t.category_id as category, t.category_origin as origin from transactions t join entries e on e.id = t.entry_id where e.account_id = ${accountId} order by e.date, t.label`,
	);

	return rows;
}

// Story 8.2: the other conditions and actions.

async function detailsOf(accountId: string) {
	return temp.db.all<{
		label: string;
		category: string | null;
		merchant: string | null;
		excluded: number;
		tags: string | null;
	}>(
		sql`select t.label as label, t.category_id as category, t.merchant_id as merchant, t.excluded as excluded, (select group_concat(tag_id) from taggings where transaction_id = t.entry_id) as tags from transactions t join entries e on e.id = t.entry_id where e.account_id = ${accountId} order by e.date, t.label`,
	);
}

async function pairedAccounts(entryId: string) {
	return temp.db.all<{ outflow: string; inflow: string }>(
		sql`select eo.account_id as outflow, ei.account_id as inflow from transfers t join entries eo on eo.id = t.outflow_transaction_id join entries ei on ei.id = t.inflow_transaction_id where t.outflow_transaction_id = ${entryId} or t.inflow_transaction_id = ${entryId}`,
	);
}

const page = async (number: number) =>
	(await request("GET", `/api/rules/runs?page=${number}&pageSize=1`)).body;

describe("rules", () => {
	// A rule reaches every later transaction of this shared database.
	afterEach(async () => {
		await temp.db.run(sql`delete from rule_runs`);
		await temp.db.run(sql`delete from rules`);
	});

	const ruleBody = z.object({
		data: z.object({
			id: z.string(),
			name: z.string().nullable(),
			enabled: z.boolean(),
			conditions: z.array(z.unknown()),
		}),
	});

	async function createRule(body: unknown) {
		const { status, body: created } = await request("POST", "/api/rules", body);

		expect(status).toBe(201);

		return ruleBody.parse(created).data;
	}

	it("creates, lists, replaces, switches off and deletes a rule", async () => {
		const groceries = await createCategory(uniqueCategory("Courses"));
		const leisure = await createCategory(uniqueCategory("Loisirs"));
		const client = testClient(buildApp()).api.rules;

		const created = await client.$post({ json: labelRule("carrefour", groceries.id) });
		expect(created.status).toBe(201);
		const { data: rule } = await created.json();
		expect(rule).toEqual({
			id: rule.id,
			name: null,
			enabled: true,
			effectiveDate: null,
			conditions: [
				{ conditionType: "transaction_name", operator: "like", value: "carrefour", conditions: [] },
			],
			actions: [{ actionType: "set_transaction_category", value: groceries.id }],
		});

		const replaced = await client[":id"].$put({
			param: { id: rule.id },
			json: {
				name: "Sorties",
				effectiveDate: "2026-09-01",
				conditions: [{ conditionType: "transaction_amount", operator: ">=", value: "1 234,5" }],
				actions: [{ actionType: "set_transaction_category", value: leisure.id }],
			},
		});
		expect(replaced.status).toBe(200);
		expect((await replaced.json()).data).toMatchObject({
			name: "Sorties",
			effectiveDate: "2026-09-01",
			conditions: [{ conditionType: "transaction_amount", operator: ">=", value: "123450" }],
			actions: [{ value: leisure.id }],
		});

		const switched = await client[":id"].$patch({
			param: { id: rule.id },
			json: { enabled: false },
		});
		expect((await switched.json()).data.enabled).toBe(false);

		const list = await client.$get();
		expect((await list.json()).data.map((item) => item.id)).toEqual([rule.id]);

		await expect(request("DELETE", `/api/rules/${rule.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: rule.id } },
		});
		expect((await (await client.$get()).json()).data).toEqual([]);
	});

	it.each([
		[
			"no action",
			[ruleLeaf("transaction_name", "like", "x")],
			[],
			[{ path: "actions", code: "action_required" }],
		],
		["two category actions", [], "twice", [{ path: "actions.1", code: "duplicate_action" }]],
		[
			"an empty label",
			[ruleLeaf("transaction_name", "like", "  ")],
			"once",
			[{ path: "conditions.0.value", code: "too_small" }],
		],
		[
			"a missing value",
			[{ conditionType: "transaction_account", operator: "=" }],
			"once",
			[{ path: "conditions.0.value", code: "too_small" }],
		],
		[
			"a negative amount",
			[ruleLeaf("transaction_amount", ">", "-50,00")],
			"once",
			[{ path: "conditions.0.value", code: "invalid_amount" }],
		],
		[
			"an unreadable amount",
			[ruleLeaf("transaction_amount", ">", "50,001")],
			"once",
			[{ path: "conditions.0.value", code: "invalid_amount" }],
		],
		[
			"an operator of another type",
			[ruleLeaf("transaction_name", ">", "x")],
			"once",
			[{ path: "conditions.0.operator", code: "invalid_value" }],
		],
		[
			"a group in a group",
			[
				{
					conditionType: "compound",
					operator: "or",
					conditions: [ruleLeaf("compound", "and", null), ruleLeaf("transaction_name", "like", "")],
				},
			],
			"once",
			[
				{ path: "conditions.0.conditions.0", code: "nested_group" },
				{ path: "conditions.0.conditions.1.value", code: "too_small" },
			],
		],
		[
			"an unknown account",
			[ruleLeaf("transaction_account", "=", "nope")],
			"once",
			[{ path: "conditions.0.value", code: "invalid_value" }],
		],
		["an unknown category", [], "unknown", [{ path: "actions.0.value", code: "invalid_value" }]],
	])("refuses %s with the field", async (_label, conditions, actions, fields) => {
		const groceries = await createCategory(uniqueCategory("Courses"));
		const actionList =
			actions === "once"
				? [categoryAction(groceries.id)]
				: actions === "twice"
					? [categoryAction(groceries.id), categoryAction(groceries.id)]
					: actions === "unknown"
						? [categoryAction("nope")]
						: actions;

		const { status, body } = await request("POST", "/api/rules", {
			conditions,
			actions: actionList,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toEqual({
			code: "VALIDATION_ERROR",
			message: "The request is invalid.",
			fields,
		});
		expect((await request("GET", "/api/rules")).body).toEqual({ data: [] });
	});

	it.each([
		["a name over 100 characters", { name: "x".repeat(101) }, [{ path: "name", code: "too_big" }]],
		[
			"a label over 200 characters",
			{ conditions: [ruleLeaf("transaction_name", "like", "x".repeat(201))] },
			[{ path: "conditions.0.value", code: "too_big" }],
		],
		[
			"51 conditions",
			{ conditions: Array.from({ length: 51 }, () => ruleLeaf("transaction_name", "like", "x")) },
			[{ path: "conditions", code: "too_big" }],
		],
		[
			"a start date that is no date",
			{ effectiveDate: "2026-13-01" },
			[{ path: "effectiveDate", code: "invalid_format" }],
		],
	])("refuses %s with the field", async (_label, overrides, fields) => {
		const groceries = await createCategory(uniqueCategory("Courses"));

		const { status, body } = await request("POST", "/api/rules", {
			conditions: [],
			actions: [categoryAction(groceries.id)],
			...overrides,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual(fields);
	});

	it("clears the start date on a PUT with a null one", async () => {
		const groceries = await createCategory(uniqueCategory("Courses"));
		const rule = await createRule({ ...labelRule("x", groceries.id), effectiveDate: "2026-09-01" });

		const { status, body } = await request("PUT", `/api/rules/${rule.id}`, {
			...labelRule("x", groceries.id),
			effectiveDate: null,
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { effectiveDate: null } });
	});

	it("refuses a body without conditions and a switch that is not a boolean", async () => {
		const { status } = await request("POST", "/api/rules", { actions: [] });
		expect(status).toBe(400);

		const groceries = await createCategory(uniqueCategory("Courses"));
		const rule = await createRule(labelRule("x", groceries.id));
		const patched = await request("PATCH", `/api/rules/${rule.id}`, { enabled: "yes" });
		expect(patched.status).toBe(400);
	});

	it.each([
		// A valid body, so the refusal is the unknown id's and not the body's.
		["PUT", (categoryId: string) => ({ conditions: [], actions: [categoryAction(categoryId)] })],
		["PATCH", () => ({ enabled: true })],
		["DELETE", () => undefined],
	])("answers %s with NOT_FOUND", async (method, bodyFor) => {
		const groceries = await createCategory(uniqueCategory("Courses"));
		const response = await request(method, "/api/rules/nope", bodyFor(groceries.id));

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});

	it("categorises a transaction typed by hand, and leaves it when the rule is off", async () => {
		const account = await openAccount();
		const groceries = await createCategory(uniqueCategory("Courses"));
		const rule = await createRule(labelRule("carrefour", groceries.id));

		await postTransaction(account.id, { ...expense, label: "CB CARREFOUR" });
		await request("PATCH", `/api/rules/${rule.id}`, { enabled: false });
		await postTransaction(account.id, { ...expense, label: "CB CARREFOUR CITY" });

		await expect(categoriesOf(account.id)).resolves.toEqual([
			{ label: "CB CARREFOUR", category: groceries.id, origin: "rule" },
			{ label: "CB CARREFOUR CITY", category: null, origin: null },
		]);
	});

	it("lets the later of two matching rules win", async () => {
		const account = await openAccount();
		const groceries = await createCategory(uniqueCategory("Courses"));
		const leisure = await createCategory(uniqueCategory("Loisirs"));
		await createRule(labelRule("carrefour", groceries.id));
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		await createRule(labelRule("carrefour", leisure.id));

		await postTransaction(account.id, { ...expense, label: "CB CARREFOUR" });

		await expect(categoriesOf(account.id)).resolves.toEqual([
			{ label: "CB CARREFOUR", category: leisure.id, origin: "rule" },
		]);
	});

	it("categorises the lines of a confirmed OFX import it matches, and none at preview", async () => {
		const account = await openAccount();
		const bakery = await createCategory(uniqueCategory("Boulangerie"));
		await createRule(labelRule("boulangerie", bakery.id));
		const preview = await uploaded(account.id, await creditAgricole());
		await expect(categoriesOf(account.id)).resolves.toEqual([]);

		await request("POST", `/api/imports/${preview.id}/confirm`);

		const rows = await categoriesOf(account.id);
		expect(rows).toHaveLength(5);
		expect(rows.filter((row) => row.category === bakery.id).map((row) => row.label)).toEqual([
			"CB BOULANGERIE",
			"CB BOULANGERIE",
		]);
		expect(rows.filter((row) => row.category === null)).toHaveLength(3);
	});

	it("sets the merchant, a tag and the label and excludes the lines of an OFX import, chaining two rules", async () => {
		const account = await openAccount();
		const bakery = await createMerchant(uniqueCategory("Boulangerie"));
		const breakfast = await createTag(uniqueCategory("Petit-déjeuner"));
		await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "boulangerie")],
			actions: [
				{ actionType: "set_transaction_merchant", value: bakery.id },
				{ actionType: "set_transaction_name", value: "Boulangerie du coin" },
				{ actionType: "exclude_transaction" },
			],
		});
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		await createRule({
			conditions: [
				ruleLeaf("transaction_merchant", "=", bakery.id),
				ruleLeaf("transaction_category", "is_null", null),
				ruleLeaf("transaction_tag", "is_null", null),
			],
			actions: [{ actionType: "set_transaction_tags", value: breakfast.id }],
		});
		const preview = await uploaded(account.id, await creditAgricole());

		await request("POST", `/api/imports/${preview.id}/confirm`);

		const rows = await detailsOf(account.id);
		expect(rows.filter((row) => row.merchant === bakery.id)).toEqual([
			{
				label: "Boulangerie du coin",
				category: null,
				merchant: bakery.id,
				excluded: 1,
				tags: breakfast.id,
			},
			{
				label: "Boulangerie du coin",
				category: null,
				merchant: bakery.id,
				excluded: 1,
				tags: breakfast.id,
			},
		]);
		expect(rows.filter((row) => row.excluded === 1)).toHaveLength(2);
		expect(rows.filter((row) => row.tags !== null)).toHaveLength(2);
	});

	it("matches notes and type on a transaction typed by hand, and never renames it", async () => {
		const account = await openAccount();
		const gifts = await createCategory(uniqueCategory("Cadeaux"));
		await createRule({
			conditions: [
				ruleLeaf("transaction_notes", "like", "anniversaire"),
				ruleLeaf("transaction_type", "=", "expense"),
			],
			actions: [categoryAction(gifts.id), { actionType: "set_transaction_name", value: "Cadeau" }],
		});

		await postTransaction(account.id, { ...expense, label: "Fnac", notes: "Anniversaire Léa" });
		await postTransaction(account.id, {
			...expense,
			label: "Remboursement",
			amount: "42,90",
			notes: "Anniversaire Léa",
		});
		await postTransaction(account.id, { ...expense, label: "Sans notes", notes: "" });

		await expect(detailsOf(account.id)).resolves.toMatchObject([
			{ label: "Fnac", category: gifts.id },
			{ label: "Remboursement", category: null },
			{ label: "Sans notes", category: null },
		]);
	});

	it("never rewrites the label of a line typed by hand", async () => {
		const account = await openAccount();
		await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "leclerc")],
			actions: [{ actionType: "replace_in_transaction_name", value: "\\\\", replacement: " " }],
		});

		await postTransaction(account.id, {
			...expense,
			label: "LECLERC SANS CONTAC\\ANCENIS-SAINT\\ FR",
			notes: "",
		});

		await expect(detailsOf(account.id)).resolves.toMatchObject([
			{ label: "LECLERC SANS CONTAC\\ANCENIS-SAINT\\ FR" },
		]);
	});

	it("pairs a line with the one candidate on the account « Virement avec » names", async () => {
		const joint = await openAccount();
		const livret = await openAccount({ name: "Livret A", subtype: "savings" });
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });
		await postTransaction(livret.id, { ...expense, label: "VIR RECU", amount: "777,31" });
		await postTransaction(card.id, { ...expense, label: "REMBOURSEMENT", amount: "777,31" });
		await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "epargne")],
			actions: [{ actionType: "set_as_transfer_or_payment", value: livret.id }],
		});

		await postTransaction(joint.id, { ...expense, label: "VIR EPARGNE", amount: "-777,31" });

		const pairs = await temp.db.all<{ outflow: string; inflow: string; kind: string }>(
			sql`select eo.account_id as outflow, ei.account_id as inflow, t.kind as kind from transfers t join entries eo on eo.id = t.outflow_transaction_id join entries ei on ei.id = t.inflow_transaction_id where eo.account_id = ${joint.id}`,
		);
		expect(pairs).toEqual([{ outflow: joint.id, inflow: livret.id, kind: "internal_move" }]);
	});

	it.each([
		[
			"an empty rename",
			[],
			[{ actionType: "set_transaction_name", value: " " }],
			[{ path: "actions.0.value", code: "too_small" }],
		],
		[
			"a value on an exclusion",
			[],
			[{ actionType: "exclude_transaction", value: "yes" }],
			[{ path: "actions.0.value", code: "invalid_value" }],
		],
		[
			"a pattern RE2 refuses",
			[],
			[{ actionType: "replace_in_transaction_name", value: "(a)\\1", replacement: "" }],
			[{ path: "actions.0.value", code: "invalid_pattern" }],
		],
		[
			"an unknown merchant, tag and account",
			[],
			[
				{ actionType: "set_transaction_merchant", value: "nope" },
				{ actionType: "set_transaction_tags", value: "nope" },
				{ actionType: "set_as_transfer_or_payment", value: "nope" },
			],
			[
				{ path: "actions.0.value", code: "invalid_value" },
				{ path: "actions.1.value", code: "invalid_value" },
				{ path: "actions.2.value", code: "invalid_value" },
			],
		],
		[
			"an unknown merchant, category and tag in conditions",
			[
				ruleLeaf("transaction_merchant", "=", "nope"),
				ruleLeaf("transaction_category", "=", "nope"),
				ruleLeaf("transaction_tag", "=", "nope"),
			],
			[{ actionType: "exclude_transaction" }],
			[
				{ path: "conditions.0.value", code: "invalid_value" },
				{ path: "conditions.1.value", code: "invalid_value" },
				{ path: "conditions.2.value", code: "invalid_value" },
			],
		],
		[
			"an unknown type",
			[ruleLeaf("transaction_type", "=", "refund")],
			[{ actionType: "exclude_transaction" }],
			[{ path: "conditions.0.value", code: "invalid_value" }],
		],
		[
			"« est vide » on the label",
			[ruleLeaf("transaction_name", "is_null", null)],
			[{ actionType: "exclude_transaction" }],
			[{ path: "conditions.0.operator", code: "invalid_value" }],
		],
	])("refuses %s with the field", async (_label, conditions, actions, fields) => {
		const { status, body } = await request("POST", "/api/rules", { conditions, actions });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual(fields);
		expect((await request("GET", "/api/rules")).body).toEqual({ data: [] });
	});

	// Story 8.3: applying rules to existing transactions. Rows are created
	// before the rule, so ingestion leaves them alone; each test labels its
	// rows with a word of its own, since every test shares this database.

	const idBody = z.object({ data: z.object({ id: z.string() }) });
	const previewBody = z.object({ data: z.object({ changed: z.number() }) });
	const applicationBody = z.object({
		data: z.object({
			changed: z.number(),
			runs: z.array(
				z.object({
					ruleId: z.string().nullable(),
					rule: z.object({ name: z.string().nullable() }),
					matchedCount: z.number(),
					changedCount: z.number(),
				}),
			),
		}),
	});

	async function typed(accountId: string, json: Record<string, string | null>) {
		return idBody.parse((await postTransaction(accountId, json)).body).data.id;
	}

	async function previewOf(path: string) {
		const { status, body } = await request("GET", path);

		expect(status).toBe(200);

		return previewBody.parse(body).data.changed;
	}

	async function applied(path: string) {
		const { status, body } = await request("POST", path);

		expect(status).toBe(200);

		return applicationBody.parse(body).data.runs;
	}

	it("counts, then changes, only the rows neither locked nor already there, and records the run", async () => {
		const account = await openAccount();
		const groceries = await createCategory(uniqueCategory("Courses"));
		const leisure = await createCategory(uniqueCategory("Loisirs"));
		await Promise.all(
			[1, 2, 3].map((index) =>
				typed(account.id, { ...expense, label: `CB CARREFOUR ORPHEE ${index}` }),
			),
		);
		const locked = await typed(account.id, { ...expense, label: "CB CARREFOUR ORPHEE 4" });
		const already = await typed(account.id, { ...expense, label: "CB CARREFOUR ORPHEE 5" });
		await request("PATCH", `/api/transactions/${locked}`, { categoryId: leisure.id });
		await temp.db.run(
			sql`update transactions set category_id = ${groceries.id}, category_origin = 'rule' where entry_id = ${already}`,
		);
		const rule = await createRule({ name: "Courses", ...labelRule("orphee", groceries.id) });

		await expect(previewOf(`/api/rules/${rule.id}/preview`)).resolves.toBe(3);
		const { status, body } = await request("POST", `/api/rules/${rule.id}/apply`);
		expect(status).toBe(200);
		expect(applicationBody.parse(body).data).toMatchObject({
			changed: 3,
			runs: [{ ruleId: rule.id, rule: { name: "Courses" }, matchedCount: 5, changedCount: 3 }],
		});

		const rows = await categoriesOf(account.id);
		expect(rows.filter((row) => row.category === groceries.id)).toHaveLength(4);
		expect(rows.filter((row) => row.category === leisure.id)).toEqual([
			{ label: "CB CARREFOUR ORPHEE 4", category: leisure.id, origin: "user" },
		]);
		// Rules add no lock: the rows the rule changed hold none on their category.
		const locks = await temp.db.all<{ locked: string }>(
			sql`select t.locked_fields as locked from transactions t join entries e on e.id = t.entry_id where e.account_id = ${account.id} and t.entry_id != ${locked}`,
		);
		expect(locks.every(({ locked: fields }) => !fields.includes("category"))).toBe(true);
	});

	it("reaches only the rows dated on or after the rule's start date", async () => {
		const account = await openAccount({ openingDate: "2026-05-01" });
		const groceries = await createCategory(uniqueCategory("Courses"));
		await typed(account.id, { ...expense, date: "2026-05-20", label: "CB PERSEE MAI" });
		await typed(account.id, { ...expense, date: "2026-06-10", label: "CB PERSEE JUIN" });
		const rule = await createRule({
			effectiveDate: "2026-06-01",
			...labelRule("persee", groceries.id),
		});

		await expect(previewOf(`/api/rules/${rule.id}/preview`)).resolves.toBe(1);
		await applied(`/api/rules/${rule.id}/apply`);

		await expect(categoriesOf(account.id)).resolves.toEqual([
			{ label: "CB PERSEE MAI", category: null, origin: null },
			{ label: "CB PERSEE JUIN", category: groceries.id, origin: "rule" },
		]);
	});

	it("applies every enabled rule in order, the later seeing the earlier's merchant, one run each", async () => {
		const account = await openAccount();
		const amazon = await createMerchant(uniqueCategory("Amazon"));
		const purchases = await createTag(uniqueCategory("Achats"));
		const groceries = await createCategory(uniqueCategory("Courses"));
		await typed(account.id, { ...expense, label: "AMZN ANDROMEDE" });
		const first = await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "andromede")],
			actions: [{ actionType: "set_transaction_merchant", value: amazon.id }],
		});
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		const second = await createRule({
			conditions: [ruleLeaf("transaction_merchant", "=", amazon.id)],
			actions: [{ actionType: "set_transaction_tags", value: purchases.id }],
		});
		vi.setSystemTime(new Date("2026-09-21T10:00:02Z"));
		const disabled = await createRule(labelRule("andromede", groceries.id));
		await request("PATCH", `/api/rules/${disabled.id}`, { enabled: false });

		await expect(previewOf("/api/rules/preview")).resolves.toBe(1);
		const runs = await applied("/api/rules/apply");

		expect(
			runs.map(({ ruleId, matchedCount, changedCount }) => ({
				ruleId,
				matchedCount,
				changedCount,
			})),
		).toEqual([
			{ ruleId: first.id, matchedCount: 1, changedCount: 1 },
			{ ruleId: second.id, matchedCount: 1, changedCount: 1 },
		]);
		await expect(detailsOf(account.id)).resolves.toMatchObject([
			{ merchant: amazon.id, tags: purchases.id, category: null },
		]);
	});

	it("tags a row already in a transfer on « Type est Virement »", async () => {
		const joint = await openAccount();
		const livret = await openAccount({ name: "Livret A", subtype: "savings" });
		const moved = await createTag(uniqueCategory("Épargne"));
		const outflow = await typed(joint.id, {
			...expense,
			label: "VIR CASSIOPEE",
			amount: "-613,17",
		});
		await typed(livret.id, { ...expense, label: "VIR RECU", amount: "613,17" });
		await expect(pairedAccounts(outflow)).resolves.toHaveLength(1);
		const rule = await createRule({
			conditions: [
				ruleLeaf("transaction_name", "like", "cassiopee"),
				ruleLeaf("transaction_type", "=", "transfer"),
			],
			actions: [{ actionType: "set_transaction_tags", value: moved.id }],
		});

		await applied(`/api/rules/${rule.id}/apply`);

		await expect(detailsOf(joint.id)).resolves.toMatchObject([{ tags: moved.id }]);
	});

	it("pairs an unmatched row with the one candidate on the account « Virement avec » names", async () => {
		const joint = await openAccount();
		const livret = await openAccount({ name: "Livret A", subtype: "savings" });
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });
		// Both inflows first: the outflow arrives with two candidates and stays alone.
		await typed(card.id, { ...expense, label: "REMBOURSEMENT", amount: "521,09" });
		await typed(livret.id, { ...expense, label: "VIR RECU", amount: "521,09" });
		const outflow = await typed(joint.id, { ...expense, label: "VIR ORION", amount: "-521,09" });
		await expect(pairedAccounts(outflow)).resolves.toEqual([]);
		const rule = await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "orion")],
			actions: [{ actionType: "set_as_transfer_or_payment", value: livret.id }],
		});

		await applied(`/api/rules/${rule.id}/apply`);

		await expect(pairedAccounts(outflow)).resolves.toEqual([
			{ outflow: joint.id, inflow: livret.id },
		]);
	});

	it("leaves the row unpaired when the named account holds several candidates", async () => {
		const joint = await openAccount();
		const livret = await openAccount({ name: "Livret A", subtype: "savings" });
		await typed(livret.id, { ...expense, label: "VIR RECU 1", amount: "433,51" });
		await typed(livret.id, { ...expense, label: "VIR RECU 2", amount: "433,51" });
		const outflow = await typed(joint.id, { ...expense, label: "VIR LYRE", amount: "-433,51" });
		const rule = await createRule({
			conditions: [ruleLeaf("transaction_name", "like", "lyre")],
			actions: [{ actionType: "set_as_transfer_or_payment", value: livret.id }],
		});

		await expect(applied(`/api/rules/${rule.id}/apply`)).resolves.toMatchObject([
			{ changedCount: 1 },
		]);
		await expect(pairedAccounts(outflow)).resolves.toEqual([]);
	});

	it("counts nothing and records no run without an enabled rule", async () => {
		const rule = await createRule(
			labelRule("pegase", (await createCategory(uniqueCategory("C"))).id),
		);
		await request("PATCH", `/api/rules/${rule.id}`, { enabled: false });

		await expect(previewOf("/api/rules/preview")).resolves.toBe(0);
		await expect(applied("/api/rules/apply")).resolves.toEqual([]);
		await expect(request("GET", "/api/rules/runs")).resolves.toMatchObject({
			body: { data: { items: [], page: 1, total: 0 } },
		});
	});

	it("pages the runs, the latest first, keeping each once its rule is deleted", async () => {
		const groceries = await createCategory(uniqueCategory("Courses"));
		const rule = await createRule({ name: "Première", ...labelRule("hydre", groceries.id) });
		await applied(`/api/rules/${rule.id}/apply`);
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		await request("PUT", `/api/rules/${rule.id}`, {
			name: "Seconde",
			...labelRule("hydre", groceries.id),
		});
		await applied(`/api/rules/${rule.id}/apply`);
		await request("DELETE", `/api/rules/${rule.id}`);

		await expect(page(1)).resolves.toMatchObject({
			data: { items: [{ ruleId: null, rule: { name: "Seconde" } }], page: 1, pageSize: 1 },
		});
		await expect(page(2)).resolves.toMatchObject({
			data: { items: [{ ruleId: null, rule: { name: "Première" } }], page: 2, pageSize: 1 },
		});
		const { status, body } = await request("GET", "/api/rules/runs?page=0");
		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});

	it.each([
		["GET", "/api/rules/nope/preview"],
		["POST", "/api/rules/nope/apply"],
	])("answers %s %s with NOT_FOUND", async (method, path) => {
		const response = await request(method, path);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});
