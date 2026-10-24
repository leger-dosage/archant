import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";

import {
	buildApp,
	createMerchant,
	errorBody,
	expense,
	linkMerchant,
	openAccount,
	ownDatabase,
	postTransaction,
	request,
	temp,
	uniqueCategory,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

async function merchantList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.merchants.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("merchants", () => {
	it("lists the merchants sorted by name, with their transaction counts", async () => {
		const own = await ownDatabase();
		const client = testClient(buildApp(own.db)).api.merchants;
		await client.$post({ json: { name: "Fnac" } });
		await client.$post({ json: { name: "Épicerie du coin" } });
		await client.$post({ json: { name: "Carrefour" } });

		const list = await merchantList(own.db);

		expect(list.map((item) => [item.name, item.transactionCount])).toEqual([
			["Carrefour", 0],
			["Épicerie du coin", 0],
			["Fnac", 0],
		]);
	});

	it("creates a merchant, trimming its name", async () => {
		const name = uniqueCategory("Carrefour");

		await expect(request("POST", "/api/merchants", { name: `  ${name} ` })).resolves.toMatchObject({
			status: 201,
			body: { data: { name, transactionCount: 0 } },
		});
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Carrefour");
		await createMerchant(name);

		await expect(request("POST", "/api/merchants", { name: name.toLowerCase() })).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "name", code: "name_taken" }],
				},
			},
		});
	});

	it("refuses a decomposed name beside the composed one", async () => {
		const name = uniqueCategory("Épicerie");
		await createMerchant(name);

		const { status, body } = await request("POST", "/api/merchants", {
			name: name.normalize("NFD"),
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code: "name_taken" }]);
	});

	it.each([
		["a blank name", "  ", "too_small"],
		["a name over 60 characters", "x".repeat(61), "too_big"],
	])("refuses %s", async (_label, name, code) => {
		const { status, body } = await request("POST", "/api/merchants", { name });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code }]);
	});

	it("renames a merchant", async () => {
		const merchant = await createMerchant(uniqueCategory("Carrefour"));
		const name = uniqueCategory("Carrefour Market");

		const response = await testClient(buildApp()).api.merchants[":id"].$patch({
			param: { id: merchant.id },
			json: { name },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({
			id: merchant.id,
			name,
			color: merchant.color,
			websiteUrl: null,
			transactionCount: 0,
		});
	});

	it("deletes a merchant, unlinking its transactions and keeping their locks", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const merchant = await createMerchant(uniqueCategory("Fleuriste"));
		await linkMerchant(account.id, merchant.id);

		await expect(request("DELETE", `/api/merchants/${merchant.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: merchant.id, unlinked: 2 } },
		});
		await expect(
			temp.db.all(
				sql`select merchant_id as merchantId, (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([
			{ merchantId: null, locked: '["date","amount","label","merchant"]' },
			{ merchantId: null, locked: '["date","amount","label","merchant"]' },
		]);
		expect((await merchantList()).find((item) => item.id === merchant.id)).toBeUndefined();
	});

	it("merges several merchants into a target, whose count then includes their transactions", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createMerchant(uniqueCategory("CB Carrefour"));
		const other = await createMerchant(uniqueCategory("Carrefour Market"));
		const target = await createMerchant(uniqueCategory("Carrefour"));
		await linkMerchant(account.id, source.id);

		const response = await testClient(buildApp()).api.merchants.merge.$post({
			json: { targetId: target.id, sourceIds: [source.id, other.id] },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			target: { id: target.id, transactionCount: 1 },
			merged: 2,
		});
		expect((await merchantList()).find((item) => item.id === source.id)).toBeUndefined();
	});

	it.each([
		["an unknown target", "targetId", "invalid_value"],
		["the target among the sources", "sourceIds", "same_merchant"],
	])("refuses %s", async (_, path, code) => {
		const source = await createMerchant(uniqueCategory("Carrefour"));
		const targetId = path === "targetId" ? "nope" : source.id;

		const { status, body } = await request("POST", "/api/merchants/merge", {
			targetId,
			sourceIds: [source.id],
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
		expect((await merchantList()).find((item) => item.id === source.id)).toBeDefined();
	});

	it("creates a merchant with its colour and website, a bad colour refused", async () => {
		const name = uniqueCategory("Starbucks");

		await expect(
			request("POST", "/api/merchants", { name, color: "#4DA568", websiteUrl: " starbucks.com " }),
		).resolves.toMatchObject({
			status: 201,
			body: { data: { name, color: "#4da568", websiteUrl: "starbucks.com" } },
		});
		const refused = await request("POST", "/api/merchants", { name: `${name} 2`, color: "red" });

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error.fields).toEqual([
			{ path: "color", code: "invalid_value" },
		]);
	});

	it.each([
		["PATCH", "/api/merchants/nope", { name: "Autre" }],
		["DELETE", "/api/merchants/nope", undefined],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});
