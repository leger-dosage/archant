import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import { ownDatabase, sendOwn, template, useSignedInApp } from "../testing/app.ts";
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

async function tag(name: string) {
	return z
		.object({ data: z.object({ id: z.string() }) })
		.parse(await sendOwn("POST", "/api/tags", { name })).data.id;
}

const page = z.object({
	tags: z.array(z.object({ id: z.string(), name: z.string(), transaction_count: z.number() })),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
});

describe("get_tags", () => {
	it("gives a page of tags by name with Sure's page fields", async () => {
		const tools = await assistants();
		await Promise.all(["Vacances", "Anniversaire", "Travaux"].map(tag));

		const first = page.parse((await tools.read("get_tags", { page_size: 2 })).structuredContent);
		const last = page.parse(
			(await tools.read("get_tags", { page: 2, page_size: 2 })).structuredContent,
		);

		expect(first).toMatchObject({ total_results: 3, page: 1, page_size: 2, total_pages: 2 });
		expect([...first.tags, ...last.tags].map((item) => item.name)).toEqual([
			"Anniversaire",
			"Travaux",
			"Vacances",
		]);
		expect((await tools.read("get_tags")).structuredContent).toMatchObject({ page_size: 50 });
	});

	it("answers an empty household with one empty page, as Sure's", async () => {
		const tools = await assistants();

		expect((await tools.read("get_tags")).structuredContent).toEqual({
			tags: [],
			total_results: 0,
			page: 1,
			page_size: 50,
			total_pages: 1,
		});
	});
});

describe("update_tag", () => {
	it("renames the tag its exact current name names, as Sure's", async () => {
		const tools = await assistants();
		const id = await tag("Vacances");

		const renamed = await tools.write("update_tag", { name: "Vacances", new_name: "Voyages" });
		const otherCase = await tools.write("update_tag", { name: "voyages", new_name: "Séjours" });

		expect(renamed.structuredContent).toEqual({ tag: { id, name: "Voyages" } });
		expect(errorText(otherCase)).toMatch(/^NOT_FOUND: /u);
		expect(errorText(await tools.write("update_tag", { id, new_name: "Séjours" }))).toContain(
			'"code":"unrecognized_keys"',
		);
	});
});
