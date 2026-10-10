import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import { ownCategory, ownDatabase, sendOwn, template, useSignedInApp } from "../testing/app.ts";
import { READ_WRITE, answerOf, callTool, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

let db: TempDatabase["db"];

/** A read-only and a read-write assistant of a household of its own. */
async function assistants() {
	db = (await ownDatabase()).db;
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const reader = (await connect(session, app, await registerClient(app))).access_token;
	const author = (await connect(session, app, await registerClient(app), READ_WRITE)).access_token;
	await db.delete(assistantCalls);

	return {
		read: (name: string, args: unknown = {}) => callTool(app, reader, name, args),
		write: (name: string, args: unknown = {}) => callTool(app, author, name, args),
	};
}

const LISTED_KEYS = [
	"id",
	"name",
	"name_with_parent",
	"color",
	"icon",
	"parent_id",
	"is_subcategory",
];

const listed = z.object({
	categories: z.array(z.record(z.string(), z.unknown())),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
});

describe("get_categories", () => {
	it("lists each parent followed by its subcategories, a page at a time, with Sure's fields alone", async () => {
		const tools = await assistants();
		const home = await ownCategory("Maison", { color: "#4ea7fc", icon: "house" });
		const works = await ownCategory("Travaux", { parentId: home });
		const garden = await ownCategory("Jardin", { parentId: home });

		const all = listed.parse(
			(await tools.read("get_categories", { page_size: 100 })).structuredContent,
		);
		const at = all.categories.findIndex((item) => item.id === home);

		expect(all.categories.every((item) => Object.keys(item).join() === LISTED_KEYS.join())).toBe(
			true,
		);
		expect(all.categories.slice(at, at + 3)).toEqual([
			{
				id: home,
				name: "Maison",
				name_with_parent: "Maison",
				color: "#4ea7fc",
				icon: "house",
				parent_id: null,
				is_subcategory: false,
			},
			{
				id: garden,
				name: "Jardin",
				name_with_parent: "Maison > Jardin",
				color: "#4ea7fc",
				icon: "tag",
				parent_id: home,
				is_subcategory: true,
			},
			expect.objectContaining({ id: works, name_with_parent: "Maison > Travaux" }),
		]);

		const second = listed.parse(
			(await tools.read("get_categories", { page: 2, page_size: 2 })).structuredContent,
		);

		expect(second).toMatchObject({
			categories: all.categories.slice(2, 4),
			total_results: all.total_results,
			page: 2,
			page_size: 2,
			total_pages: Math.ceil(all.total_results / 2),
		});
	});

	it("clamps page and page_size as Sure's rather than refusing them", async () => {
		const tools = await assistants();

		const answers = await Promise.all(
			[
				{ page_size: 101 },
				{ page_size: 0 },
				{ page: 0 },
				{ page: 1.5, page_size: "ten" },
				{ page: "2", page_size: "3 per page" },
				{ page_size: "" },
			].map(async (args) => (await tools.read("get_categories", args)).structuredContent),
		);

		expect(answers).toMatchObject([
			{ page: 1, page_size: 100 },
			{ page: 1, page_size: 1 },
			{ page: 1, page_size: 50 },
			{ page: 1, page_size: 1 },
			{ page: 2, page_size: 3 },
			{ page: 1, page_size: 50 },
		]);
	});
});

const CATEGORY_KEYS = ["id", "name", "name_with_parent", "color", "icon", "parent_id"];

const written = z.object({
	success: z.literal(true),
	category: z.object({ id: z.string() }).loose(),
	message: z.string(),
});

describe("create_category", () => {
	it("creates with Sure's colour and icon as an expense, a subcategory taking its parent's colour and kind", async () => {
		const tools = await assistants();

		const parent = written.parse(
			(await tools.write("create_category", { name: "Loisirs", color: "#E99537", icon: "plane" }))
				.structuredContent,
		);
		const child = written.parse(
			(
				await tools.write("create_category", {
					name: "Cinéma",
					color: "#27a644",
					parent_id: parent.category.id,
				})
			).structuredContent,
		);
		const income = await ownCategory("Revenus", { kind: "income" });
		await tools.write("create_category", { name: "Primes", parent_id: income });
		const route = z
			.object({ data: z.array(z.object({ name: z.string(), kind: z.string() }).loose()) })
			.parse(await sendOwn("GET", "/api/categories")).data;

		expect(parent).toEqual({
			success: true,
			category: {
				id: parent.category.id,
				name: "Loisirs",
				name_with_parent: "Loisirs",
				color: "#e99537",
				icon: "plane",
				parent_id: null,
			},
			message: "Category 'Loisirs' created.",
		});
		expect(Object.keys(parent.category)).toEqual(CATEGORY_KEYS);
		expect(child).toEqual({
			success: true,
			category: {
				id: child.category.id,
				name: "Cinéma",
				name_with_parent: "Loisirs > Cinéma",
				color: "#e99537",
				icon: "tag",
				parent_id: parent.category.id,
			},
			message: "Category 'Loisirs > Cinéma' created.",
		});
		expect(route.find((item) => item.name === "Loisirs")?.kind).toBe("expense");
		expect(route.find((item) => item.name === "Primes")?.kind).toBe("income");
	});

	it("refuses a blank name, an unknown parent, a taken name and a third level as Sure's", async () => {
		const tools = await assistants();
		const home = await ownCategory("Maison");
		const garden = await ownCategory("Jardin", { parentId: home });

		const blank = await tools.write("create_category", { name: "  " });
		const missing = await tools.write("create_category", { icon: "plane" });
		const orphan = await tools.write("create_category", { name: "Autre", parent_id: "nope" });
		const taken = await tools.write("create_category", { name: "maison" });
		const deep = await tools.write("create_category", { name: "Serre", parent_id: garden });
		const badIcon = await tools.write("create_category", { name: "Autre", icon: "rocket-ship" });

		expect(blank).toEqual({
			isError: true,
			content: [
				{
					type: "text",
					text: '{"success":false,"error":"name_required","message":"Please provide a name for the category."}',
				},
			],
		});
		expect(answerOf(missing)).toEqual(answerOf(blank));
		expect(answerOf(orphan)).toEqual({
			success: false,
			error: "parent_not_found",
			message: "Parent category with id 'nope' not found.",
		});
		expect(answerOf(taken)).toEqual({
			success: false,
			error: "validation_failed",
			message: "Name has already been taken",
		});
		expect(answerOf(deep)).toEqual({
			success: false,
			error: "validation_failed",
			message: "Parent can't have more than 2 levels of subcategories",
		});
		expect(answerOf(badIcon)).toMatchObject({ error: "icon invalid_value" });
		expect(
			await db
				.select({ outcome: assistantCalls.outcome, changedRows: assistantCalls.changedRows })
				.from(assistantCalls),
		).toEqual([
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "NOT_FOUND", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});

	it("reads a blank colour or icon as absent, as Sure's presence", async () => {
		const tools = await assistants();

		const created = await tools.write("create_category", { name: "Sport", color: "", icon: " " });

		expect(created.structuredContent).toMatchObject({
			success: true,
			category: { name: "Sport", color: "#fc7840", icon: "tag" },
		});
	});
});

describe("update_category", () => {
	it("changes a name, a colour or an icon through « Réglages »'s edit, its children taking the colour", async () => {
		const tools = await assistants();
		const home = await ownCategory("Maison");
		const garden = await ownCategory("Jardin", { parentId: home });

		const recoloured = await tools.write("update_category", {
			id: home,
			color: "#5e6ad2",
			icon: "house",
		});
		const renamed = await tools.write("update_category", { id: garden, name: "Potager" });
		const route = z
			.object({ data: z.array(z.object({ id: z.string(), color: z.string() }).loose()) })
			.parse(await sendOwn("GET", "/api/categories")).data;

		expect(recoloured.structuredContent).toEqual({
			success: true,
			category: {
				id: home,
				name: "Maison",
				name_with_parent: "Maison",
				color: "#5e6ad2",
				icon: "house",
				parent_id: null,
			},
			message: "Category 'Maison' updated.",
		});
		expect(renamed.structuredContent).toMatchObject({
			category: { id: garden, name: "Potager", name_with_parent: "Maison > Potager" },
			message: "Category 'Maison > Potager' updated.",
		});
		expect(route.find((item) => item.id === garden)?.color).toBe("#5e6ad2");
	});

	it("refuses an unknown id, nothing to change and a taken name as Sure's", async () => {
		const tools = await assistants();
		const home = await ownCategory("Maison");
		await ownCategory("Jardin");

		const unknown = await tools.write("update_category", { id: "nope", name: "Autre" });
		const empty = await tools.write("update_category", {
			id: home,
			name: " ",
			color: "",
			icon: "",
		});
		const taken = await tools.write("update_category", { id: home, name: "JARDIN" });

		expect(unknown.isError).toBe(true);
		expect(unknown.structuredContent).toBeUndefined();
		expect(answerOf(unknown)).toEqual({
			success: false,
			error: "not_found",
			message: "Category with id 'nope' not found.",
		});
		expect(answerOf(empty)).toEqual({
			success: false,
			error: "no_changes",
			message: "Provide at least one of name, color, or icon to update.",
		});
		expect(answerOf(taken)).toMatchObject({
			error: "validation_failed",
			message: "Name has already been taken",
		});
		expect(
			await db
				.select({ outcome: assistantCalls.outcome, changedRows: assistantCalls.changedRows })
				.from(assistantCalls),
		).toEqual([
			{ outcome: "NOT_FOUND", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});
});
