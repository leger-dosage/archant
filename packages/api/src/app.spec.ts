import type { CreateAccountInput } from "./schemas/accounts.ts";
import type { TempDatabase } from "./testing/temp-database.ts";

import { sql } from "drizzle-orm";
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

async function request(method: string, path: string, body?: unknown) {
	const response = await buildApp().request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

async function openAccount(overrides: Partial<CreateAccountInput> = {}) {
	const response = await testClient(buildApp()).api.accounts.$post({
		json: { ...valid, ...overrides },
	});

	return (await response.json()).data;
}

const expense = { date: "2026-09-10", label: "Boulangerie", amount: "-42,90" };

async function postTransaction(accountId: string, json: Record<string, string | null>) {
	return request("POST", `/api/accounts/${accountId}/transactions`, json);
}

async function balanceOf(accountId: string) {
	const response = await testClient(buildApp()).api.accounts[":id"].$get({
		param: { id: accountId },
	});

	return (await response.json()).data.balance;
}

describe("GET /api/accounts/:id", () => {
	it("returns the account with its classification and opening date", async () => {
		const account = await openAccount();

		const response = await testClient(buildApp()).api.accounts[":id"].$get({
			param: { id: account.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: account.id,
			name: "Compte joint",
			classification: "asset",
			openingDate: "2026-09-01",
			balance: 123456,
		});
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("POST /api/accounts/:id/transactions", () => {
	it("records an expense in the account's currency and moves the balance", async () => {
		const account = await openAccount();

		const response = await testClient(buildApp()).api.accounts[":id"].transactions.$post({
			param: { id: account.id },
			json: expense,
		});

		expect(response.status).toBe(201);
		expect((await response.json()).data).toMatchObject({
			accountId: account.id,
			date: "2026-09-10",
			label: "Boulangerie",
			amount: -4290,
			currency: "EUR",
			notes: null,
			source: "manual",
		});
		await expect(balanceOf(account.id)).resolves.toBe(119166);
	});

	it("raises a card's amount owed on a purchase", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});

		const { status } = await postTransaction(card.id, { ...expense, amount: "-30,00" });

		expect(status).toBe(201);
		await expect(balanceOf(card.id)).resolves.toBe(52030);
	});

	it("trims the label, stores blank notes as null and accepts a zero amount", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			label: "  Boulangerie  ",
			amount: "0",
			notes: "   ",
		});

		expect(status).toBe(201);
		expect(body).toMatchObject({ data: { label: "Boulangerie", amount: 0, notes: null } });
	});

	it.each(["2026-09-01", "2026-08-31"])(
		"refuses a transaction dated %s, on or before the opening date",
		async (date) => {
			const account = await openAccount();

			const { status, body } = await postTransaction(account.id, { ...expense, date });

			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "date", code: "not_after_opening_date" }],
			});
		},
	);

	it("refuses a date more than 366 days after today", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			date: "2027-10-26",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "date_too_late" }]);
	});

	it("reports a blank label and a bad amount together", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			label: "  ",
			amount: "12,3,4",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "label", code: "too_small" },
			{ path: "amount", code: "invalid_amount" },
		]);
	});

	it("refuses a label over 200 characters and notes over 2 000", async () => {
		const account = await openAccount();

		const { body } = await postTransaction(account.id, {
			...expense,
			label: "a".repeat(201),
			notes: "a".repeat(2001),
		});

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "label", code: "too_big" },
			{ path: "notes", code: "too_big" },
		]);
	});

	it("refuses a body whose fields are not text", async () => {
		const account = await openAccount();

		const { status, body } = await request("POST", `/api/accounts/${account.id}/transactions`, {
			...expense,
			amount: -42.9,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "amount", code: "invalid_type" }]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await postTransaction("nope", expense);

		expect(status).toBe(404);
	});
});

describe("GET /api/accounts/:id/transactions", () => {
	it("lists most recent first, 50 per page by default", async () => {
		const account = await ownClient();
		const created = await (await account.$post({ json: valid })).json();
		const id = created.data.id;
		const client = testClient(buildApp(own?.db)).api.accounts[":id"].transactions;
		await client.$post({ param: { id }, json: { ...expense, label: "A" } });
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		await client.$post({ param: { id }, json: { ...expense, label: "B" } });
		await client.$post({ param: { id }, json: { ...expense, date: "2026-09-02", label: "C" } });

		const response = await client.$get({ param: { id }, query: {} });
		const { data } = await response.json();

		expect(response.status).toBe(200);
		expect(data.items.map((item) => item.label)).toEqual(["B", "A", "C"]);
		expect(data).toMatchObject({ page: 1, pageSize: 50, total: 3 });

		const second = await (
			await client.$get({ param: { id }, query: { page: "2", pageSize: "2" } })
		).json();
		expect(second.data.items.map((item) => item.label)).toEqual(["C"]);
	});

	it.each([
		["page=0", "page"],
		["pageSize=201", "pageSize"],
	])("refuses %s", async (query, path) => {
		const account = await openAccount();

		const { status, body } = await request(
			"GET",
			`/api/accounts/${account.id}/transactions?${query}`,
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe(path);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope/transactions");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("PATCH /api/transactions/:id", () => {
	it("moves and changes a transaction, and the balance follows", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$patch({
			param: { id: data.id },
			json: { date: "2026-09-05", amount: "-50,00" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			date: "2026-09-05",
			amount: -5000,
			label: "Boulangerie",
		});
		await expect(balanceOf(account.id)).resolves.toBe(118456);
	});

	it("clears notes sent blank", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, { ...expense, notes: "Pain" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { body } = await request("PATCH", `/api/transactions/${data.id}`, { notes: " " });

		expect(body).toMatchObject({ data: { notes: null } });
	});

	it("refuses a move onto the opening date", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			date: "2026-09-01",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "date", code: "not_after_opening_date" },
		]);
	});

	it("refuses an invalid amount", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			amount: "abc",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "amount", code: "invalid_amount" },
		]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status } = await request("PATCH", "/api/transactions/nope", { label: "x" });

		expect(status).toBe(404);
	});
});

describe("DELETE /api/transactions/:id", () => {
	it("deletes the transaction and puts the balance back", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$delete({
			param: { id: data.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: data.id } });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status, body } = await request("DELETE", "/api/transactions/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("the opening anchor", () => {
	async function anchorOf(accountId: string) {
		// Raw on purpose: only the ledger may import the entries table (AD-2).
		const [anchor] = await temp.db.all<{ id: string; date: string; amount: number }>(
			sql`select id, date, amount from entries where account_id = ${accountId} and valuation_kind = 'opening_anchor'`,
		);

		if (anchor === undefined) {
			throw new Error("The account has no opening anchor.");
		}

		return anchor;
	}

	it("cannot be deleted as a transaction", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const { status, body } = await request("DELETE", `/api/transactions/${anchor.id}`);

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
		await expect(anchorOf(account.id)).resolves.toEqual(anchor);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("cannot be edited as a transaction", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const { status, body } = await request("PATCH", `/api/transactions/${anchor.id}`, {
			amount: "0",
			date: "2026-09-10",
		});

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
		await expect(anchorOf(account.id)).resolves.toEqual(anchor);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
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
