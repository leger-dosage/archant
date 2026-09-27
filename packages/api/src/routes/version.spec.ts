import type { SignedInTemplate } from "../testing/auth.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../lib/logger.ts";
import { buildTestApp, createSignedInTemplate, withSession } from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";

let template: SignedInTemplate;
let temp: TempDatabase;

// One sign-in for the whole file: Better Auth allows three per ten seconds.
beforeAll(async () => {
	template = await createSignedInTemplate();
});

afterAll(async () => {
	await template.dispose();
});

beforeEach(async () => {
	temp = await createTempDatabase(template.file);
});

afterEach(async () => {
	await temp.dispose();
});

function appWith(version: string | null) {
	return buildTestApp(temp.db, createLogger("silent"), undefined, { version });
}

describe("GET /api/version", () => {
	it("answers the release the server runs", async () => {
		const response = await withSession(appWith("1.2.3"), template.cookie).request("/api/version");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { version: "1.2.3" } });
	});

	it("answers null for a development build", async () => {
		const response = await withSession(appWith(null), template.cookie).request("/api/version");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { version: null } });
	});

	it("tells a visitor without a session nothing", async () => {
		const response = await appWith("1.2.3").request("/api/version");
		const body = await response.text();

		expect(response.status).toBe(401);
		expect(JSON.parse(body)).toMatchObject({ error: { code: "UNAUTHORIZED" } });
		expect(body).not.toContain("1.2.3");
	});
});
