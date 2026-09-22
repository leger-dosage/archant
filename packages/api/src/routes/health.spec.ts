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
			expect(logLines).toHaveLength(1);
			expect(logLines[0]).toMatch(/"error":"\w+"/u);
			expect(logLines[0]).toContain('"msg":"health check failed"');
			expect(logLines[0]).not.toContain("stack");
			expect(logLines[0]).not.toContain("closed");
		} finally {
			await closed.dispose();
		}
	});
});
