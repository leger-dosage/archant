import type { TempDatabase } from "../testing/temp-database.ts";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../lib/logger.ts";
import { buildTestApp } from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";

let temp: TempDatabase;

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

describe("GET /api/health", () => {
	it("answers ok on a migrated database, without a session", async () => {
		const response = await buildTestApp(temp.db).request("/api/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
	});

	// The version sits behind the session guard (routes/version.ts): an
	// anonymous caller must not learn which release to attack.
	it("never carries the version, even on a release build", async () => {
		const response = await buildTestApp(temp.db, createLogger("silent"), undefined, {
			version: "1.2.3",
		}).request("/api/health");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('{"data":{"status":"ok"}}');
	});

	it("answers SERVICE_UNAVAILABLE when the database does not answer, and logs the error name only", async () => {
		const closed = await createTempDatabase();
		closed.db.$client.close();
		const logLines: string[] = [];
		const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

		try {
			const response = await buildTestApp(closed.db, logger).request("/api/health");
			const body = await response.text();

			expect(response.status).toBe(503);
			expect(JSON.parse(body)).toEqual({
				error: { code: "SERVICE_UNAVAILABLE", message: "The database does not answer." },
			});
			expect(body).not.toContain("stack");
			// Better Auth's OAuth provider also logs that it could not seed its
			// resources from the closed database: only the health line is ours.
			const health = logLines.filter((line) => line.includes('"msg":"health check failed"'));
			expect(health).toHaveLength(1);
			expect(health[0]).toMatch(/"error":"\w+"/u);
			for (const line of logLines) {
				expect(line).not.toContain("stack");
				expect(line).not.toContain("closed");
			}
		} finally {
			await closed.dispose();
		}
	});
});
