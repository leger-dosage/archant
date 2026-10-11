import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

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

describe("get_merchants", () => {
	it("narrows by Sure's search, case aside, and pages through what it keeps", async () => {
		const tools = await assistants();
		const [, boucherie] = await Promise.all(
			["Boulangerie Dupain", "Boucherie Martin", "Picard"].map(
				async (name) =>
					z
						.object({ data: z.object({ id: z.string() }) })
						.parse(await sendOwn("POST", "/api/merchants", { name })).data.id,
			),
		);

		const found = await tools.read("get_merchants", { search: "BOU", page_size: 1 });

		expect(found.structuredContent).toEqual({
			merchants: [{ id: boucherie, name: "Boucherie Martin", source: "family" }],
			total_results: 2,
			page: 1,
			page_size: 1,
			total_pages: 2,
		});
		expect((await tools.read("get_merchants")).structuredContent).toMatchObject({
			total_results: 3,
			total_pages: 1,
		});

		const clamped = await tools.read("get_merchants", { page: 0, page_size: 500 });

		expect(clamped.isError).toBeUndefined();
		expect(clamped.structuredContent).toMatchObject({ page: 1, page_size: 100 });
	});
});

describe("create_merchant and rename_merchant", () => {
	it("answer Sure's { success, merchant, message }, as create_tag and update_tag", async () => {
		const tools = await assistants();

		const created = await tools.write("create_merchant", { name: "Boulangerie Dupain" });
		const merchant = z
			.object({ merchant: z.object({ id: z.string() }) })
			.parse(created.structuredContent).merchant;
		const renamed = await tools.write("rename_merchant", {
			merchant_id: merchant.id,
			name: "Boulangerie Martin",
		});

		expect(Object.keys(created.structuredContent ?? {})).toEqual([
			"success",
			"merchant",
			"message",
		]);
		expect(created.structuredContent).toEqual({
			success: true,
			merchant: { id: merchant.id, name: "Boulangerie Dupain", source: "family" },
			message: "Merchant 'Boulangerie Dupain' created.",
		});
		expect(renamed.structuredContent).toEqual({
			success: true,
			merchant: { id: merchant.id, name: "Boulangerie Martin", source: "family" },
			message: "Merchant 'Boulangerie Martin' updated.",
		});
	});

	it("refuse a name another merchant holds, case aside, as Sure's validation_failed, writing nothing", async () => {
		const tools = await assistants();
		await tools.write("create_merchant", { name: "Picard" });
		const other = z
			.object({ merchant: z.object({ id: z.string() }) })
			.parse((await tools.write("create_merchant", { name: "Lidl" })).structuredContent).merchant;

		const taken = await tools.write("create_merchant", { name: "PICARD" });
		const renamed = await tools.write("rename_merchant", { merchant_id: other.id, name: "picard" });
		const refusal = {
			success: false,
			error: "validation_failed",
			message: "Name has already been taken",
		};

		expect(taken.isError).toBe(true);
		expect(answerOf(taken)).toEqual(refusal);
		expect(answerOf(renamed)).toEqual(refusal);
		expect((await tools.read("get_merchants")).structuredContent).toMatchObject({
			merchants: [{ id: other.id, name: "Lidl" }, { name: "Picard" }],
		});
	});
});
