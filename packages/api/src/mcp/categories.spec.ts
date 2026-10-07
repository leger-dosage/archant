import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import { ownCategory, ownDatabase, sendOwn, template, useSignedInApp } from "../testing/app.ts";
import { READ_WRITE, callTool, connect, registerClient } from "../testing/assistant.ts";
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

const errorText = (result: Awaited<ReturnType<typeof callTool>>) =>
	z.array(z.object({ text: z.string() })).parse(result.content)[0]?.text ?? "";

const category = z.object({
	id: z.string(),
	name: z.string(),
	name_with_parent: z.string(),
	color: z.string(),
	icon: z.string(),
	parent_id: z.string().nullable(),
	kind: z.string(),
});

const listed = z.object({
	categories: z.array(
		category.extend({ is_subcategory: z.boolean(), transaction_count: z.number() }),
	),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
});

describe("get_categories", () => {
	it("lists each parent followed by its subcategories, a page at a time, as Sure's", async () => {
		const tools = await assistants();
		const home = await ownCategory("Maison", { color: "#4ea7fc", icon: "house" });
		await ownCategory("Travaux", { parentId: home });
		await ownCategory("Jardin", { parentId: home });

		const all = listed.parse(
			(await tools.read("get_categories", { page_size: 100 })).structuredContent,
		);
		const at = all.categories.findIndex((item) => item.id === home);

		expect(all.categories.slice(at, at + 3)).toEqual([
			expect.objectContaining({
				name: "Maison",
				name_with_parent: "Maison",
				color: "#4ea7fc",
				icon: "house",
				parent_id: null,
				is_subcategory: false,
			}),
			expect.objectContaining({
				name: "Jardin",
				name_with_parent: "Maison > Jardin",
				color: "#4ea7fc",
				parent_id: home,
				is_subcategory: true,
			}),
			expect.objectContaining({ name: "Travaux", name_with_parent: "Maison > Travaux" }),
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
		expect(errorText(await tools.read("get_categories", { page_size: 101 }))).toContain(
			'"path":"page_size","code":"too_big"',
		);
	});
});

describe("create_category and update_category", () => {
	it("creates with Sure's colour and icon, an expense by default, a subcategory taking its parent's colour", async () => {
		const tools = await assistants();

		const parent = category.parse(
			z.object({ category: z.unknown() }).parse(
				(
					await tools.write("create_category", {
						name: "Loisirs",
						color: "#E99537",
						icon: "plane",
					})
				).structuredContent,
			).category,
		);
		const child = await tools.write("create_category", {
			name: "Cinéma",
			color: "#27a644",
			parent_id: parent.id,
		});
		const badIcon = await tools.write("create_category", { name: "Autre", icon: "rocket-ship" });

		expect(parent).toEqual({
			id: parent.id,
			name: "Loisirs",
			name_with_parent: "Loisirs",
			color: "#e99537",
			icon: "plane",
			parent_id: null,
			kind: "expense",
		});
		expect(child.structuredContent).toMatchObject({
			category: {
				name_with_parent: "Loisirs > Cinéma",
				color: "#e99537",
				icon: "tag",
				parent_id: parent.id,
			},
		});
		expect(errorText(badIcon)).toContain('"path":"icon","code":"invalid_value"');
	});

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
		const empty = await tools.write("update_category", { id: home });
		const route = z
			.object({ data: z.array(z.object({ id: z.string(), color: z.string() }).loose()) })
			.parse(await sendOwn("GET", "/api/categories")).data;

		expect(recoloured.structuredContent).toMatchObject({
			category: { id: home, name: "Maison", color: "#5e6ad2", icon: "house", kind: "expense" },
		});
		expect(renamed.structuredContent).toMatchObject({
			category: { id: garden, name: "Potager", name_with_parent: "Maison > Potager" },
		});
		expect(route.find((item) => item.id === garden)?.color).toBe("#5e6ad2");
		expect(errorText(empty)).toContain('"code":"empty_patch"');
	});
});
