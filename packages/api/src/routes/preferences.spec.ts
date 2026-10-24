import type { Auth } from "../services/auth.ts";

import { testClient } from "hono/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
	errorBody,
	expense,
	openOwn,
	ownCategory,
	ownDatabase,
	ownRequest,
	postOwn,
	sendOwn,
	temp,
	useSignedInApp,
} from "../testing/app.ts";
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
	it("reads Sure's name order and grouped splits for a user who never chose", async () => {
		const api = await preferencesApi();

		const response = await api.$get();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: { defaultAccountOrder: "name_asc", showSplitGrouped: true },
		});
	});
});

// Story 32.11: a line categorised by hand in the test's own database.
async function categorisedLine() {
	const account = await openOwn();
	const id = await postOwn(account.id, expense);
	const categoryId = await ownCategory("Courses");
	await sendOwn("PATCH", `/api/transactions/${id}`, { categoryId });

	return id;
}

const offered = async (id: string) =>
	z
		.object({ data: z.object({ offered: z.boolean() }) })
		.parse((await ownRequest("GET", `/api/transactions/${id}/rule-prompt`)).body).data.offered;

describe("PATCH /api/preferences", () => {
	it.each(ACCOUNT_ORDERS)("saves %s and answers the preferences", async (order) => {
		const api = await preferencesApi();

		const saved = await api.$patch({ json: { defaultAccountOrder: order } });
		const read = await api.$get();

		expect(saved.status).toBe(200);
		await expect(saved.json()).resolves.toEqual({
			data: { defaultAccountOrder: order, showSplitGrouped: true },
		});
		await expect(read.json()).resolves.toEqual({
			data: { defaultAccountOrder: order, showSplitGrouped: true },
		});
	});

	it("writes nothing for an empty body and answers the preferences", async () => {
		const api = await preferencesApi();
		await api.$patch({ json: { defaultAccountOrder: "name_desc" } });

		const saved = await api.$patch({ json: {} });

		expect(saved.status).toBe(200);
		await expect(saved.json()).resolves.toEqual({
			data: { defaultAccountOrder: "name_desc", showSplitGrouped: true },
		});
	});

	it("turns the split grouping off then on, the order untouched, as Sure's toggle", async () => {
		const api = await preferencesApi();
		await api.$patch({ json: { defaultAccountOrder: "balance_desc" } });

		const off = await api.$patch({ json: { showSplitGrouped: false } });
		const readOff = await api.$get();
		const on = await api.$patch({ json: { showSplitGrouped: true } });

		await expect(off.json()).resolves.toEqual({
			data: { defaultAccountOrder: "balance_desc", showSplitGrouped: false },
		});
		await expect(readOff.json()).resolves.toEqual({
			data: { defaultAccountOrder: "balance_desc", showSplitGrouped: false },
		});
		await expect(on.json()).resolves.toEqual({
			data: { defaultAccountOrder: "balance_desc", showSplitGrouped: true },
		});
	});

	it("refuses a grouping that is not a boolean VALIDATION_ERROR", async () => {
		const own = await ownDatabase();

		const refused = await patchRaw({ showSplitGrouped: "no" }, buildApp(own.db));

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "showSplitGrouped", code: "invalid_type" }],
		});
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
		await expect(read.json()).resolves.toEqual({
			data: { defaultAccountOrder: "name_asc", showSplitGrouped: true },
		});
	});

	// Story 32.11: Sure's `rule_prompt_settings`, each test in its own database.
	describe("/rule-prompt", () => {
		const DAY = 24 * 60 * 60 * 1000;

		afterEach(() => {
			vi.useRealTimers();
		});

		it("hides the prompt for 24 hours with « Masquer pour aujourd'hui », then offers it again", async () => {
			const id = await categorisedLine();

			const dismissed = await ownRequest("PATCH", "/api/preferences/rule-prompt", {
				disabled: false,
			});
			const hidden = await offered(id);
			const now = Date.now();
			vi.useFakeTimers({ now: now + DAY - 60_000, toFake: ["Date"] });
			const stillHidden = await offered(id);
			vi.setSystemTime(now + DAY + 1000);
			const back = await offered(id);

			expect(dismissed).toEqual({ status: 200, body: { data: { rulePromptsDisabled: false } } });
			expect([hidden, stillHidden, back]).toEqual([false, false, true]);
		});

		it("hides it for good with « Ne plus afficher » ticked", async () => {
			const id = await categorisedLine();

			await ownRequest("PATCH", "/api/preferences/rule-prompt", { disabled: true });
			vi.useFakeTimers({ now: Date.now() + 2 * DAY, toFake: ["Date"] });
			const later = await offered(id);

			expect(later).toBe(false);
		});

		it("refuses a missing choice VALIDATION_ERROR", async () => {
			await openOwn();

			const refused = await ownRequest("PATCH", "/api/preferences/rule-prompt", {});

			expect(refused.status).toBe(400);
			expect(errorBody.parse(refused.body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "disabled", code: "invalid_type" }],
			});
		});
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

		it("is refused FORBIDDEN on hiding the rule prompt", async () => {
			const refused = await viewer().request("/api/preferences/rule-prompt", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ disabled: true }),
			});

			expect(refused.status).toBe(403);
			expect(errorBody.parse(await refused.json()).error.code).toBe("FORBIDDEN");
		});

		it("reads the default order, and is refused FORBIDDEN on a save, nothing written", async () => {
			const refused = await patchRaw({ defaultAccountOrder: "balance_desc" }, viewer());
			const read = await viewer().request("/api/preferences");

			expect(refused.status).toBe(403);
			expect(errorBody.parse(refused.body).error.code).toBe("FORBIDDEN");
			expect(read.status).toBe(200);
			await expect(read.json()).resolves.toEqual({
				data: { defaultAccountOrder: "name_asc", showSplitGrouped: true },
			});
		});
	});
});
