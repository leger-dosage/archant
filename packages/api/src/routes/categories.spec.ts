import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";

import {
	buildApp,
	categorise,
	category,
	createCategory,
	errorBody,
	expense,
	openAccount,
	ownDatabase,
	postTransaction,
	request,
	temp,
	uniqueCategory,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

async function categoryList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.categories.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("categories", () => {
	it("lists the categories sorted by name, with their transaction counts", async () => {
		const own = await ownDatabase();
		const client = testClient(buildApp(own.db)).api.categories;
		await client.$post({ json: category("Frais") });
		await client.$post({ json: category("Épargne", { kind: "income" }) });
		await client.$post({ json: category("Assurances") });

		const list = await categoryList(own.db);

		expect(list.map((item) => [item.name, item.kind, item.transactionCount])).toEqual([
			["Assurances", "expense", 0],
			["Épargne", "income", 0],
			["Frais", "expense", 0],
		]);
	});

	it("creates a child with its parent's kind and colour", async () => {
		const parent = await createCategory(uniqueCategory("Revenus"), {
			kind: "income",
			color: "#6ad28a",
		});

		const child = await createCategory(uniqueCategory("Salaire"), { parentId: parent.id });

		expect(child).toMatchObject({ parentId: parent.id, kind: "income", color: "#6ad28a" });
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Courses");
		await createCategory(name);

		await expect(request("POST", "/api/categories", category(name.toUpperCase()))).resolves.toEqual(
			{
				status: 400,
				body: {
					error: {
						code: "VALIDATION_ERROR",
						message: "The request is invalid.",
						fields: [{ path: "name", code: "name_taken" }],
					},
				},
			},
		);
	});

	it("refuses a decomposed name beside the composed one", async () => {
		const name = uniqueCategory("Épargne");
		await createCategory(name);

		const { status, body } = await request(
			"POST",
			"/api/categories",
			category(name.normalize("NFD")),
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code: "name_taken" }]);
	});

	it("accepts an uppercase colour and stores it in lowercase", async () => {
		const created = await createCategory(uniqueCategory("Majuscules"), { color: "#E99537" });

		expect(created.color).toBe("#e99537");
	});

	it("keeps a default's colour outside the swatches on edit", async () => {
		const target = await createCategory(uniqueCategory("Revenus"), { kind: "income" });

		const { status, body } = await request("PATCH", `/api/categories/${target.id}`, {
			color: "#22c55e",
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { color: "#22c55e" } });
	});

	it("refuses a grandchild, and a parent for a category with children", async () => {
		const parent = await createCategory(uniqueCategory("Logement"));
		const child = await createCategory(uniqueCategory("Loyer"), { parentId: parent.id });
		const other = await createCategory(uniqueCategory("Loisirs"));

		const grandchild = await request(
			"POST",
			"/api/categories",
			category(uniqueCategory("Caution"), { parentId: child.id }),
		);
		const moved = await request("PATCH", `/api/categories/${parent.id}`, { parentId: other.id });

		for (const response of [grandchild, moved]) {
			expect(response).toMatchObject({
				status: 400,
				body: { error: { fields: [{ path: "parentId", code: "invalid_parent" }] } },
			});
		}
	});

	it.each([
		["a blank name", { name: "  " }, "name", "too_small"],
		["a name over 60 characters", { name: "x".repeat(61) }, "name", "too_big"],
		["a free colour name", { color: "red" }, "color", "invalid_value"],
		["an unknown icon", { icon: "rocket" }, "icon", "invalid_value"],
		["an unknown kind", { kind: "transfer" }, "kind", "invalid_value"],
	])("refuses %s", async (_label, overrides, path, code) => {
		const { status, body } = await request("POST", "/api/categories", {
			...category(uniqueCategory("Autre")),
			...overrides,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});

	it("renames, recolours and moves a category under a parent", async () => {
		const parent = await createCategory(uniqueCategory("Logement"), { color: "#4da568" });
		const target = await createCategory(uniqueCategory("Eau"));
		const name = uniqueCategory("Eau et énergie");

		const response = await testClient(buildApp()).api.categories[":id"].$patch({
			param: { id: target.id },
			json: { name, icon: "lightbulb", parentId: parent.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			name,
			icon: "lightbulb",
			parentId: parent.id,
			color: "#4da568",
		});
	});

	it("refuses an empty patch", async () => {
		const target = await createCategory(uniqueCategory("Vide"));

		const { status, body } = await request("PATCH", `/api/categories/${target.id}`, {});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "", code: "empty_patch" }]);
	});

	it("deletes a category, moving its transactions to the replacement", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const source = await createCategory(uniqueCategory("Courses"));
		const replacement = await createCategory(uniqueCategory("Alimentation"));
		await categorise(account.id, source.id);

		const response = await testClient(buildApp()).api.categories[":id"].$delete({
			param: { id: source.id },
			query: { replacementId: replacement.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ id: source.id, moved: 2 });
		const list = await categoryList();
		expect(list.find((item) => item.id === source.id)).toBeUndefined();
		expect(list.find((item) => item.id === replacement.id)?.transactionCount).toBe(2);
	});

	it("deletes a category, leaving its transactions uncategorised", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createCategory(uniqueCategory("Cadeaux"));
		await categorise(account.id, source.id);

		await expect(request("DELETE", `/api/categories/${source.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: source.id, moved: 1 } },
		});
		await expect(
			temp.db.all(
				sql`select category_id as categoryId from transactions where entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([{ categoryId: null }]);
	});

	it.each([["nope"], ["self"]])("refuses %s as the replacement", async (which) => {
		const source = await createCategory(uniqueCategory("Courses"));
		const replacementId = which === "self" ? source.id : which;

		const { status, body } = await request(
			"DELETE",
			`/api/categories/${source.id}?replacementId=${replacementId}`,
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "replacementId", code: "invalid_value" },
		]);
	});

	it("merges a category into a target, whose count then includes its transactions", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createCategory(uniqueCategory("Restaurants"));
		const target = await createCategory(uniqueCategory("Sorties"));
		await categorise(account.id, source.id);

		const response = await testClient(buildApp()).api.categories[":id"].merge.$post({
			param: { id: source.id },
			json: { targetId: target.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ id: target.id, transactionCount: 1 });
		expect((await categoryList()).find((item) => item.id === source.id)).toBeUndefined();
	});

	it("refuses to merge a parent into its own child", async () => {
		const parent = await createCategory(uniqueCategory("Logement"));
		const child = await createCategory(uniqueCategory("Loyer"), { parentId: parent.id });

		const { status, body } = await request("POST", `/api/categories/${parent.id}/merge`, {
			targetId: child.id,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "targetId", code: "invalid_value" },
		]);
	});

	it.each([
		["PATCH", "/api/categories/nope", { name: "Autre" }],
		["DELETE", "/api/categories/nope", undefined],
		["POST", "/api/categories/nope/merge", { targetId: "other" }],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});
