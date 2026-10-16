import type { Auth } from "../services/auth.ts";

import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

import { createLogger } from "../lib/logger.ts";
import { buildApp, errorBody, ownDatabase, temp, useSignedInApp } from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

async function preferencesApi() {
	const own = await ownDatabase();

	return testClient(buildApp(own.db)).api.preferences;
}

async function patchRaw(body: unknown, app = buildApp()) {
	const response = await app.request("/api/preferences", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	return { status: response.status, body: await response.json() };
}

describe("GET /api/preferences", () => {
	it("reads Sure's name order for a user who never chose one", async () => {
		const api = await preferencesApi();

		const response = await api.$get();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { defaultAccountOrder: "name_asc" } });
	});
});

describe("PATCH /api/preferences", () => {
	it.each(ACCOUNT_ORDERS)("saves %s and answers the preferences", async (order) => {
		const api = await preferencesApi();

		const saved = await api.$patch({ json: { defaultAccountOrder: order } });
		const read = await api.$get();

		expect(saved.status).toBe(200);
		await expect(saved.json()).resolves.toEqual({ data: { defaultAccountOrder: order } });
		await expect(read.json()).resolves.toEqual({ data: { defaultAccountOrder: order } });
	});

	it("refuses an unknown order VALIDATION_ERROR, as Sure's inclusion, nothing saved", async () => {
		const own = await ownDatabase();
		const app = buildApp(own.db);

		const refused = await patchRaw({ defaultAccountOrder: "random" }, app);
		const read = await app.request("/api/preferences");

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "defaultAccountOrder", code: "invalid_value" }],
		});
		await expect(read.json()).resolves.toEqual({ data: { defaultAccountOrder: "name_asc" } });
	});

	describe("as a viewer", () => {
		const silent = createLogger("silent");
		let auth: Auth;
		let viewerCookie: string;

		// One viewer sign-in for the block: Better Auth allows three per ten seconds.
		beforeAll(async () => {
			auth = createTestAuth(temp.db, silent);
			viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
		});

		const viewer = () => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		it("reads the default order, and is refused FORBIDDEN on a save, nothing written", async () => {
			const refused = await patchRaw({ defaultAccountOrder: "balance_desc" }, viewer());
			const read = await viewer().request("/api/preferences");

			expect(refused.status).toBe(403);
			expect(errorBody.parse(refused.body).error.code).toBe("FORBIDDEN");
			expect(read.status).toBe(200);
			await expect(read.json()).resolves.toEqual({ data: { defaultAccountOrder: "name_asc" } });
		});
	});
});
