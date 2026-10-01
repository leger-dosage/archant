import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	buildApp,
	createTag,
	errorBody,
	expense,
	openAccount,
	ownDatabase,
	postTransaction,
	request,
	tagAll,
	tagList,
	temp,
	uniqueCategory,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

describe("tags", () => {
	it("lists the tags sorted by name, with their transaction counts", async () => {
		const own = await ownDatabase();
		const client = testClient(buildApp(own.db)).api.tags;
		await client.$post({ json: { name: "Vacances" } });
		await client.$post({ json: { name: "Été" } });
		await client.$post({ json: { name: "Anniversaire" } });

		const list = await tagList(own.db);

		expect(list.map((item) => [item.name, item.transactionCount])).toEqual([
			["Anniversaire", 0],
			["Été", 0],
			["Vacances", 0],
		]);
	});

	it("creates a tag, trimming its name", async () => {
		const name = uniqueCategory("Vacances");

		await expect(request("POST", "/api/tags", { name: `  ${name} ` })).resolves.toMatchObject({
			status: 201,
			body: { data: { name, transactionCount: 0 } },
		});
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Vacances");
		await createTag(name);

		const { status, body } = await request("POST", "/api/tags", { name: name.toUpperCase() });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "name", code: "name_taken" }],
		});
	});

	it.each([
		["a blank name", "  ", "too_small"],
		["a name over 60 characters", "x".repeat(61), "too_big"],
	])("refuses %s", async (_label, name, code) => {
		const { status, body } = await request("POST", "/api/tags", { name });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code }]);
	});

	it("renames a tag", async () => {
		const tag = await createTag(uniqueCategory("Vacances"));
		const name = uniqueCategory("Vacances 2026");

		const response = await testClient(buildApp()).api.tags[":id"].$patch({
			param: { id: tag.id },
			json: { name },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ id: tag.id, name, transactionCount: 0 });
	});

	it("deletes a tag, removing it from its transactions and keeping their locks", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const tag = await createTag(uniqueCategory("Vacances"));
		const kept = await createTag(uniqueCategory("Travaux"));
		await tagAll(account.id, [tag.id, kept.id]);

		await expect(request("DELETE", `/api/tags/${tag.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: tag.id, untagged: 2 } },
		});
		await expect(
			temp.db.all(
				sql`select t.locked_fields as locked, (select group_concat(tag_id) from taggings where transaction_id = t.entry_id) as tags from transactions t where t.entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([
			{ locked: '["date","amount","label","tags"]', tags: kept.id },
			{ locked: '["date","amount","label","tags"]', tags: kept.id },
		]);
		expect((await tagList()).find((item) => item.id === tag.id)).toBeUndefined();
	});

	it("deletes a tagged transaction and an account whose transactions carry tags", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const tag = await createTag(uniqueCategory("Vacances"));
		await tagAll(account.id, [tag.id]);

		expect((await request("DELETE", `/api/transactions/${data.id}`)).status).toBe(200);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(1);
		expect((await request("DELETE", `/api/accounts/${account.id}`)).status).toBe(200);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(0);
	});

	it.each([
		["PATCH", "/api/tags/nope", { name: "Autre" }],
		["DELETE", "/api/tags/nope", undefined],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});
