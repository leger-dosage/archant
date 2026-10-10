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
