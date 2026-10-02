import type { TempDatabase } from "../testing/temp-database.ts";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createTempDatabase } from "../testing/temp-database.ts";
import { ASSISTANT_CALL_RETENTION_MS, recordAssistantCall } from "./assistant-calls.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

beforeEach(async () => {
	await temp.db.delete(assistantCalls);
});

const NOW = Date.parse("2026-10-02T10:00:00Z");

const call = { clientId: "client", tool: "get_tags", outcome: "OK", changedRows: 0 };

describe("recordAssistantCall", () => {
	it("records the client, tool, time, outcome and changed count", async () => {
		await recordAssistantCall(deps(), { ...call, outcome: "NOT_FOUND", changedRows: 3 }, NOW);

		const rows = await temp.db.select().from(assistantCalls);

		expect(rows.map(({ id: _id, ...row }) => row)).toEqual([
			{
				clientId: "client",
				tool: "get_tags",
				outcome: "NOT_FOUND",
				changedRows: 3,
				createdAt: NOW,
			},
		]);
	});

	it("forgets calls older than 90 days in the same write, and keeps the 90th day", async () => {
		await recordAssistantCall(deps(), call, NOW - ASSISTANT_CALL_RETENTION_MS - 1);
		await recordAssistantCall(deps(), call, NOW - ASSISTANT_CALL_RETENTION_MS);

		await recordAssistantCall(deps(), call, NOW);

		const kept = await temp.db.select({ createdAt: assistantCalls.createdAt }).from(assistantCalls);
		expect(kept.map((row) => row.createdAt).toSorted((a, b) => a - b)).toEqual([
			NOW - ASSISTANT_CALL_RETENTION_MS,
			NOW,
		]);
	});
});
