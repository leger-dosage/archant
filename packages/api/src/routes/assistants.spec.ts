import { testClient } from "hono/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { rateLimits } from "@archant/data/schema/auth";

import { createLogger } from "../lib/logger.ts";
import { buildApp, errorBody, temp, template, useSignedInApp } from "../testing/app.ts";
import { READ_WRITE, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, TEST_ORIGIN, withSession } from "../testing/auth.ts";

useSignedInApp();

beforeEach(async () => {
	await temp.db.delete(rateLimits);
});

async function connected(granted?: string) {
	const auth = createTestAuth(temp.db);
	const bare = buildTestApp(temp.db, createLogger("silent"), auth);
	const signedIn = withSession(
		buildTestApp(temp.db, createLogger("silent"), auth),
		template.cookie,
	);
	const clientId = await registerClient(bare, "Claude Code");
	await connect(signedIn, bare, clientId, granted);

	return clientId;
}

describe("GET /api/assistants", () => {
	it("gives the address to hand an assistant, and each one connected", async () => {
		const clientId = await connected(READ_WRITE);

		const response = await testClient(buildApp()).api.assistants.$get();
		const { data } = await response.json();

		expect(response.status).toBe(200);
		expect(data.available).toBe(true);
		expect(data.address).toBe(`${TEST_ORIGIN}/api/mcp`);
		expect(data.assistants).toContainEqual({
			clientId,
			name: "Claude Code",
			scopes: ["archant:read", "archant:write"],
			connectedAt: Date.parse("2026-09-21T10:00:00Z"),
			lastCallAt: null,
		});
	});

	it("says assistants are off on plain HTTP outside loopback", async () => {
		const app = withSession(
			buildTestApp(temp.db, createLogger("silent"), undefined, { origin: "http://nas.lan:8787" }),
			template.cookie,
		);

		const response = await testClient(app).api.assistants.$get();

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			available: false,
			address: "http://nas.lan:8787/api/mcp",
		});
	});

	it("refuses a visitor without a session", async () => {
		const response = await buildTestApp(temp.db).request("/api/assistants");

		expect(response.status).toBe(401);
	});
});

describe("DELETE /api/assistants/:clientId", () => {
	it("disconnects the assistant, then answers ASSISTANT_NOT_FOUND", async () => {
		const clientId = await connected();
		const client = testClient(buildApp()).api.assistants[":clientId"];

		const first = await client.$delete({ param: { clientId } });
		const second = await client.$delete({ param: { clientId } });

		expect(first.status).toBe(200);
		expect(second.status).toBe(404);
		expect(errorBody.parse(await second.json()).error.code).toBe("ASSISTANT_NOT_FOUND");
		const list = await (await testClient(buildApp()).api.assistants.$get()).json();
		expect(list.data.assistants.map((assistant) => assistant.clientId)).not.toContain(clientId);
	});

	it("takes a client id that is a URL, as a Client ID Metadata Document's", async () => {
		const response = await buildApp().request(
			`/api/assistants/${encodeURIComponent("https://claude.ai/oauth/claude-code-client-metadata")}`,
			{ method: "DELETE" },
		);

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("ASSISTANT_NOT_FOUND");
	});
});
