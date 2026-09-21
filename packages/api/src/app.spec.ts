import type { TempDatabase } from "./testing/temp-database.ts";

import { testClient } from "hono/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApp } from "./app.ts";
import { createLogger } from "./lib/logger.ts";
import * as accountsService from "./services/accounts.ts";
import { createTempDatabase } from "./testing/temp-database.ts";

let temp: TempDatabase;
let logLines: string[];

function buildApp(db = temp.db) {
	logLines = [];
	const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

	return createApp({ db, timeZone: "Europe/Paris", logger });
}

// Each listing test owns its database, so it passes alone or in any order.
let own: TempDatabase | undefined;

async function ownClient() {
	own = await createTempDatabase();

	return testClient(buildApp(own.db)).api.accounts;
}

const errorBody = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		fields: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
	}),
});

// Raw requests, for bodies the typed client would refuse to compile.
async function postRaw(body: unknown) {
	const response = await buildApp().request("/api/accounts", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

	return { status: response.status, body: errorBody.parse(await response.json()) };
}

const valid = {
	name: "Compte joint",
	type: "depository",
	subtype: "checking",
	currency: "EUR",
	openingBalance: "1 234,56",
	openingDate: "2026-09-01",
} as const;

beforeAll(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
	await own?.dispose();
	own = undefined;
});

describe("POST /api/accounts", () => {
	it("creates a checking account with its opening balance", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({ json: valid });

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({
			name: "Compte joint",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			balance: 123456,
		});
		expect(data.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it("rejects a blank name with its field code", async () => {
		await expect(postRaw({ ...valid, name: "  " })).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "name", code: "too_small" }],
				},
			},
		});
	});

	it.each([
		["12,3,4", "EUR"],
		["1,234", "JPY"],
	])("rejects the amount %j in %s", async (openingBalance, currency) => {
		const { status, body } = await postRaw({ ...valid, openingBalance, currency });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "openingBalance", code: "invalid_amount" }]);
	});

	it("rejects an unknown currency", async () => {
		const { status, body } = await postRaw({ ...valid, currency: "XYZ" });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "currency", code: "invalid_currency" }]);
	});

	it("rejects a subtype that does not match the type", async () => {
		const { body } = await postRaw({ ...valid, type: "credit_card" });

		expect(body.error.fields).toEqual([{ path: "subtype", code: "invalid_subtype" }]);
	});

	it("reports every invalid field at once", async () => {
		const { body } = await postRaw({ ...valid, name: "", openingBalance: "abc" });

		expect(body.error.fields).toEqual([
			{ path: "name", code: "too_small" },
			{ path: "openingBalance", code: "invalid_amount" },
		]);
	});

	it("rejects an opening date before 1900", async () => {
		const { status, body } = await postRaw({ ...valid, openingDate: "1899-12-31" });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "openingDate", code: "date_too_early" }]);
	});

	it("answers a body that is not JSON with VALIDATION_ERROR", async () => {
		const { status, body } = await postRaw("{");

		expect(status).toBe(400);
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});

describe("GET /api/accounts", () => {
	it("groups assets and liabilities with totals in the reporting currency", async () => {
		const client = await ownClient();
		await client.$post({ json: valid });
		await client.$post({
			json: { ...valid, name: "Livret A", subtype: "savings", openingBalance: "100" },
		});
		await client.$post({
			json: {
				...valid,
				name: "Épargne US",
				subtype: "savings",
				currency: "USD",
				openingBalance: "10.00",
			},
		});
		await client.$post({
			json: {
				...valid,
				name: "Carte",
				type: "credit_card",
				subtype: null,
				openingBalance: "490,30",
			},
		});

		const response = await client.$get();
		const { data } = await response.json();

		expect(response.status).toBe(200);
		expect(data.reportingCurrency).toBe("EUR");
		const [assets, liabilities] = data.groups;
		expect(assets?.classification).toBe("asset");
		expect(assets?.accounts.map((account) => account.name)).toEqual([
			"Compte joint",
			"Épargne US",
			"Livret A",
		]);
		expect(assets?.total).toBe(123456 + 10000);
		expect(assets?.excludedCount).toBe(1);
		expect(liabilities).toMatchObject({
			classification: "liability",
			total: 49030,
			excludedCount: 0,
			accounts: [{ name: "Carte", balance: 49030, currency: "EUR" }],
		});
	});

	it("lists today's balance by the Paris date, already the next day at 23:30 UTC", async () => {
		vi.setSystemTime(new Date("2026-09-21T23:30:00Z"));
		const client = await ownClient();
		await client.$post({ json: { ...valid, openingDate: "2026-09-22" } });

		const { data } = await (await client.$get()).json();

		expect(data.groups[0]?.accounts[0]?.balance).toBe(123456);
	});

	it("lists an account opening after today at zero", async () => {
		const client = await ownClient();
		await client.$post({ json: { ...valid, openingDate: "2026-09-30" } });

		const { data } = await (await client.$get()).json();

		expect(data.groups[0]?.accounts[0]?.balance).toBe(0);
		expect(data.groups[0]?.total).toBe(0);
	});
});

describe("errors", () => {
	it("answers an unknown route with NOT_FOUND", async () => {
		const response = await buildApp().request("/api/nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json())).toEqual({
			error: { code: "NOT_FOUND", message: "No route matches GET /api/nope" },
		});
	});

	it("hides an unexpected failure behind INTERNAL_ERROR and logs its name and path only", async () => {
		vi.spyOn(accountsService, "listAccounts").mockRejectedValue(
			new Error("SQLITE_ERROR: params [123456, 'FR76 1234']"),
		);

		const response = await buildApp().request("/api/accounts");
		const body = await response.text();

		expect(response.status).toBe(500);
		expect(errorBody.parse(JSON.parse(body))).toEqual({
			error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
		});
		expect(body).not.toContain("123456");
		expect(logLines).toHaveLength(1);
		expect(logLines[0]).toContain('"path":"/api/accounts"');
		expect(logLines[0]).toContain('"error":"Error"');
		expect(logLines[0]).not.toContain("123456");
		expect(logLines[0]).not.toContain("stack");
	});
});
