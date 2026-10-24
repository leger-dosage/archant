import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CATEGORY_COLORS } from "@archant/data/category-presets";
import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import { ownDatabase, sendOwn, template, useSignedInApp } from "../testing/app.ts";
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

async function tag(name: string) {
	return z
		.object({ data: z.object({ id: z.string() }) })
		.parse(await sendOwn("POST", "/api/tags", { name })).data.id;
}

const page = z.object({
	tags: z.array(z.record(z.string(), z.unknown())),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
});

async function outcomes() {
	return db
		.select({ outcome: assistantCalls.outcome, changedRows: assistantCalls.changedRows })
		.from(assistantCalls);
}

/** One of Sure's ten, drawn at random as `COLORS.sample`. */
const sampledColor: unknown = expect.stringMatching(
	new RegExp(`^(${CATEGORY_COLORS.join("|")})$`, "u"),
);

describe("get_tags", () => {
	it("gives a page of tags by name with Sure's fields and page fields", async () => {
		const tools = await assistants();
		const [holidays] = await Promise.all(["Vacances", "Anniversaire", "Travaux"].map(tag));

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
		expect(last.tags).toEqual([{ id: holidays, name: "Vacances", color: sampledColor }]);
		expect((await tools.read("get_tags")).structuredContent).toMatchObject({ page_size: 50 });
		expect(
			(await tools.read("get_tags", { page: -2, page_size: 500 })).structuredContent,
		).toMatchObject({ page: 1, page_size: 100 });
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

describe("create_tag", () => {
	it("creates a tag with Sure's answer and its colour, and refuses a blank or taken name", async () => {
		const tools = await assistants();

		const created = await tools.write("create_tag", { name: " Vacances ", color: "#e99537" });
		const blank = await tools.write("create_tag", { name: "" });
		const missing = await tools.write("create_tag", { color: "#e99537" });
		const taken = await tools.write("create_tag", { name: "vacances" });

		const { id } = z
			.object({ tag: z.object({ id: z.string() }) })
			.parse(created.structuredContent).tag;

		expect(created.structuredContent).toEqual({
			success: true,
			tag: { id, name: "Vacances", color: "#e99537" },
			message: "Tag 'Vacances' created.",
		});
		expect(answerOf(blank)).toEqual({
			success: false,
			error: "name_required",
			message: "Please provide a name for the tag.",
		});
		expect(answerOf(missing)).toEqual(answerOf(blank));
		expect(taken).toEqual({
			isError: true,
			content: [
				{
					type: "text",
					text: '{"success":false,"error":"validation_failed","message":"Name has already been taken"}',
				},
			],
		});
		expect(await outcomes()).toEqual([
			{ outcome: "OK", changedRows: 1 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});
});

describe("a tag's colour", () => {
	it("reads a blank colour as absent, lowercases a given one and refuses one Sure's format refuses", async () => {
		const tools = await assistants();
		await tag("Vacances");

		const blank = await tools.write("create_tag", { name: "Sport", color: " " });
		const upper = await tools.write("create_tag", { name: "Travaux", color: "#DB5A54" });
		const blankUpdate = await tools.write("update_tag", { name: "Vacances", color: "" });
		const refused = await tools.write("update_tag", { name: "Vacances", color: "red" });

		expect(blank.structuredContent).toMatchObject({ tag: { name: "Sport", color: sampledColor } });
		expect(upper.structuredContent).toMatchObject({ tag: { color: "#db5a54" } });
		expect(answerOf(blankUpdate)).toMatchObject({ error: "no_changes" });
		expect(refused.isError).toBe(true);
		expect(answerOf(refused)).toMatchObject({ error: "color invalid_value" });
	});
});

describe("update_tag", () => {
	it("renames the tag its exact current name names, as Sure's", async () => {
		const tools = await assistants();
		const id = await tag("Vacances");
		await tag("Travaux");

		const renamed = await tools.write("update_tag", { name: "Vacances", new_name: "Voyages" });
		const coloured = await tools.write("update_tag", { name: "Voyages", color: "#805dee" });
		const otherCase = await tools.write("update_tag", { name: "voyages", new_name: "Séjours" });
		const padded = await tools.write("update_tag", { name: " Voyages ", color: "#805dee" });
		const empty = await tools.write("update_tag", { name: "Voyages", new_name: " " });
		const taken = await tools.write("update_tag", { name: "Voyages", new_name: "travaux" });

		expect(renamed.structuredContent).toEqual({
			success: true,
			tag: { id, name: "Voyages", color: sampledColor },
			message: "Tag updated.",
		});
		expect(coloured.structuredContent).toEqual({
			success: true,
			tag: { id, name: "Voyages", color: "#805dee" },
			message: "Tag updated.",
		});
		expect(answerOf(otherCase)).toEqual({
			success: false,
			error: "not_found",
			message: "Tag 'voyages' not found.",
		});
		// Sure strips the name before its exact match.
		expect(padded.structuredContent).toEqual(coloured.structuredContent);
		expect(answerOf(empty)).toEqual({
			success: false,
			error: "no_changes",
			message: "Provide at least one of new_name or color to update.",
		});
		expect(answerOf(taken)).toEqual({
			success: false,
			error: "validation_failed",
			message: "Name has already been taken",
		});
		expect(answerOf(await tools.write("update_tag", { id, new_name: "Séjours" }))).toEqual({
			error: "name invalid_type; id unrecognized_keys",
			hint: "Check argument formats (dates are YYYY-MM-DD) and retry once with corrected arguments.",
		});
		expect(await outcomes()).toEqual([
			{ outcome: "OK", changedRows: 1 },
			{ outcome: "OK", changedRows: 1 },
			{ outcome: "NOT_FOUND", changedRows: 0 },
			{ outcome: "OK", changedRows: 1 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});
});
