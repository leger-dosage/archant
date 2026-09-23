import type { CreateAccountInput } from "./schemas/accounts.ts";
import type { CreateCategoryInput } from "./schemas/categories.ts";
import type { SignedInTemplate } from "./testing/auth.ts";
import type { TempDatabase } from "./testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import { createLogger } from "./lib/logger.ts";
import { MAX_IMPORT_BYTES } from "./schemas/imports.ts";
import * as accountsService from "./services/accounts.ts";
import { purgeStalePreviews } from "./services/imports.ts";
import { buildTestApp, createSignedInTemplate, withSession } from "./testing/auth.ts";
import { createTempDatabase } from "./testing/temp-database.ts";

let template: SignedInTemplate;
let temp: TempDatabase;
let logLines: string[];

// Signed in as the administrator: every request carries the session cookie
// and the interface's origin. Unauthenticated behaviour lives in
// routes/middleware/auth.spec.ts.
function buildApp(db = temp.db) {
	logLines = [];
	const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

	return withSession(buildTestApp(db, logger), template.cookie);
}

/** A database of its own, already holding the signed-in administrator. */
async function freshDatabase() {
	return createTempDatabase(template.file);
}

// Each listing test owns its database, so it passes alone or in any order.
let own: TempDatabase | undefined;

async function ownClient() {
	own = await freshDatabase();

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
	vi.useFakeTimers({ toFake: ["Date"] });
	// A session lasts seven days and Better Auth deletes it once expired. Signed
	// in on the latest day any test moves the clock to, it outlives them all;
	// only its expiry is checked, so a clock set before its creation is fine.
	vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
	template = await createSignedInTemplate();
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
	temp = await freshDatabase();
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
	await template.dispose();
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
			source: { kind: "manual" },
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

async function balancesOf(accountId: string, period?: "1M" | "3M" | "6M" | "1Y" | "all") {
	const response = await testClient(buildApp()).api.accounts[":id"].balances.$get({
		param: { id: accountId },
		query: period === undefined ? {} : { period },
	});

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("GET /api/accounts/:id/balances", () => {
	it("returns one point per day of the last month by default", async () => {
		const account = await openAccount({ openingDate: "2026-01-10" });

		const data = await balancesOf(account.id);

		expect(data).toMatchObject({
			period: "1M",
			from: "2026-08-21",
			to: "2026-09-21",
			currency: "EUR",
			change: { amount: 0, percent: 0 },
		});
		expect(data.points).toHaveLength(32);
		expect(data.points[0]).toEqual({ date: "2026-08-21", balance: 123456 });
		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("fills every day up to today when nothing was written for a month", async () => {
		const account = await openAccount({ openingDate: "2026-08-01" });
		vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));

		const data = await balancesOf(account.id);

		expect(data).toMatchObject({ from: "2026-09-21", to: "2026-10-21" });
		expect(data.points).toHaveLength(31);
		expect(data.points.at(-1)).toEqual({ date: "2026-10-21", balance: 123456 });
		expect(data.change).toEqual({ amount: 0, percent: 0 });
	});

	it("ends the period on today's Paris date, already the next day at 23:30 UTC", async () => {
		vi.setSystemTime(new Date("2026-09-21T23:30:00Z"));
		const account = await openAccount({ openingDate: "2026-09-01" });

		const data = await balancesOf(account.id);

		expect(data.to).toBe("2026-09-22");
		expect(data.points.at(-1)).toEqual({ date: "2026-09-22", balance: 123456 });
	});

	it("starts at the opening balance when the account is younger than the period", async () => {
		const account = await openAccount({ openingDate: "2026-09-01" });
		await postTransaction(account.id, { ...expense, amount: "12,40" });

		const data = await balancesOf(account.id, "6M");

		expect(data.from).toBe("2026-09-01");
		expect(data.points[0]).toEqual({ date: "2026-09-01", balance: 123456 });
		expect(data.change).toEqual({ amount: 1240, percent: 1 });
	});

	it("covers every day since the opening date for all", async () => {
		const account = await openAccount({ openingDate: "2024-02-29" });

		const data = await balancesOf(account.id, "all");

		expect(data.from).toBe("2024-02-29");
		// 2024-02-29 to 2026-09-21: 307 days left in 2024, 365 in 2025, 264 in 2026.
		expect(data.points).toHaveLength(936);
	});

	it("clamps the start of a month to the end of a shorter one", async () => {
		vi.setSystemTime(new Date("2026-03-31T10:00:00Z"));
		const account = await openAccount({ openingDate: "2026-01-01" });

		const data = await balancesOf(account.id, "1M");

		expect(data.from).toBe("2026-02-28");
		expect(data.points[0]?.date).toBe("2026-02-28");
	});

	it("stops at today, leaving out the rows of a future transaction", async () => {
		const account = await openAccount();
		await postTransaction(account.id, { ...expense, date: "2026-10-01" });

		const data = await balancesOf(account.id, "1M");

		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("plots a card's amount owed, positive, rising with a purchase", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});
		await postTransaction(card.id, { ...expense, date: "2026-09-21", amount: "-30,00" });

		const data = await balancesOf(card.id);

		expect(data.points.at(-1)?.balance).toBe(52030);
		expect(data.change?.amount).toBe(3000);
	});

	it("gives no percentage when the period starts at zero", async () => {
		const account = await openAccount({ openingBalance: "0" });
		await postTransaction(account.id, { ...expense, amount: "100,00" });

		const data = await balancesOf(account.id);

		expect(data.change).toEqual({ amount: 10000, percent: null });
	});

	it("is empty for an account opening after today", async () => {
		const account = await openAccount({ openingDate: "2026-09-30" });

		const data = await balancesOf(account.id, "all");

		expect(data).toMatchObject({ from: null, to: "2026-09-21", points: [], change: null });
	});

	it("refuses an unknown period", async () => {
		const account = await openAccount();

		const { status, body } = await request("GET", `/api/accounts/${account.id}/balances?period=2W`);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "period", code: "invalid_value" }],
		});
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope/balances");

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

	it("excludes a transaction from reports and leaves the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$patch({
			param: { id: data.id },
			json: { excluded: true },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ excluded: true, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);
	});

	it("refuses an exclusion that is not a boolean", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			excluded: "yes",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("excluded");
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status } = await request("PATCH", "/api/transactions/nope", { label: "x" });

		expect(status).toBe(404);
	});

	it("sets and clears a category, leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const groceries = await createCategory(uniqueCategory("Courses"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({ param: { id: data.id }, json: { categoryId: groceries.id } });

		expect(set.status).toBe(200);
		expect((await set.json()).data).toMatchObject({ categoryId: groceries.id, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const cleared = await client.$patch({ param: { id: data.id }, json: { categoryId: null } });

		expect((await cleared.json()).data).toMatchObject({ categoryId: null });
	});

	it("locks a category set by hand, and leaves an unchanged one unlocked", async () => {
		const account = await openAccount();
		const set = z
			.object({ data: z.object({ id: z.string() }) })
			.parse((await postTransaction(account.id, expense)).body).data.id;
		const unchanged = z
			.object({ data: z.object({ id: z.string() }) })
			.parse((await postTransaction(account.id, expense)).body).data.id;
		const groceries = await createCategory(uniqueCategory("Courses"));
		const locksOf = async (id: string) =>
			(
				await temp.db.get<{ locked: string }>(
					sql`select locked_fields as locked from transactions where entry_id = ${id}`,
				)
			)?.locked;

		await request("PATCH", `/api/transactions/${set}`, { categoryId: groceries.id });
		// The sheet sends the category it shows, whatever else it saves.
		await request("PATCH", `/api/transactions/${unchanged}`, {
			categoryId: null,
			label: "Autre",
		});

		// A transaction typed by hand starts with its date, amount and label locked.
		await expect(locksOf(set)).resolves.toBe('["date","amount","label","category"]');
		await expect(locksOf(unchanged)).resolves.toBe('["date","amount","label"]');
	});

	it("refuses an unknown category and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			categoryId: "x",
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "categoryId", code: "invalid_value" }],
		});
		// An empty patch answers the transaction as it stands.
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", categoryId: null } });
	});

	it("sets and clears a merchant, locking it and leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const carrefour = await createMerchant(uniqueCategory("Carrefour"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({ param: { id: data.id }, json: { merchantId: carrefour.id } });

		expect(set.status).toBe(200);
		expect((await set.json()).data).toMatchObject({ merchantId: carrefour.id, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const cleared = await client.$patch({ param: { id: data.id }, json: { merchantId: null } });

		expect((await cleared.json()).data).toMatchObject({ merchantId: null });
		await expect(
			temp.db.get(
				sql`select locked_fields as locked from transactions where entry_id = ${data.id}`,
			),
		).resolves.toEqual({ locked: '["date","amount","label","merchant"]' });
	});

	it("refuses an unknown merchant and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			merchantId: "x",
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "merchantId", code: "invalid_value" }],
		});
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", merchantId: null } });
	});

	it("sets, replaces and clears tags, locking them and leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const holidays = await createTag(uniqueCategory("Vacances"));
		const work = await createTag(uniqueCategory("Travaux"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({
			param: { id: data.id },
			json: { tagIds: [holidays.id, work.id, holidays.id] },
		});

		expect(set.status).toBe(200);
		const setData = (await set.json()).data;
		expect(setData).toMatchObject({ amount: -4290 });
		expect(setData.tagIds.toSorted()).toEqual([holidays.id, work.id].toSorted());
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const replaced = await client.$patch({ param: { id: data.id }, json: { tagIds: [work.id] } });

		expect((await replaced.json()).data).toMatchObject({ tagIds: [work.id] });

		const cleared = await client.$patch({ param: { id: data.id }, json: { tagIds: [] } });

		expect((await cleared.json()).data).toMatchObject({ tagIds: [] });
		await expect(
			temp.db.get(
				sql`select locked_fields as locked from transactions where entry_id = ${data.id}`,
			),
		).resolves.toEqual({ locked: '["date","amount","label","tags"]' });
	});

	it("refuses an unknown tag and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const holidays = await createTag(uniqueCategory("Vacances"));

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			tagIds: [holidays.id, "x"],
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "tagIds", code: "invalid_value" }],
		});
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", tagIds: [] } });
	});

	it("refuses more tags than the cap and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			tagIds: Array.from({ length: 21 }, (_, index) => `t${index}`),
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("tagIds");
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { tagIds: [] } });
	});
});

const listItem = z.object({
	id: z.string(),
	accountId: z.string(),
	accountName: z.string(),
	date: z.string(),
	label: z.string(),
	amount: z.number(),
	excluded: z.boolean(),
	categoryId: z.string().nullable(),
	merchantId: z.string().nullable(),
	tagIds: z.array(z.string()),
	transfer: z
		.object({
			id: z.string(),
			kind: z.string(),
			counterpartAccountId: z.string(),
			counterpartAccountName: z.string(),
		})
		.nullable(),
});

const listBody = z.object({
	data: z.object({
		items: z.array(listItem),
		page: z.number(),
		pageSize: z.number(),
		total: z.number(),
		sum: z.object({ amount: z.number(), currency: z.string(), skippedCount: z.number() }),
	}),
});

/** The I/O matrix of Story 1.5, each test in its own database. */
async function listOwn(query: string) {
	const response = await buildApp(own?.db).request(`/api/transactions${query}`);
	const body = z.unknown().parse(await response.json());

	return { status: response.status, body };
}

async function listed(query: string) {
	const { status, body } = await listOwn(query);

	expect(status, JSON.stringify(body)).toBe(200);

	return listBody.parse(body).data;
}

async function openOwn(overrides: Partial<CreateAccountInput> = {}) {
	own ??= await freshDatabase();
	const response = await testClient(buildApp(own.db)).api.accounts.$post({
		json: { ...valid, ...overrides },
	});

	return (await response.json()).data;
}

async function postOwn(accountId: string, json: Record<string, string>) {
	const response = await buildApp(own?.db).request(`/api/accounts/${accountId}/transactions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(json),
	});

	return z.object({ data: z.object({ id: z.string() }) }).parse(await response.json()).data.id;
}

describe("GET /api/transactions", () => {
	it("lists every account's transactions, most recent first, with the account's name", async () => {
		const checking = await openOwn();
		const card = await openOwn({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "0",
		});
		await [checking, card, checking, card, checking, card].reduce(
			async (previous, account, index) => {
				await previous;
				await postOwn(account.id, {
					...expense,
					date: `2026-09-${String(index + 2).padStart(2, "0")}`,
					label: `L${index}`,
				});
			},
			Promise.resolve(),
		);

		const data = await listed("");

		expect(data.items.map((item) => item.label)).toEqual(["L5", "L4", "L3", "L2", "L1", "L0"]);
		expect(data).toMatchObject({ page: 1, pageSize: 50, total: 6 });
		expect(data.items[0]).toMatchObject({ accountName: "Carte", excluded: false });
		expect(data.items[1]).toMatchObject({ accountName: "Compte joint" });
	});

	it("combines account, start date and text in the label or the notes", async () => {
		const checking = await openOwn();
		const card = await openOwn({ name: "Carte", type: "credit_card", subtype: null });
		await postOwn(checking.id, { ...expense, date: "2026-09-02", label: "Carrefour" });
		await postOwn(checking.id, { ...expense, date: "2026-09-03", label: "CB CARREFOUR" });
		await postOwn(checking.id, {
			...expense,
			date: "2026-09-04",
			label: "Épicerie",
			notes: "Carrefour",
		});
		await postOwn(checking.id, { ...expense, date: "2026-09-05", label: "Boulangerie" });
		await postOwn(card.id, { ...expense, date: "2026-09-05", label: "Carrefour" });

		const data = await listed(`?account=${checking.id}&from=2026-09-03&q=carre`);

		expect(data.items.map((item) => item.label)).toEqual(["Épicerie", "CB CARREFOUR"]);
		expect(data.total).toBe(2);
	});

	it("takes several accounts", async () => {
		const checking = await openOwn();
		const savings = await openOwn({ name: "Livret", subtype: "savings" });
		const other = await openOwn({ name: "Autre" });
		await postOwn(checking.id, { ...expense, label: "A" });
		await postOwn(savings.id, { ...expense, label: "B" });
		await postOwn(other.id, { ...expense, label: "C" });

		const data = await listed(`?account=${checking.id}&account=${savings.id}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["A", "B"]);
	});

	it("bounds the absolute amount", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, label: "Dépense", amount: "-42,90" });
		await postOwn(account.id, { ...expense, label: "Revenu", amount: "45,00" });
		await postOwn(account.id, { ...expense, label: "Petite", amount: "-12,00" });

		const data = await listed("?amountMin=40&amountMax=50");

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Dépense", "Revenu"]);
	});

	it("rounds a bound finer than the minor unit inward", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, label: "Juste", amount: "-42,90" });

		await expect(listed("?amountMin=42,895")).resolves.toMatchObject({ total: 1 });
		await expect(listed("?amountMin=42,901")).resolves.toMatchObject({ total: 0 });
		await expect(listed("?amountMax=42,899")).resolves.toMatchObject({ total: 0 });
	});

	it("matches a % in the text literally", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, label: "Remise 50%" });
		await postOwn(account.id, { ...expense, label: "Remise 500" });

		const data = await listed(`?q=${encodeURIComponent("50%")}`);

		expect(data.items.map((item) => item.label)).toEqual(["Remise 50%"]);
	});

	it("totals the reporting currency, excluded rows included, and counts the others", async () => {
		const account = await openOwn();
		const dollars = await openOwn({ name: "Dollars", currency: "USD", openingBalance: "0" });
		const excluded = await postOwn(account.id, { ...expense, amount: "-42,90" });
		await buildApp(own?.db).request(`/api/transactions/${excluded}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ excluded: true }),
		});
		await postOwn(account.id, { ...expense, amount: "100,00" });
		await postOwn(dollars.id, { ...expense, amount: "-10.00" });

		const data = await listed("");

		expect(data.sum).toEqual({ amount: 5710, currency: "EUR", skippedCount: 1 });
		expect(data.total).toBe(3);
		expect(data.items.find((item) => item.id === excluded)?.excluded).toBe(true);
	});

	it("filters on a parent category, its children included", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const parent = await (await client.categories.$post({ json: category("Logement") })).json();
		const child = await (
			await client.categories.$post({ json: category("Loyer", { parentId: parent.data.id }) })
		).json();
		const other = await (await client.categories.$post({ json: category("Loisirs") })).json();
		const onParent = await postOwn(account.id, { ...expense, label: "Travaux" });
		const onChild = await postOwn(account.id, { ...expense, label: "Loyer" });
		const onOther = await postOwn(account.id, { ...expense, label: "Cinéma" });
		await postOwn(account.id, { ...expense, label: "Virement" });
		await [
			[onParent, parent.data.id],
			[onChild, child.data.id],
			[onOther, other.data.id],
		].reduce(async (previous, [id = "", categoryId = ""]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { categoryId } });
		}, Promise.resolve());

		const data = await listed(`?category=${parent.data.id}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Loyer", "Travaux"]);
		expect(data.sum).toEqual({ amount: -8580, currency: "EUR", skippedCount: 0 });
		await expect(listed(`?category=${child.data.id}`)).resolves.toMatchObject({ total: 1 });
	});

	it("filters on « Sans catégorie » and a category together, and matches nothing for an unknown one", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const leisure = await (await client.categories.$post({ json: category("Loisirs") })).json();
		const onLeisure = await postOwn(account.id, { ...expense, label: "Cinéma" });
		await postOwn(account.id, { ...expense, label: "Virement" });
		await client.transactions[":id"].$patch({
			param: { id: onLeisure },
			json: { categoryId: leisure.data.id },
		});

		const data = await listed(`?category=none&category=${leisure.data.id}`);
		const uncategorised = await listed("?category=none");

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Cinéma", "Virement"]);
		expect(uncategorised.items.map((item) => item.label)).toEqual(["Virement"]);
		expect(uncategorised.items[0]?.categoryId).toBeNull();
		await expect(listed("?category=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("filters on merchants, ORed, with the count and the sum to match", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const merchantOf = async (name: string) =>
			(await (await client.merchants.$post({ json: { name } })).json()).data.id;
		const carrefour = await merchantOf("Carrefour");
		const lidl = await merchantOf("Lidl");
		const fnac = await merchantOf("Fnac");
		const rows = [
			[await postOwn(account.id, { ...expense, label: "CB CARREFOUR 1234" }), carrefour],
			[await postOwn(account.id, { ...expense, label: "LIDL" }), lidl],
			[await postOwn(account.id, { ...expense, label: "FNAC" }), fnac],
		];
		await postOwn(account.id, { ...expense, label: "Virement" });
		await rows.reduce(async (previous, [id = "", merchantId = ""]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { merchantId } });
		}, Promise.resolve());

		const data = await listed(`?merchant=${carrefour}&merchant=${lidl}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["CB CARREFOUR 1234", "LIDL"]);
		expect(new Set(data.items.map((item) => item.merchantId))).toEqual(new Set([carrefour, lidl]));
		expect(data.total).toBe(2);
		expect(data.sum).toEqual({ amount: -8580, currency: "EUR", skippedCount: 0 });
		await expect(listed("?merchant=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("filters on tags, ORed, listing and counting a row with both tags once", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const tagOf = async (name: string) =>
			(await (await client.tags.$post({ json: { name } })).json()).data.id;
		const holidays = await tagOf("Vacances");
		const work = await tagOf("Travaux");
		const other = await tagOf("Autre");
		const rows: [string, string[]][] = [
			[await postOwn(account.id, { ...expense, label: "Hôtel" }), [holidays, work]],
			[await postOwn(account.id, { ...expense, label: "Train" }), [holidays]],
			[await postOwn(account.id, { ...expense, label: "Livre" }), [other]],
		];
		await postOwn(account.id, { ...expense, label: "Virement" });
		await rows.reduce(async (previous, [id, tagIds]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { tagIds } });
		}, Promise.resolve());

		const data = await listed(`?tag=${holidays}&tag=${work}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Hôtel", "Train"]);
		expect(data.total).toBe(2);
		expect(data.sum).toEqual({ amount: -8580, currency: "EUR", skippedCount: 0 });
		await expect(listed("?tag=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("refuses an empty tag, and more tags than the cap", async () => {
		own = await freshDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `tag=t${index}`).join("&");

		const responses = await Promise.all([listOwn(`?${query}`), listOwn("?tag=")]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error.fields?.[0]?.path).toMatch(/^tag/u);
		}
	});

	it("refuses an empty merchant, and more merchants than the cap", async () => {
		own = await freshDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `merchant=m${index}`).join("&");

		const responses = await Promise.all([listOwn(`?${query}`), listOwn("?merchant=")]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error.fields?.[0]?.path).toMatch(/^merchant/u);
		}
	});

	it("refuses more categories than the cap", async () => {
		own = await freshDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `category=c${index}`).join("&");

		const { status, body } = await listOwn(`?${query}`);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("category");
	});

	it("answers an empty page for an unknown account", async () => {
		const account = await openOwn();
		await postOwn(account.id, expense);

		const data = await listed("?account=nope");

		expect(data).toMatchObject({ items: [], total: 0 });
		expect(data.sum).toEqual({ amount: 0, currency: "EUR", skippedCount: 0 });
	});

	it("pages", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, date: "2026-09-03", label: "A" });
		await postOwn(account.id, { ...expense, date: "2026-09-02", label: "B" });

		const data = await listed("?page=2&pageSize=1");

		expect(data.items.map((item) => item.label)).toEqual(["B"]);
		expect(data).toMatchObject({ page: 2, pageSize: 1, total: 2 });
	});

	it.each([
		["?from=2026-09-10&to=2026-09-01", "to", "before_from"],
		["?amountMin=abc", "amountMin", "invalid_amount"],
		["?amountMax=-5", "amountMax", "invalid_amount"],
		["?amountMin=60&amountMax=50", "amountMax", "below_min"],
		["?from=10/09/2026", "from", "invalid_format"],
	])("refuses %s", async (query, path, code) => {
		own = await freshDatabase();

		const { status, body } = await listOwn(query);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code }],
		});
	});

	it("types its query for the interface's client", async () => {
		const account = await openOwn();
		await postOwn(account.id, expense);

		const response = await testClient(buildApp(own?.db)).api.transactions.$get({
			query: { account: [account.id], category: ["none"], amountMin: "1", q: "boul" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.items[0]?.accountName).toBe("Compte joint");
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

// The I/O matrix of Story 1.4: checking opened on 2026-01-10 at 1 500,00, a
// -120,00 on 2026-03-02, and the clock at 2026-09-21.
const pinned = { openingBalance: "1 500,00", openingDate: "2026-01-10" };

const snapshotItem = z.object({
	id: z.string(),
	accountId: z.string(),
	date: z.string(),
	balance: z.number(),
	computed: z.number(),
	gap: z.number(),
	currency: z.string(),
});

const snapshotPage = z.object({
	data: z.object({
		items: z.array(snapshotItem),
		page: z.number(),
		pageSize: z.number(),
		total: z.number(),
	}),
});

async function openPinned(overrides: Partial<CreateAccountInput> = {}) {
	const account = await openAccount({ ...pinned, ...overrides });
	await postTransaction(account.id, { date: "2026-03-02", label: "Courses", amount: "-120,00" });

	return account;
}

async function postSnapshot(accountId: string, json: Record<string, string>) {
	return request("POST", `/api/accounts/${accountId}/snapshots`, json);
}

async function recorded(accountId: string, json: Record<string, string>) {
	const { status, body } = await postSnapshot(accountId, json);

	expect(status).toBe(201);

	return z.object({ data: snapshotItem }).parse(body).data;
}

async function snapshotsOf(accountId: string) {
	const { body } = await request("GET", `/api/accounts/${accountId}/snapshots`);

	return snapshotPage.parse(body).data;
}

async function balanceOnDay(accountId: string, date: string) {
	// The chart's data: every day since the opening date.
	const response = await testClient(buildApp()).api.accounts[":id"].balances.$get({
		param: { id: accountId },
		query: { period: "all" },
	});
	const { points } = (await response.json()).data;

	return points.find((point) => point.date === date)?.balance;
}

describe("POST /api/accounts/:id/snapshots", () => {
	it("pins the balance on its date; the next day continues from it", async () => {
		const account = await openPinned();

		const response = await testClient(buildApp()).api.accounts[":id"].snapshots.$post({
			param: { id: account.id },
			json: { date: "2026-03-05", balance: "2 000,00" },
		});
		await postTransaction(account.id, { date: "2026-03-06", label: "Pain", amount: "-50,00" });

		expect(response.status).toBe(201);
		expect((await response.json()).data).toMatchObject({
			accountId: account.id,
			date: "2026-03-05",
			balance: 200000,
			computed: 138000,
			gap: 62000,
			currency: "EUR",
		});
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(200000);
		await expect(balanceOnDay(account.id, "2026-03-06")).resolves.toBe(195000);
		await expect(balanceOf(account.id)).resolves.toBe(195000);
	});

	it("keeps the day at the snapshot when a transaction lands on it, and widens the gap", async () => {
		const account = await openPinned();
		await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		await postTransaction(account.id, { date: "2026-03-05", label: "Pain", amount: "-30,00" });

		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(200000);
		const { items } = await snapshotsOf(account.id);
		expect(items[0]).toMatchObject({ balance: 200000, computed: 135000, gap: 65000 });
	});

	it("replaces the snapshot of the same date, keeping its id", async () => {
		const account = await openPinned();
		const first = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const second = await recorded(account.id, { date: "2026-03-05", balance: "1 990,00" });

		expect(second).toMatchObject({ id: first.id, balance: 199000 });
		const list = await snapshotsOf(account.id);
		expect(list.total).toBe(1);
		expect(list.items).toHaveLength(1);
	});

	it("stores a card's amount owed and an overdraft as typed", async () => {
		const card = await openAccount({
			...pinned,
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});
		const checking = await openPinned();

		const owed = await recorded(card.id, { date: "2026-03-05", balance: "520,00" });
		const overdraft = await recorded(checking.id, { date: "2026-03-05", balance: "-80,00" });

		expect(owed).toMatchObject({ balance: 52000, computed: 49030, gap: 52000 - 49030 });
		expect(overdraft).toMatchObject({ balance: -8000 });
	});

	it("refuses the opening date and tomorrow on the date field", async () => {
		const account = await openPinned();

		const opening = await postSnapshot(account.id, { date: "2026-01-10", balance: "1,00" });
		const tomorrow = await postSnapshot(account.id, { date: "2026-09-22", balance: "1,00" });

		expect(opening.status).toBe(400);
		expect(errorBody.parse(opening.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "date", code: "not_after_opening_date" }],
		});
		expect(tomorrow.status).toBe(400);
		expect(errorBody.parse(tomorrow.body).error.fields).toEqual([
			{ path: "date", code: "date_in_future" },
		]);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("refuses a balance with too many decimals for the currency", async () => {
		const account = await openPinned();

		const { status, body } = await postSnapshot(account.id, {
			date: "2026-03-05",
			balance: "12,345",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("refuses a missing balance and a malformed date", async () => {
		const account = await openPinned();

		const missing = await request("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-03-05",
		});
		const malformed = await postSnapshot(account.id, { date: "05/03/2026", balance: "1,00" });

		expect(missing.status).toBe(400);
		expect(errorBody.parse(missing.body).error.fields).toEqual([
			{ path: "balance", code: "invalid_type" },
		]);
		expect(malformed.status).toBe(400);
		expect(errorBody.parse(malformed.body).error.fields).toEqual([
			{ path: "date", code: "invalid_format" },
		]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await postSnapshot("nope", { date: "2026-03-05", balance: "1,00" });

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("GET /api/accounts/:id/snapshots", () => {
	it("lists snapshots most recent first, paged", async () => {
		const account = await openPinned();
		const older = await recorded(account.id, { date: "2026-02-20", balance: "1 900,00" });
		const newer = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.accounts[":id"].snapshots.$get({
			param: { id: account.id },
			query: { page: "2", pageSize: "1" },
		});
		const all = await snapshotsOf(account.id);

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({
			items: [older],
			page: 2,
			pageSize: 1,
			total: 2,
		});
		expect(all.items.map((item) => item.id)).toEqual([newer.id, older.id]);
		expect(all).toMatchObject({ page: 1, pageSize: 50 });
	});

	it("refuses a page size over the maximum", async () => {
		const account = await openPinned();

		const { status } = await request("GET", `/api/accounts/${account.id}/snapshots?pageSize=201`);

		expect(status).toBe(400);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await request("GET", "/api/accounts/nope/snapshots");

		expect(status).toBe(404);
	});
});

describe("PATCH /api/snapshots/:id", () => {
	it("moves a snapshot earlier and recomputes from the new date", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.snapshots[":id"].$patch({
			param: { id: snapshot.id },
			json: { date: "2026-02-20" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: snapshot.id,
			date: "2026-02-20",
			balance: 200000,
			computed: 150000,
			gap: 50000,
		});
		await expect(balanceOnDay(account.id, "2026-02-20")).resolves.toBe(200000);
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(188000);
	});

	it("changes the balance", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			balance: "-80,00",
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { balance: -8000 } });
		await expect(balanceOf(account.id)).resolves.toBe(-8000);
	});

	it("refuses a date another snapshot holds and writes nothing", async () => {
		const account = await openPinned();
		await recorded(account.id, { date: "2026-02-20", balance: "1 900,00" });
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			date: "2026-02-20",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "snapshot_exists" }]);
		const list = await snapshotsOf(account.id);
		expect(list.total).toBe(2);
		expect(list.items[0]).toMatchObject({ id: snapshot.id, date: "2026-03-05" });
		await expect(balanceOf(account.id)).resolves.toBe(200000);
	});

	it("refuses an invalid balance", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			balance: "abc",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);
	});

	it("refuses a malformed date and writes nothing", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			date: "2026-02-5",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "invalid_format" }]);
		const { items } = await snapshotsOf(account.id);
		expect(items[0]).toMatchObject({ id: snapshot.id, date: "2026-03-05" });
	});

	it("answers NOT_FOUND for an unknown snapshot and for a transaction's id", async () => {
		const account = await openPinned();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const unknown = await request("PATCH", "/api/snapshots/nope", { balance: "1,00" });
		const transaction = await request("PATCH", `/api/snapshots/${data.id}`, { balance: "1,00" });

		expect(unknown.status).toBe(404);
		expect(transaction.status).toBe(404);
	});
});

describe("DELETE /api/snapshots/:id", () => {
	it("deletes the snapshot and the balances follow the transactions again", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.snapshots[":id"].$delete({
			param: { id: snapshot.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: snapshot.id } });
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(138000);
		await expect(balanceOf(account.id)).resolves.toBe(138000);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("answers NOT_FOUND for an unknown snapshot", async () => {
		const { status, body } = await request("DELETE", "/api/snapshots/nope");

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
	it("cannot be edited or deleted as a snapshot", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const patched = await request("PATCH", `/api/snapshots/${anchor.id}`, {
			date: "2026-09-10",
			balance: "0",
		});
		const deleted = await request("DELETE", `/api/snapshots/${anchor.id}`);

		expect(patched.status).toBe(404);
		expect(errorBody.parse(patched.body).error.code).toBe("NOT_FOUND");
		expect(deleted.status).toBe(404);
		expect(errorBody.parse(deleted.body).error.code).toBe("NOT_FOUND");
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

	it("answers any path with NOT_FOUND when there is no interface to serve", async () => {
		const response = await buildApp().request("/");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});
});

// The I/O matrix of Story 3.3: the built interface served beside the API.
describe("serving the interface", () => {
	let webDist: string;
	const page = "<!doctype html><title>Archant</title>";
	const script = "console.log('archant');";

	beforeAll(async () => {
		webDist = await mkdtemp(join(tmpdir(), "archant-web-"));
		await mkdir(join(webDist, "assets"));
		await writeFile(join(webDist, "index.html"), page);
		await writeFile(join(webDist, "assets", "index-abc.js"), script);
	});

	afterAll(async () => {
		await rm(webDist, { recursive: true, force: true });
	});

	const serving = () =>
		withSession(
			buildTestApp(temp.db, createLogger("silent"), undefined, { webDist }),
			template.cookie,
		);

	it.each(["/", "/comptes", "/comptes/abc/operations"])(
		"answers %s with index.html, revalidated on every visit",
		async (path) => {
			const response = await serving().request(path);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			expect(response.headers.get("cache-control")).toBe("no-cache");
			await expect(response.text()).resolves.toBe(page);
		},
	);

	it("sends security headers, so no other site can frame the page", async () => {
		const response = await serving().request("/");

		expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("serves a hashed asset as immutable for a year", async () => {
		const response = await serving().request("/assets/index-abc.js");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("javascript");
		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		await expect(response.text()).resolves.toBe(script);
	});

	it("answers a missing asset with 404, not the page", async () => {
		const response = await serving().request("/assets/index-gone.js");

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBeNull();
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});

	it("answers an unknown API route with the NOT_FOUND JSON, never the page", async () => {
		const response = await serving().request("/api/nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json())).toEqual({
			error: { code: "NOT_FOUND", message: "No route matches GET /api/nope" },
		});
	});

	it("still answers UNAUTHORIZED on an unknown API route without a session", async () => {
		const response = await buildTestApp(temp.db, createLogger("silent"), undefined, {
			webDist,
		}).request("/api/nope");

		expect(response.status).toBe(401);
		expect(errorBody.parse(await response.json()).error.code).toBe("UNAUTHORIZED");
	});

	it("keeps API routes ahead of the page", async () => {
		const response = await serving().request("/api/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
	});
});

// The I/O matrix of Story 1.6.
const accountBody = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		subtype: z.string().nullable(),
		balance: z.number(),
		active: z.boolean(),
		excludedFromReports: z.boolean(),
	}),
});

async function patchAccount(accountId: string, body: unknown) {
	return request("PATCH", `/api/accounts/${accountId}`, body);
}

async function listOwnAccounts(client: Awaited<ReturnType<typeof ownClient>>) {
	return (await (await client.$get()).json()).data;
}

describe("PATCH /api/accounts/:id", () => {
	it("trims and saves a new name, which the transaction list follows", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		const response = await testClient(buildApp()).api.accounts[":id"].$patch({
			param: { id: account.id },
			json: { name: " Livret A " },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: account.id,
			name: "Livret A",
			subtype: "checking",
			openingDate: "2026-09-01",
			active: true,
			excludedFromReports: false,
		});
		const { body } = await request("GET", `/api/transactions?account=${account.id}`);
		expect(listBody.parse(body).data.items[0]?.accountName).toBe("Livret A");
	});

	it("moves a checking account to savings and leaves its balance alone", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		const { status, body } = await patchAccount(account.id, { subtype: "savings" });

		expect(status).toBe(200);
		expect(accountBody.parse(body).data).toMatchObject({ subtype: "savings", balance: 119166 });
	});

	it("refuses a subtype the type does not allow and saves nothing", async () => {
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const { status, body } = await patchAccount(card.id, { subtype: "savings", name: "Autre" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "subtype", code: "invalid_subtype" }],
		});
		const detail = await request("GET", `/api/accounts/${card.id}`);
		expect(accountBody.parse(detail.body).data).toMatchObject({ name: "Carte", subtype: null });
	});

	it("refuses a depository account without a subtype", async () => {
		const account = await openAccount();

		const { status, body } = await patchAccount(account.id, { subtype: null });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "subtype", code: "invalid_subtype" },
		]);
	});

	it("refuses an empty patch", async () => {
		const account = await openAccount();

		const { status, body } = await patchAccount(account.id, {});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});

	it("ignores fields that cannot be edited, which leaves an empty patch", async () => {
		const account = await openAccount();

		const { status } = await patchAccount(account.id, { currency: "USD", type: "credit_card" });

		expect(status).toBe(400);
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(accountBody.parse(detail.body).data).toMatchObject({ subtype: "checking" });
	});

	it("refuses a blank or too long name, and flags that are not booleans", async () => {
		const account = await openAccount();

		const { body } = await patchAccount(account.id, {
			name: "  ",
			active: "no",
			excludedFromReports: 1,
		});
		const tooLong = await patchAccount(account.id, { name: "a".repeat(101) });

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "name", code: "too_small" },
			{ path: "active", code: "invalid_type" },
			{ path: "excludedFromReports", code: "invalid_type" },
		]);
		expect(errorBody.parse(tooLong.body).error.fields).toEqual([{ path: "name", code: "too_big" }]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await patchAccount("nope", { name: "Livret A" });

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("GET /api/accounts with inactive and excluded accounts", () => {
	it("lists a deactivated account and drops its balance from the group total", async () => {
		const client = await ownClient();
		const joint = (await (await client.$post({ json: valid })).json()).data;
		const savings = (
			await (
				await client.$post({
					json: { ...valid, name: "Livret A", subtype: "savings", openingBalance: "100" },
				})
			).json()
		).data;
		const before = await listOwnAccounts(client);

		const response = await client[":id"].$patch({
			param: { id: savings.id },
			json: { active: false },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.active).toBe(false);
		const after = await listOwnAccounts(client);
		expect(before.groups[0]?.total).toBe(123456 + 10000);
		expect(after.groups[0]?.total).toBe(123456);
		expect(after.groups[0]?.accounts).toEqual([
			expect.objectContaining({ id: joint.id, active: true, excludedFromReports: false }),
			expect.objectContaining({ id: savings.id, active: false, balance: 10000 }),
		]);
	});

	it("keeps an excluded account listed and drops its balance from the total", async () => {
		const client = await ownClient();
		await client.$post({ json: valid });
		const card = (
			await (
				await client.$post({
					json: {
						...valid,
						name: "Carte",
						type: "credit_card",
						subtype: null,
						openingBalance: "490,30",
					},
				})
			).json()
		).data;

		await client[":id"].$patch({ param: { id: card.id }, json: { excludedFromReports: true } });

		const { groups } = await listOwnAccounts(client);
		expect(groups[1]).toMatchObject({
			classification: "liability",
			total: 0,
			excludedCount: 0,
			accounts: [{ id: card.id, excludedFromReports: true, balance: 49030 }],
		});
		expect(groups[0]?.total).toBe(123456);
	});

	it("counts in excludedCount only active, included accounts in another currency", async () => {
		const client = await ownClient();
		const usd = { ...valid, subtype: "savings", currency: "USD", openingBalance: "10.00" } as const;
		await client.$post({ json: { ...usd, name: "Épargne US" } });
		const inactive = (await (await client.$post({ json: { ...usd, name: "Ancien US" } })).json())
			.data;
		const excluded = (await (await client.$post({ json: { ...usd, name: "Exclu US" } })).json())
			.data;

		await client[":id"].$patch({ param: { id: inactive.id }, json: { active: false } });
		await client[":id"].$patch({ param: { id: excluded.id }, json: { excludedFromReports: true } });

		const { groups } = await listOwnAccounts(client);
		expect(groups[0]).toMatchObject({ total: 0, excludedCount: 1 });
		expect(groups[0]?.accounts).toHaveLength(3);
	});

	it("reactivates an account, which counts again", async () => {
		const client = await ownClient();
		const account = (await (await client.$post({ json: valid })).json()).data;
		await client[":id"].$patch({ param: { id: account.id }, json: { active: false } });

		await client[":id"].$patch({ param: { id: account.id }, json: { active: true } });

		expect((await listOwnAccounts(client)).groups[0]?.total).toBe(123456);
	});

	it("keeps a deactivated account's transactions in the cross-account list", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		await patchAccount(account.id, { active: false });

		const { body } = await request("GET", `/api/transactions?account=${account.id}`);
		expect(listBody.parse(body).data.items).toEqual([
			expect.objectContaining({ accountId: account.id, label: "Boulangerie" }),
		]);
	});
});

describe("DELETE /api/accounts/:id", () => {
	async function countRows(accountId: string) {
		// Raw on purpose: only the ledger may import these tables (AD-2).
		const [row] = await temp.db.all<Record<string, number>>(
			sql`select
				(select count(*) from accounts where id = ${accountId}) as accounts,
				(select count(*) from entries where account_id = ${accountId}) as entries,
				(select count(*) from transactions where entry_id in (select id from entries where account_id = ${accountId})) as transactions,
				(select count(*) from balances where account_id = ${accountId}) as balances`,
		);

		return row;
	}

	it("deletes the account, its transactions, snapshot and balances, and nothing else", async () => {
		const account = await openAccount();
		const other = await openAccount({ name: "Livret A", subtype: "savings" });
		await postTransaction(other.id, { ...expense, label: "Autre compte" });
		// One after the other: each is an `immediate` ledger write.
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, date: "2026-09-11" });
		await postTransaction(account.id, { ...expense, date: "2026-09-12" });
		await postSnapshot(account.id, { date: "2026-09-15", balance: "1 000,00" });
		const otherBefore = await countRows(other.id);

		const response = await testClient(buildApp()).api.accounts[":id"].$delete({
			param: { id: account.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: account.id } });
		await expect(countRows(account.id)).resolves.toEqual({
			accounts: 0,
			entries: 0,
			transactions: 0,
			balances: 0,
		});
		await expect(countRows(other.id)).resolves.toEqual(otherBefore);
		expect(otherBefore).toMatchObject({ accounts: 1, entries: 2, transactions: 1 });
		expect((await request("GET", `/api/accounts/${account.id}`)).status).toBe(404);
		const { body } = await request("GET", `/api/transactions?account=${other.id}`);
		expect(listBody.parse(body).data.items).toEqual([
			expect.objectContaining({ label: "Autre compte" }),
		]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("DELETE", "/api/accounts/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

// Story 2.1: import an OFX file with preview.

const importBody = z.object({
	data: z.object({
		id: z.string(),
		fileName: z.string(),
		source: z.string(),
		groups: z.object({
			created: z.array(z.object({ ref: z.string(), label: z.string(), amount: z.number() })),
			present: z.array(z.object({ ref: z.string(), entryId: z.string().nullable() })),
			matched: z.array(z.object({ ref: z.string(), entryId: z.string().nullable() })),
			duplicates: z.array(z.object({ ref: z.string() })),
			rejected: z.array(
				z.object({
					ref: z.string(),
					reason: z.string(),
					line: z.object({ date: z.string(), amount: z.number(), label: z.string() }).nullable(),
				}),
			),
		}),
		openingSuggestion: z.string().nullable(),
		opening: z.object({ date: z.string(), balance: z.number() }).nullable(),
		statementBalance: z
			.object({ status: z.string(), date: z.string(), balance: z.number() })
			.passthrough()
			.nullable(),
	}),
});

const creditAgricole = async () =>
	new Uint8Array(
		await readFile(
			new URL("connectors/ofx/fixtures/credit-agricole-102-sgml.ofx", import.meta.url),
		),
	);

/** A valid one-line card statement grown to `size` bytes by blank lines before `<OFX>`. */
function paddedOfx(size: number): Uint8Array {
	const body = new TextEncoder().encode(
		"<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260910<TRNAMT>-12.00<FITID>P1<NAME>Librairie</STMTTRN>\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
	);
	const bytes = new Uint8Array(size).fill(0x0a);

	bytes.set(body, size - body.length);

	return bytes;
}

async function upload(accountId: string, bytes: Uint8Array, name = "releve.ofx") {
	const form = new FormData();
	form.append("file", new File([bytes], name));
	const response = await buildApp().request(`/api/accounts/${accountId}/imports`, {
		method: "POST",
		body: form,
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

async function uploaded(accountId: string, bytes: Uint8Array) {
	const { status, body } = await upload(accountId, bytes);

	expect(status).toBe(201);

	return importBody.parse(body).data;
}

async function transactionsOf(accountId: string) {
	const response = await testClient(buildApp()).api.accounts[":id"].transactions.$get({
		param: { id: accountId },
		query: {},
	});

	return (await response.json()).data;
}

describe("POST /api/accounts/:id/imports", () => {
	it("stores a preview of an OFX file and writes nothing", async () => {
		const account = await openAccount();
		const client = testClient(buildApp()).api.accounts[":id"].imports;

		const response = await client.$post({
			param: { id: account.id },
			form: { file: new File([await creditAgricole()], "releve.ofx") },
		});

		expect(response.status).toBe(201);
		const { data } = importBody.parse(await response.json());
		expect(data).toMatchObject({
			fileName: "releve.ofx",
			source: "ofx",
			openingSuggestion: null,
			statementBalance: { status: "recorded", date: "2026-09-15", balance: 123456 },
		});
		expect(data.groups.created.map((line) => line.label)).toEqual([
			"CB CAFÉ DE LA GARE",
			"PRLV SEPA EDF Électricité échéance septembre",
			"VIR SALAIRE",
			"CB BOULANGERIE",
			"CB BOULANGERIE",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it.each([
		["a text file", new TextEncoder().encode("Liste de courses : pain, lait"), "notes.txt"],
		[
			"a file with two statements",
			new TextEncoder().encode(
				"<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</STMTRS><STMTRS><CURDEF>EUR</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
			),
			"releve.ofx",
		],
		// Below the body limit: the file's own size check refuses it.
		["a valid statement one byte over 5 MB", paddedOfx(MAX_IMPORT_BYTES + 1), "releve.ofx"],
		["a valid statement over the body limit", paddedOfx(6 * 1024 * 1024), "releve.ofx"],
	])("refuses %s with INVALID_IMPORT_FILE and writes nothing", async (_name, bytes, name) => {
		const account = await openAccount();

		const { status, body } = await upload(account.id, bytes, name);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("reads a valid statement of exactly 5 MB", async () => {
		const account = await openAccount();

		const preview = await uploaded(account.id, paddedOfx(MAX_IMPORT_BYTES));

		expect(preview.groups.created).toHaveLength(1);
	});

	it("purges the previews left for a day before storing a new one", async () => {
		const account = await openAccount();
		const old = await uploaded(account.id, paddedOfx(1024));
		vi.setSystemTime(new Date("2026-09-22T10:00:01Z"));

		const recent = await uploaded(account.id, paddedOfx(1024));

		const rows = await temp.db.all<{ id: string }>(
			sql`select id from imports where account_id = ${account.id}`,
		);
		expect(rows.map((row) => row.id)).toEqual([recent.id]);
		expect(rows.map((row) => row.id)).not.toContain(old.id);
	});

	it("refuses a body without a file", async () => {
		const account = await openAccount();

		const response = await buildApp().request(`/api/accounts/${account.id}/imports`, {
			method: "POST",
			body: new FormData(),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await upload("nope", await creditAgricole());

		expect(status).toBe(404);
		expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
	});
});

describe("POST /api/imports/:id/confirm", () => {
	it("writes the lines, moves the balance, and shows them as imported", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const response = await testClient(buildApp()).api.imports[":id"].confirm.$post({
			param: { id: preview.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: {
				id: preview.id,
				counts: { created: 5, present: 0, matched: 0, duplicates: 0, rejected: 0 },
			},
		});
		const list = await transactionsOf(account.id);
		expect(list.total).toBe(5);
		expect(list.items[0]?.source).toEqual({ kind: "import", format: "ofx", date: "2026-09-21" });
		const all = await testClient(buildApp()).api.transactions.$get({
			query: { account: account.id },
		});
		const { data: everyAccount } = await all.json();
		expect(everyAccount.items.map((item) => item.source)).toEqual(
			Array.from({ length: 5 }, () => ({ kind: "import", format: "ofx", date: "2026-09-21" })),
		);
		// The file's LEDGERBAL of 1 234,56 on 15 September, not the lines' sum,
		// sets today's balance.
		await expect(balanceOnDay(account.id, "2026-09-10")).resolves.toBe(
			123456 - 4290 - 8712 + 215000 - 350 - 350,
		);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("records the card fixture's negative balance as a positive amount owed", async () => {
		const card = await openAccount({ type: "credit_card", subtype: null, openingBalance: "0" });
		const bytes = new Uint8Array(
			await readFile(
				new URL("connectors/ofx/fixtures/societe-generale-card-102-sgml.ofx", import.meta.url),
			),
		);
		const preview = await uploaded(card.id, bytes);
		expect(preview.statementBalance).toEqual({
			status: "recorded",
			date: "2026-09-15",
			balance: 51230,
		});

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(balanceOf(card.id)).resolves.toBe(51230);
	});

	it("keeps a snapshot the user entered on the statement date, and gives the gap", async () => {
		const account = await openAccount();
		await request("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-09-15",
			balance: "1 200,00",
		});

		const preview = await uploaded(account.id, await creditAgricole());

		expect(preview.statementBalance).toEqual({
			status: "kept",
			date: "2026-09-15",
			balance: 123456,
			recorded: 120000,
			gap: 3456,
		});
		await request("POST", `/api/imports/${preview.id}/confirm`);
		await expect(balanceOf(account.id)).resolves.toBe(120000);
	});

	it("keeps statement lines and amounts out of the logs", async () => {
		const account = await openAccount();
		const app = buildApp();
		const form = new FormData();
		form.append("file", new File([await creditAgricole()], "releve.ofx"));
		const { data } = importBody.parse(
			await (
				await app.request(`/api/accounts/${account.id}/imports`, { method: "POST", body: form })
			).json(),
		);
		await app.request(`/api/imports/${data.id}/confirm`, { method: "POST" });

		const logs = logLines.join("\n");
		expect(logs).toContain(data.id);
		expect(logs).not.toMatch(/CAF|BOULANGERIE|4290|releve/u);
	});

	it("recognises the same file on re-import", async () => {
		const account = await openAccount();
		const first = await uploaded(account.id, await creditAgricole());
		await request("POST", `/api/imports/${first.id}/confirm`);

		const again = await uploaded(account.id, await creditAgricole());

		expect(again.groups.created).toEqual([]);
		expect(again.groups.present).toHaveLength(5);
	});

	it("answers NOT_FOUND for an import already confirmed or unknown", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());
		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
		await expect(request("POST", "/api/imports/nope/confirm")).resolves.toMatchObject({
			status: 404,
		});
	});

	it("answers IMPORT_PREVIEW_STALE when a transaction arrived since the preview, then previews anew", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());
		const manual = await postTransaction(account.id, {
			date: "2026-09-04",
			label: "Café",
			amount: "-42,90",
		});

		const stale = await request("POST", `/api/imports/${preview.id}/confirm`);

		expect(stale).toEqual({
			status: 409,
			body: {
				error: { code: "IMPORT_PREVIEW_STALE", message: "The account changed since the preview." },
			},
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 1 });

		const fresh = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
		});
		const { data } = importBody.parse(fresh.body);
		expect(data.groups.matched).toEqual([expect.objectContaining({ ref: "0" })]);
		expect(z.object({ data: z.object({ id: z.string() }) }).parse(manual.body).data.id).toBe(
			data.groups.matched[0]?.entryId,
		);
		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 5 });
	});
});

describe("POST /api/imports/:id/preview", () => {
	it("moves the opening date back on request, and confirm keeps today's balance", async () => {
		const account = await openAccount({ openingDate: "2026-09-05" });
		const preview = await uploaded(account.id, await creditAgricole());
		expect(preview.openingSuggestion).toBe("2026-09-02");
		expect(
			preview.groups.rejected.map(({ ref, reason, line }) => [ref, reason, line?.date]),
		).toEqual([
			["0", "BEFORE_OPENING_DATE", "2026-09-03"],
			["1", "BEFORE_OPENING_DATE", "2026-09-05"],
		]);

		const moved = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: "2026-09-02",
		});

		const { data } = importBody.parse(moved.body);
		expect(data.groups.created).toHaveLength(5);
		expect(data.opening).toEqual({ date: "2026-09-02", balance: 123456 + 4290 + 8712 });
		await expect(balanceOnDay(account.id, "2026-09-05")).resolves.toBe(123456);

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(balanceOnDay(account.id, "2026-09-05")).resolves.toBe(123456);
		// The file's LEDGERBAL on 15 September sets today's balance.
		await expect(balanceOf(account.id)).resolves.toBe(123456);
		const { data: detail } = await (
			await testClient(buildApp()).api.accounts[":id"].$get({ param: { id: account.id } })
		).json();
		expect(detail.openingDate).toBe("2026-09-02");
	});

	it("refuses a malformed date and answers NOT_FOUND for an unknown import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		await expect(
			request("POST", `/api/imports/${preview.id}/preview`, { moveOpeningDate: "hier" }),
		).resolves.toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
		await expect(
			request("POST", `/api/imports/${preview.id}/preview`, { moveOpeningDate: "0001-01-01" }),
		).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "moveOpeningDate", code: "date_too_early" }],
				},
			},
		});
		await expect(
			request("POST", "/api/imports/nope/preview", { moveOpeningDate: null }),
		).resolves.toMatchObject({ status: 404 });
	});
});

describe("purgeStalePreviews", () => {
	it("deletes the previews older than a day and keeps confirmed imports", async () => {
		const purgeDb = await freshDatabase();

		try {
			const app = withSession(buildTestApp(purgeDb.db), template.cookie);
			const created = await (await testClient(app).api.accounts.$post({ json: valid })).json();
			const accountId = created.data.id;
			const form = () => {
				const body = new FormData();
				body.append("file", new File([new TextEncoder().encode(CARD_OFX)], "carte.ofx"));
				return body;
			};
			const post = async () =>
				importBody.parse(
					await (
						await app.request(`/api/accounts/${accountId}/imports`, {
							method: "POST",
							body: form(),
						})
					).json(),
				).data.id;
			const old = await post();
			const confirmed = await post();
			await app.request(`/api/imports/${confirmed}/confirm`, { method: "POST" });
			vi.setSystemTime(new Date("2026-09-22T10:00:01Z"));

			await expect(purgeStalePreviews({ db: purgeDb.db, timeZone: "Europe/Paris" })).resolves.toBe(
				1,
			);
			const recent = await post();

			const rows = await purgeDb.db.all<{ id: string }>(sql`select id from imports order by id`);
			expect(rows.map((row) => row.id).toSorted()).toEqual([confirmed, recent].toSorted());
			expect(rows.map((row) => row.id)).not.toContain(old);
		} finally {
			await purgeDb.dispose();
		}
	});
});

const CARD_OFX = [
	"<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>",
	"<STMTTRN><DTPOSTED>20260910<TRNAMT>-12.00<FITID>C1<NAME>Librairie</STMTTRN>",
	"</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
].join("\n");

// Story 2.3: import a CSV file with a saved mapping.

const csvMapping = z.object({
	delimiter: z.string(),
	skipRows: z.number(),
	hasHeader: z.boolean(),
	dateFormat: z.string(),
	decimal: z.string(),
	sign: z.string(),
	columns: z.array(z.string()),
});

const csvBody = z.object({
	data: importBody.shape.data.extend({
		csv: z.object({
			sample: z.array(z.array(z.string())),
			mapping: csvMapping.nullable(),
			saved: z.boolean(),
			prefill: csvMapping,
		}),
	}),
});

const societeGenerale = async () =>
	new Uint8Array(
		await readFile(new URL("connectors/csv/fixtures/societe-generale-1252.csv", import.meta.url)),
	);

const sgMapping = {
	delimiter: ";",
	skipRows: 3,
	hasHeader: true,
	dateFormat: "DD/MM/YYYY",
	decimal: ",",
	sign: "inflows-positive",
	columns: ["date", "label", "notes", "amount", "ignore"],
} as const;

async function uploadedCsv(accountId: string, bytes: Uint8Array, name = "releve.csv") {
	const { status, body } = await upload(accountId, bytes, name);

	expect(status).toBe(201);

	return csvBody.parse(body).data;
}

async function previewCsv(id: string, csv: unknown, moveOpeningDate: string | null = null) {
	return request("POST", `/api/imports/${id}/preview`, { moveOpeningDate, csv });
}

async function mappingRows(accountId: string) {
	return temp.db.all<{ mapping: string }>(
		sql`select mapping from import_mappings where account_id = ${accountId}`,
	);
}

describe("CSV imports", () => {
	it("opens a first CSV on its columns, with French defaults and nothing computed", async () => {
		const account = await openAccount();

		const preview = await uploadedCsv(account.id, await societeGenerale());

		expect(preview.source).toBe("csv");
		expect(preview.groups).toEqual({
			created: [],
			present: [],
			matched: [],
			duplicates: [],
			rejected: [],
		});
		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill).toEqual({
			delimiter: ";",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["ignore", "ignore", "ignore", "ignore", "ignore"],
		});
		// windows-1252 decoded: the header reads with its accents.
		expect(preview.csv.sample[3]).toEqual([
			"Date de l'opération",
			"Libellé",
			"Détail de l'écriture",
			"Montant de l'opération",
			"Devise",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("ignores a stored mapping that no longer passes the schema", async () => {
		const account = await openAccount();
		const broken = JSON.stringify({ ...sgMapping, columns: ["date", "date", "label", "amount"] });
		await temp.db.run(
			sql`insert into import_mappings (account_id, mapping, updated_at) values (${account.id}, ${broken}, 0)`,
		);

		const preview = await uploadedCsv(account.id, await societeGenerale());

		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill).toEqual({
			delimiter: ";",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["ignore", "ignore", "ignore", "ignore", "ignore"],
		});
		expect(preview.groups.created).toEqual([]);
		expect(preview.groups.rejected).toEqual([]);
	});

	it("refuses to confirm a CSV import that has no mapping yet", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 400,
			body: { error: { code: "VALIDATION_ERROR" } },
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("previews with a mapping, confirms, saves the mapping, and applies it to the next file", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());

		const previewed = await previewCsv(first.id, sgMapping);

		expect(previewed.status).toBe(200);
		const { data } = csvBody.parse(previewed.body);
		expect(data.groups.created.map((line) => line.label)).toEqual([
			"CARTE X1234 CAFE DE LA GARE",
			"PRLV SEPA EDF",
			"Prélèvement Crédit Agricole",
			"VIR RECU SALAIRE",
			"CARTE X1234 BOULANGERIE",
			"CARTE X1234 BOULANGERIE",
		]);
		expect(data.csv.mapping).toEqual(sgMapping);
		expect(data.csv.saved).toBe(false);
		// The sample is the file's first records, split with the mapping's delimiter.
		expect(data.csv.sample[3]?.[0]).toBe("Date de l'opération");
		await expect(mappingRows(account.id)).resolves.toEqual([]);

		await expect(request("POST", `/api/imports/${first.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 6 } } },
		});
		await expect(balanceOf(account.id)).resolves.toBe(
			123456 - 4290 - 8712 - 3150 + 215000 - 350 - 350,
		);
		const list = await transactionsOf(account.id);
		expect(list.items[0]?.source).toEqual({ kind: "import", format: "csv", date: "2026-09-21" });
		const [saved] = await mappingRows(account.id);
		expect(JSON.parse(saved?.mapping ?? "null")).toEqual(sgMapping);

		const again = await uploadedCsv(account.id, await societeGenerale());

		expect(again.csv).toMatchObject({ mapping: sgMapping, saved: true, prefill: sgMapping });
		// Twin lines both created, both recognised.
		expect(again.groups.present).toHaveLength(6);
		expect(again.groups.created).toEqual([]);
	});

	it("keeps recognising lines edited since their import", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, sgMapping);
		await request("POST", `/api/imports/${first.id}/confirm`);
		const list = await transactionsOf(account.id);
		const cafe = list.items.find((item) => item.label === "CARTE X1234 CAFE DE LA GARE");

		await request("PATCH", `/api/transactions/${cafe?.id}`, {
			label: "Café de la gare",
			amount: "-50,00",
		});
		const again = await uploadedCsv(account.id, await societeGenerale());

		expect(again.groups.present).toHaveLength(6);
	});

	it("opens a file the saved mapping no longer fits on its columns, prefilled with it", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, {
			...sgMapping,
			skipRows: 0,
			hasHeader: false,
			columns: ["ignore", "ignore", "ignore", "ignore", "date", "label", "amount"],
		});
		// Any line rejected or not, confirm saves the mapping.
		await request("POST", `/api/imports/${first.id}/confirm`);

		const narrow = new TextEncoder().encode("01/09/2026;A;-1,00;x\n02/09/2026;B;-2,00;y\n");
		const preview = await uploadedCsv(account.id, narrow);

		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill.columns).toEqual(["ignore", "ignore", "ignore", "ignore"]);
		expect(preview.csv.prefill.hasHeader).toBe(false);
		expect(preview.groups.created).toEqual([]);

		// A preview without a mapping stays on the columns.
		const without = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
		});
		expect(csvBody.parse(without.body).data.csv.mapping).toBeNull();
	});

	it("gives a rejected record its line in the whole file", async () => {
		const account = await openAccount();
		const file = new TextEncoder().encode(
			[
				"# export",
				"Date;Libellé;Débit;Crédit",
				"03/09/2026;A;1,00;",
				"04/09/2026;B;1,00;2,00",
			].join("\n"),
		);
		const preview = await uploadedCsv(account.id, file);

		const { data } = csvBody.parse(
			(
				await previewCsv(preview.id, {
					...sgMapping,
					skipRows: 1,
					columns: ["date", "label", "debit", "credit"],
				})
			).body,
		);

		expect(data.groups.rejected).toEqual([{ ref: "3", reason: "INVALID_AMOUNT", line: null }]);
	});

	it.each([
		["two date columns", { ...sgMapping, columns: ["date", "date", "label", "amount"] }],
		["no label", { ...sgMapping, columns: ["date", "amount"] }],
		["an amount beside a debit", { ...sgMapping, columns: ["date", "label", "amount", "debit"] }],
		["two debit columns", { ...sgMapping, columns: ["date", "label", "debit", "debit"] }],
		["neither amount nor debit nor credit", { ...sgMapping, columns: ["date", "label"] }],
		["too many rows to skip", { ...sgMapping, skipRows: 51 }],
		["an unknown delimiter", { ...sgMapping, delimiter: "|" }],
	])("refuses a mapping with %s and computes nothing", async (_name, csv) => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		await expect(previewCsv(preview.id, csv)).resolves.toMatchObject({
			status: 400,
			body: { error: { code: "VALIDATION_ERROR" } },
		});
	});

	it("names the columns in the field error of an invalid mapping", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		const { body } = await previewCsv(preview.id, {
			...sgMapping,
			columns: ["date", "date", "label", "amount"],
		});

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "csv.columns", code: "invalid_columns" },
		]);
	});

	it("refuses a .csv file holding one column of text, and stores nothing", async () => {
		const account = await openAccount();

		const { status, body } = await upload(
			account.id,
			new TextEncoder().encode("Liste de courses\npain\nlait\n"),
			"courses.csv",
		);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("refuses a first CSV with an unterminated quote, and stores nothing", async () => {
		const account = await openAccount();

		const { status, body } = await upload(
			account.id,
			new TextEncoder().encode(
				'Date;Libellé;Montant\n03/09/2026;"CAFE;-4,20\n04/09/2026;PAIN;-1,10\n',
			),
			"releve.csv",
		);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("saves no mapping when confirm finds the account changed", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(preview.id, sgMapping);
		await postTransaction(account.id, { date: "2026-09-03", label: "Café", amount: "-42,90" });

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 409,
		});

		await expect(mappingRows(account.id)).resolves.toEqual([]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 1 });
	});

	it("updates the saved mapping at the next confirm, and drops it with the account", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, sgMapping);
		await request("POST", `/api/imports/${first.id}/confirm`);
		const second = await uploadedCsv(account.id, await societeGenerale());
		const notesless = { ...sgMapping, columns: ["date", "label", "ignore", "amount", "ignore"] };
		await previewCsv(second.id, notesless);
		await request("POST", `/api/imports/${second.id}/confirm`);

		const [saved] = await mappingRows(account.id);
		expect(JSON.parse(saved?.mapping ?? "null")).toEqual(notesless);

		await request("DELETE", `/api/accounts/${account.id}`);
		await expect(mappingRows(account.id)).resolves.toEqual([]);
	});

	it("ignores a CSV mapping sent for an OFX import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const again = await previewCsv(preview.id, sgMapping);

		expect(again.status).toBe(200);
		expect(importBody.parse(again.body).data.groups.created).toHaveLength(5);
		expect(z.object({ data: z.object({ csv: z.null() }) }).parse(again.body).data.csv).toBeNull();
	});

	it("confirms 5,000 lines in under 10 seconds, then recognises them all", async () => {
		const account = await openAccount();
		const lines = Array.from(
			{ length: 5000 },
			(_, index) =>
				`${String((index % 19) + 2).padStart(2, "0")}/09/2026;CB MAGASIN ${index % 50};-${(index % 97) + 1},${String(index % 100).padStart(2, "0")}`,
		);
		const file = new TextEncoder().encode(["Date;Libellé;Montant", ...lines].join("\n"));
		const mapping = { ...sgMapping, skipRows: 0, columns: ["date", "label", "amount"] };
		const started = performance.now();
		const preview = await uploadedCsv(account.id, file);
		await previewCsv(preview.id, mapping);

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 5000 } } },
		});

		expect(performance.now() - started).toBeLessThan(10_000);
		const again = await uploadedCsv(account.id, file);
		expect(again.groups.present).toHaveLength(5000);
		expect(again.groups.created).toEqual([]);
	}, 30_000);
});

// Story 2.4: import a QIF file.

const qifBody = z.object({
	data: importBody.shape.data.extend({
		qif: z.object({ dateOrder: z.string(), ambiguous: z.boolean() }),
	}),
});

const banquePostale = async () =>
	new Uint8Array(
		await readFile(
			new URL("connectors/qif/fixtures/banque-postale-bank-1252.qif", import.meta.url),
		),
	);

const qifFile = (...records: string[][]) =>
	new TextEncoder().encode(
		["!Type:Bank", ...records.flatMap((record) => [...record, "^"])].join("\n"),
	);

async function uploadedQif(accountId: string, bytes: Uint8Array, name = "releve.qif") {
	const { status, body } = await upload(accountId, bytes, name);

	expect(status).toBe(201);

	return qifBody.parse(body).data;
}

async function previewQif(id: string, body: Record<string, unknown>) {
	const { status, body: json } = await request("POST", `/api/imports/${id}/preview`, {
		moveOpeningDate: null,
		...body,
	});

	expect(status).toBe(200);

	return qifBody.parse(json).data;
}

describe("QIF imports", () => {
	it("previews a bank file, confirms it with its cheque numbers, and recognises it all again", async () => {
		const account = await openAccount();

		const preview = await uploadedQif(account.id, await banquePostale());

		expect(preview.source).toBe("qif");
		expect(preview.qif).toEqual({ dateOrder: "day-first", ambiguous: false });
		expect(preview.statementBalance).toBeNull();
		expect(preview.groups.created.map((line) => line.label)).toEqual([
			"CARTE X1234 CAFÉ DE LA GARE",
			"PRLV EDF Électricité échéance septembre",
			"CHEQUE 1234567",
			"VIR SEPA ACME SAS SALAIRE",
			"CHEQUE 1234568",
			"PRLV FREE MOBILE",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 6 } } },
		});
		// The balance row of today, 21 September: the 28th has not happened yet.
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290 - 8712 - 15000 + 215000 - 350);
		const list = await transactionsOf(account.id);
		const cheque = list.items.find((item) => item.label === "CHEQUE 1234567");
		expect(cheque).toMatchObject({
			reference: "1234567",
			source: { kind: "import", format: "qif", date: "2026-09-21" },
		});
		expect(list.items.find((item) => item.label === "PRLV FREE MOBILE")?.reference).toBeNull();

		const again = await uploadedQif(account.id, await banquePostale());

		expect(again.groups.present).toHaveLength(6);
		expect(again.groups.created).toEqual([]);
	});

	it("creates two identical records and recognises both on re-import", async () => {
		const account = await openAccount();
		const twin = ["D10/09/2026", "T-3,50", "PBOULANGERIE"];
		const file = qifFile(twin, twin);
		const preview = await uploadedQif(account.id, file);

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 2 });
		const again = await uploadedQif(account.id, file);
		expect(again.groups.present).toHaveLength(2);
		expect(again.groups.created).toEqual([]);
	});

	it("reads ambiguous dates day-first, and keeps the month-first choice across re-previews and confirm", async () => {
		const account = await openAccount({ openingDate: "2026-01-01" });
		const file = qifFile(["D02/09/2026", "T-10,00", "PA"], ["D03/04/2026", "T-20,00", "PB"]);

		const preview = await uploadedQif(account.id, file);

		expect(preview.qif).toEqual({ dateOrder: "day-first", ambiguous: true });
		expect(preview.groups.created.map((line) => line.label)).toEqual(["A", "B"]);
		const dates = async (id: string) =>
			z
				.object({
					data: z.object({
						groups: z.object({ created: z.array(z.object({ date: z.string() })) }),
					}),
				})
				.parse(
					(await request("POST", `/api/imports/${id}/preview`, { moveOpeningDate: null })).body,
				)
				.data.groups.created.map((line) => line.date);
		await expect(dates(preview.id)).resolves.toEqual(["2026-09-02", "2026-04-03"]);

		const monthFirst = await previewQif(preview.id, { qif: { dateOrder: "month-first" } });

		expect(monthFirst.qif).toEqual({ dateOrder: "month-first", ambiguous: true });
		// Without `qif`, the stored choice stays.
		await expect(dates(preview.id)).resolves.toEqual(["2026-02-09", "2026-03-04"]);
		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
		});
		const list = await transactionsOf(account.id);
		expect(list.items.map((item) => item.date).toSorted()).toEqual(["2026-02-09", "2026-03-04"]);
	});

	it("reads month-first without a choice when one date only reads that way", async () => {
		const account = await openAccount({ openingDate: "2026-01-01" });

		const preview = await uploadedQif(account.id, qifFile(["D03/29/2026", "T-1,00", "PA"]));

		expect(preview.qif).toEqual({ dateOrder: "month-first", ambiguous: false });
		expect(preview.groups.created).toMatchObject([{ label: "A" }]);
	});

	it("rejects unreadable records and the opening balance, numbered among transactions", async () => {
		const account = await openAccount();

		const preview = await uploadedQif(
			account.id,
			qifFile(
				["D10/09/2026", "T-1,00", "PA"],
				["D10/09/2026", "U-28,500.00", "T-28,500.00", "PB"],
				["D10/09/2026", "T1.234,56", "PC"],
				["D10/09/2026", "T12,5,0", "PD"],
				["D10/09/2026", "T100,00", "POpening Balance"],
			),
		);

		expect(preview.groups.created.map((line) => [line.label, line.amount])).toEqual([
			["A", -100],
			["B", -2850000],
			["C", 123456],
		]);
		expect(preview.groups.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT", line: null },
			{ ref: "4", reason: "OPENING_BALANCE", line: null },
		]);
	});

	it.each([
		["an investment file, naming its type", "!Type:Invst\nD1/5'26\nT50.00\n^", { type: "Invst" }],
		["a file with two accounts", "!Account\nNA\n^\n!Type:Bank\n^\n!Account\nNB\n^\n", undefined],
		["a .qif of plain text", "Liste de courses : pain, lait", undefined],
	])("refuses %s with INVALID_IMPORT_FILE and stores nothing", async (_name, text, params) => {
		const account = await openAccount();

		const { status, body } = await upload(account.id, new TextEncoder().encode(text), "releve.qif");

		expect(status).toBe(400);
		expect(body).toEqual({
			error: {
				code: "INVALID_IMPORT_FILE",
				message:
					params === undefined
						? "The file is not a readable QIF statement."
						: "QIF statements of type Invst are not supported.",
				...(params === undefined ? {} : { params }),
			},
		});
		await expect(
			temp.db.all(sql`select id from imports where account_id = ${account.id}`),
		).resolves.toEqual([]);
		expect(logLines.join("")).not.toContain("Invst");
	});

	it("refuses an unknown date order", async () => {
		const account = await openAccount();
		const preview = await uploadedQif(account.id, qifFile(["D10/09/2026", "T-1,00", "PA"]));

		const { status, body } = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
			qif: { dateOrder: "year-first" },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});

	it("ignores a date order sent for an OFX import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const { status, body } = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
			qif: { dateOrder: "month-first" },
		});

		expect(status).toBe(200);
		expect(z.object({ data: z.object({ qif: z.null() }) }).parse(body).data.qif).toBeNull();
		const rows = await temp.db.all<{ options: string }>(
			sql`select options from imports where id = ${preview.id}`,
		);
		expect(JSON.parse(rows[0]?.options ?? "null")).toEqual({});
	});
});

const historyBody = z.object({
	data: z.object({
		items: z.array(
			z.object({
				id: z.string(),
				fileName: z.string(),
				source: z.string(),
				confirmedAt: z.number(),
				revertedAt: z.number().nullable(),
				counts: z.object({
					created: z.number(),
					present: z.number(),
					matched: z.number(),
					duplicates: z.number(),
					rejected: z.number(),
				}),
				removable: z.object({ transactions: z.number(), snapshot: z.number() }).nullable(),
			}),
		),
		page: z.number(),
		pageSize: z.number(),
		total: z.number(),
	}),
});

async function confirmedImport(accountId: string) {
	const preview = await uploaded(accountId, await creditAgricole());
	await request("POST", `/api/imports/${preview.id}/confirm`);

	return preview.id;
}

describe("GET /api/accounts/:id/imports", () => {
	it("lists confirmed and reverted imports, latest first, with what a revert would delete", async () => {
		const account = await openAccount();
		const first = await confirmedImport(account.id);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		const second = await confirmedImport(account.id);
		await request("POST", `/api/imports/${second}/revert`);
		// A preview wrote nothing: it has no place in the history.
		await uploaded(account.id, await creditAgricole());

		const response = await testClient(buildApp()).api.accounts[":id"].imports.$get({
			param: { id: account.id },
			query: {},
		});

		expect(response.status).toBe(200);
		expect(historyBody.parse(await response.json()).data).toEqual({
			items: [
				{
					id: second,
					fileName: "releve.ofx",
					source: "ofx",
					confirmedAt: Date.parse("2026-09-21T11:00:00Z"),
					revertedAt: Date.parse("2026-09-21T11:00:00Z"),
					counts: { created: 0, present: 5, matched: 0, duplicates: 0, rejected: 0 },
					removable: null,
				},
				{
					id: first,
					fileName: "releve.ofx",
					source: "ofx",
					confirmedAt: Date.parse("2026-09-21T10:00:00Z"),
					revertedAt: null,
					counts: { created: 5, present: 0, matched: 0, duplicates: 0, rejected: 0 },
					removable: { transactions: 5, snapshot: 1 },
				},
			],
			page: 1,
			pageSize: 50,
			total: 2,
		});
	});

	it("pages the history", async () => {
		const account = await openAccount();
		await confirmedImport(account.id);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		const latest = await confirmedImport(account.id);

		const { status, body } = await request(
			"GET",
			`/api/accounts/${account.id}/imports?page=1&pageSize=1`,
		);

		expect(status).toBe(200);
		const { data } = historyBody.parse(body);
		expect(data.items.map((item) => item.id)).toEqual([latest]);
		expect(data.total).toBe(2);
	});

	it("answers NOT_FOUND for an unknown account and refuses page 0", async () => {
		await expect(request("GET", "/api/accounts/nope/imports")).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
		const account = await openAccount();
		await expect(
			request("GET", `/api/accounts/${account.id}/imports?page=0`),
		).resolves.toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
	});
});

describe("POST /api/imports/:id/revert", () => {
	it("deletes the import's transactions and snapshot, and puts the balance back", async () => {
		const account = await openAccount({ openingBalance: "1 000,00" });
		const id = await confirmedImport(account.id);
		await expect(balanceOf(account.id)).resolves.toBe(123456);

		const response = await testClient(buildApp()).api.imports[":id"].revert.$post({
			param: { id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: { id, removed: { transactions: 5, snapshot: 1 } },
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
		await expect(balanceOf(account.id)).resolves.toBe(100000);
	});

	it("keeps a matched manual transaction, shown as manual again", async () => {
		const account = await openAccount();
		await postTransaction(account.id, { date: "2026-09-04", label: "Café", amount: "-42,90" });
		const id = await confirmedImport(account.id);

		await expect(request("POST", `/api/imports/${id}/revert`)).resolves.toMatchObject({
			status: 200,
			body: { data: { removed: { transactions: 4, snapshot: 1 } } },
		});

		const list = await transactionsOf(account.id);
		expect(list.items).toEqual([
			expect.objectContaining({ label: "Café", source: { kind: "manual" } }),
		]);
	});

	it("lets the same file be imported again, every line to create", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		await request("POST", `/api/imports/${id}/revert`);

		const again = await uploaded(account.id, await creditAgricole());

		expect(again.groups.created).toHaveLength(5);
		expect(again.groups.present).toEqual([]);
	});

	it("answers IMPORT_NOT_REVERTABLE twice or for a preview, NOT_FOUND for an unknown id", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		await request("POST", `/api/imports/${id}/revert`);
		const preview = await uploaded(account.id, await creditAgricole());

		await expect(request("POST", `/api/imports/${id}/revert`)).resolves.toEqual({
			status: 409,
			body: {
				error: {
					code: "IMPORT_NOT_REVERTABLE",
					message: "Only a confirmed import can be reverted.",
				},
			},
		});
		await expect(request("POST", `/api/imports/${preview.id}/revert`)).resolves.toMatchObject({
			status: 409,
			body: { error: { code: "IMPORT_NOT_REVERTABLE" } },
		});
		await expect(request("POST", "/api/imports/nope/revert")).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
	});

	it("logs the import id, the counts and the duration, never a line or an amount", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		const app = buildApp();

		await app.request(`/api/imports/${id}/revert`, { method: "POST" });
		await app.request(`/api/imports/${id}/revert`, { method: "POST" });

		const [reverted, refused] = logLines.map((line) =>
			z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
		);
		expect(reverted).toMatchObject({ importId: id, removed: { transactions: 5, snapshot: 1 } });
		expect(typeof reverted?.["durationMs"]).toBe("number");
		expect(refused).toMatchObject({ importId: id, code: "IMPORT_NOT_REVERTABLE" });
		expect(logLines.join("\n")).not.toMatch(/CAF|BOULANGERIE|4290|releve/u);
	});
});

const category = (name: string, overrides: Partial<CreateCategoryInput> = {}) => ({
	name,
	kind: "expense" as const,
	color: "#e99537",
	icon: "tag" as const,
	parentId: null,
	...overrides,
});

/** A name no other test of this file uses: the categories share one database. */
const uniqueCategory = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;

async function createCategory(name: string, overrides: Partial<CreateCategoryInput> = {}) {
	const response = await testClient(buildApp()).api.categories.$post({
		json: category(name, overrides),
	});

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Puts every transaction of the account in the category, by hand through the API. */
async function categorise(accountId: string, categoryId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { categoryId });

		expect(status).toBe(200);
	}, Promise.resolve());
}

async function categoryList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.categories.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("categories", () => {
	it("lists the categories sorted by name, with their transaction counts", async () => {
		own = await freshDatabase();
		const client = testClient(buildApp(own.db)).api.categories;
		await client.$post({ json: category("Frais") });
		await client.$post({ json: category("Épargne", { kind: "income" }) });
		await client.$post({ json: category("Assurances") });

		const list = await categoryList(own.db);

		expect(list.map((item) => [item.name, item.kind, item.transactionCount])).toEqual([
			["Assurances", "expense", 0],
			["Épargne", "income", 0],
			["Frais", "expense", 0],
		]);
	});

	it("creates a child with its parent's kind and colour", async () => {
		const parent = await createCategory(uniqueCategory("Revenus"), {
			kind: "income",
			color: "#6ad28a",
		});

		const child = await createCategory(uniqueCategory("Salaire"), { parentId: parent.id });

		expect(child).toMatchObject({ parentId: parent.id, kind: "income", color: "#6ad28a" });
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Courses");
		await createCategory(name);

		await expect(request("POST", "/api/categories", category(name.toUpperCase()))).resolves.toEqual(
			{
				status: 400,
				body: {
					error: {
						code: "VALIDATION_ERROR",
						message: "The request is invalid.",
						fields: [{ path: "name", code: "name_taken" }],
					},
				},
			},
		);
	});

	it("refuses a decomposed name beside the composed one", async () => {
		const name = uniqueCategory("Épargne");
		await createCategory(name);

		const { status, body } = await request(
			"POST",
			"/api/categories",
			category(name.normalize("NFD")),
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code: "name_taken" }]);
	});

	it("accepts an uppercase colour and stores it in lowercase", async () => {
		const created = await createCategory(uniqueCategory("Majuscules"), { color: "#E99537" });

		expect(created.color).toBe("#e99537");
	});

	it("keeps a default's colour outside the swatches on edit", async () => {
		const target = await createCategory(uniqueCategory("Revenus"), { kind: "income" });

		const { status, body } = await request("PATCH", `/api/categories/${target.id}`, {
			color: "#22c55e",
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { color: "#22c55e" } });
	});

	it("refuses a grandchild, and a parent for a category with children", async () => {
		const parent = await createCategory(uniqueCategory("Logement"));
		const child = await createCategory(uniqueCategory("Loyer"), { parentId: parent.id });
		const other = await createCategory(uniqueCategory("Loisirs"));

		const grandchild = await request(
			"POST",
			"/api/categories",
			category(uniqueCategory("Caution"), { parentId: child.id }),
		);
		const moved = await request("PATCH", `/api/categories/${parent.id}`, { parentId: other.id });

		for (const response of [grandchild, moved]) {
			expect(response).toMatchObject({
				status: 400,
				body: { error: { fields: [{ path: "parentId", code: "invalid_parent" }] } },
			});
		}
	});

	it.each([
		["a blank name", { name: "  " }, "name", "too_small"],
		["a name over 60 characters", { name: "x".repeat(61) }, "name", "too_big"],
		["a free colour name", { color: "red" }, "color", "invalid_value"],
		["an unknown icon", { icon: "rocket" }, "icon", "invalid_value"],
		["an unknown kind", { kind: "transfer" }, "kind", "invalid_value"],
	])("refuses %s", async (_label, overrides, path, code) => {
		const { status, body } = await request("POST", "/api/categories", {
			...category(uniqueCategory("Autre")),
			...overrides,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});

	it("renames, recolours and moves a category under a parent", async () => {
		const parent = await createCategory(uniqueCategory("Logement"), { color: "#4da568" });
		const target = await createCategory(uniqueCategory("Eau"));
		const name = uniqueCategory("Eau et énergie");

		const response = await testClient(buildApp()).api.categories[":id"].$patch({
			param: { id: target.id },
			json: { name, icon: "lightbulb", parentId: parent.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			name,
			icon: "lightbulb",
			parentId: parent.id,
			color: "#4da568",
		});
	});

	it("refuses an empty patch", async () => {
		const target = await createCategory(uniqueCategory("Vide"));

		const { status, body } = await request("PATCH", `/api/categories/${target.id}`, {});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "", code: "empty_patch" }]);
	});

	it("deletes a category, moving its transactions to the replacement", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const source = await createCategory(uniqueCategory("Courses"));
		const replacement = await createCategory(uniqueCategory("Alimentation"));
		await categorise(account.id, source.id);

		const response = await testClient(buildApp()).api.categories[":id"].$delete({
			param: { id: source.id },
			query: { replacementId: replacement.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ id: source.id, moved: 2 });
		const list = await categoryList();
		expect(list.find((item) => item.id === source.id)).toBeUndefined();
		expect(list.find((item) => item.id === replacement.id)?.transactionCount).toBe(2);
	});

	it("deletes a category, leaving its transactions uncategorised", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createCategory(uniqueCategory("Cadeaux"));
		await categorise(account.id, source.id);

		await expect(request("DELETE", `/api/categories/${source.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: source.id, moved: 1 } },
		});
		await expect(
			temp.db.all(
				sql`select category_id as categoryId from transactions where entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([{ categoryId: null }]);
	});

	it.each([["nope"], ["self"]])("refuses %s as the replacement", async (which) => {
		const source = await createCategory(uniqueCategory("Courses"));
		const replacementId = which === "self" ? source.id : which;

		const { status, body } = await request(
			"DELETE",
			`/api/categories/${source.id}?replacementId=${replacementId}`,
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "replacementId", code: "invalid_value" },
		]);
	});

	it("merges a category into a target, whose count then includes its transactions", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createCategory(uniqueCategory("Restaurants"));
		const target = await createCategory(uniqueCategory("Sorties"));
		await categorise(account.id, source.id);

		const response = await testClient(buildApp()).api.categories[":id"].merge.$post({
			param: { id: source.id },
			json: { targetId: target.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ id: target.id, transactionCount: 1 });
		expect((await categoryList()).find((item) => item.id === source.id)).toBeUndefined();
	});

	it("refuses to merge a parent into its own child", async () => {
		const parent = await createCategory(uniqueCategory("Logement"));
		const child = await createCategory(uniqueCategory("Loyer"), { parentId: parent.id });

		const { status, body } = await request("POST", `/api/categories/${parent.id}/merge`, {
			targetId: child.id,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "targetId", code: "invalid_value" },
		]);
	});

	it.each([
		["PATCH", "/api/categories/nope", { name: "Autre" }],
		["DELETE", "/api/categories/nope", undefined],
		["POST", "/api/categories/nope/merge", { targetId: "other" }],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});

async function createMerchant(name: string) {
	const response = await testClient(buildApp()).api.merchants.$post({ json: { name } });

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Links every transaction of the account to the merchant, by hand through the API. */
async function linkMerchant(accountId: string, merchantId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { merchantId });

		expect(status).toBe(200);
	}, Promise.resolve());
}

async function merchantList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.merchants.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("merchants", () => {
	it("lists the merchants sorted by name, with their transaction counts", async () => {
		own = await freshDatabase();
		const client = testClient(buildApp(own.db)).api.merchants;
		await client.$post({ json: { name: "Fnac" } });
		await client.$post({ json: { name: "Épicerie du coin" } });
		await client.$post({ json: { name: "Carrefour" } });

		const list = await merchantList(own.db);

		expect(list.map((item) => [item.name, item.transactionCount])).toEqual([
			["Carrefour", 0],
			["Épicerie du coin", 0],
			["Fnac", 0],
		]);
	});

	it("creates a merchant, trimming its name", async () => {
		const name = uniqueCategory("Carrefour");

		await expect(request("POST", "/api/merchants", { name: `  ${name} ` })).resolves.toMatchObject({
			status: 201,
			body: { data: { name, transactionCount: 0 } },
		});
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Carrefour");
		await createMerchant(name);

		await expect(request("POST", "/api/merchants", { name: name.toLowerCase() })).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "name", code: "name_taken" }],
				},
			},
		});
	});

	it("refuses a decomposed name beside the composed one", async () => {
		const name = uniqueCategory("Épicerie");
		await createMerchant(name);

		const { status, body } = await request("POST", "/api/merchants", {
			name: name.normalize("NFD"),
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code: "name_taken" }]);
	});

	it.each([
		["a blank name", "  ", "too_small"],
		["a name over 60 characters", "x".repeat(61), "too_big"],
	])("refuses %s", async (_label, name, code) => {
		const { status, body } = await request("POST", "/api/merchants", { name });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code }]);
	});

	it("renames a merchant", async () => {
		const merchant = await createMerchant(uniqueCategory("Carrefour"));
		const name = uniqueCategory("Carrefour Market");

		const response = await testClient(buildApp()).api.merchants[":id"].$patch({
			param: { id: merchant.id },
			json: { name },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ id: merchant.id, name, transactionCount: 0 });
	});

	it("deletes a merchant, unlinking its transactions and keeping their locks", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const merchant = await createMerchant(uniqueCategory("Fleuriste"));
		await linkMerchant(account.id, merchant.id);

		await expect(request("DELETE", `/api/merchants/${merchant.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: merchant.id, unlinked: 2 } },
		});
		await expect(
			temp.db.all(
				sql`select merchant_id as merchantId, locked_fields as locked from transactions where entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([
			{ merchantId: null, locked: '["date","amount","label","merchant"]' },
			{ merchantId: null, locked: '["date","amount","label","merchant"]' },
		]);
		expect((await merchantList()).find((item) => item.id === merchant.id)).toBeUndefined();
	});

	it("merges a merchant into a target, whose count then includes its transactions", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const source = await createMerchant(uniqueCategory("CB Carrefour"));
		const target = await createMerchant(uniqueCategory("Carrefour"));
		await linkMerchant(account.id, source.id);

		const response = await testClient(buildApp()).api.merchants[":id"].merge.$post({
			param: { id: source.id },
			json: { targetId: target.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ id: target.id, transactionCount: 1 });
		expect((await merchantList()).find((item) => item.id === source.id)).toBeUndefined();
	});

	it.each([["nope"], ["self"]])("refuses %s as the merge target", async (which) => {
		const source = await createMerchant(uniqueCategory("Carrefour"));
		const targetId = which === "self" ? source.id : which;

		const { status, body } = await request("POST", `/api/merchants/${source.id}/merge`, {
			targetId,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "targetId", code: "invalid_value" },
		]);
		expect((await merchantList()).find((item) => item.id === source.id)).toBeDefined();
	});

	it.each([
		["PATCH", "/api/merchants/nope", { name: "Autre" }],
		["DELETE", "/api/merchants/nope", undefined],
		["POST", "/api/merchants/nope/merge", { targetId: "other" }],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});

async function createTag(name: string) {
	const response = await testClient(buildApp()).api.tags.$post({ json: { name } });

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Tags every transaction of the account, by hand through the API. */
async function tagAll(accountId: string, tagIds: string[]) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { tagIds });

		expect(status).toBe(200);
	}, Promise.resolve());
}

async function tagList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.tags.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("tags", () => {
	it("lists the tags sorted by name, with their transaction counts", async () => {
		own = await freshDatabase();
		const client = testClient(buildApp(own.db)).api.tags;
		await client.$post({ json: { name: "Vacances" } });
		await client.$post({ json: { name: "Été" } });
		await client.$post({ json: { name: "Anniversaire" } });

		const list = await tagList(own.db);

		expect(list.map((item) => [item.name, item.transactionCount])).toEqual([
			["Anniversaire", 0],
			["Été", 0],
			["Vacances", 0],
		]);
	});

	it("creates a tag, trimming its name", async () => {
		const name = uniqueCategory("Vacances");

		await expect(request("POST", "/api/tags", { name: `  ${name} ` })).resolves.toMatchObject({
			status: 201,
			body: { data: { name, transactionCount: 0 } },
		});
	});

	it("refuses a name taken in another case", async () => {
		const name = uniqueCategory("Vacances");
		await createTag(name);

		const { status, body } = await request("POST", "/api/tags", { name: name.toUpperCase() });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "name", code: "name_taken" }],
		});
	});

	it.each([
		["a blank name", "  ", "too_small"],
		["a name over 60 characters", "x".repeat(61), "too_big"],
	])("refuses %s", async (_label, name, code) => {
		const { status, body } = await request("POST", "/api/tags", { name });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "name", code }]);
	});

	it("renames a tag", async () => {
		const tag = await createTag(uniqueCategory("Vacances"));
		const name = uniqueCategory("Vacances 2026");

		const response = await testClient(buildApp()).api.tags[":id"].$patch({
			param: { id: tag.id },
			json: { name },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ id: tag.id, name, transactionCount: 0 });
	});

	it("deletes a tag, removing it from its transactions and keeping their locks", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const tag = await createTag(uniqueCategory("Vacances"));
		const kept = await createTag(uniqueCategory("Travaux"));
		await tagAll(account.id, [tag.id, kept.id]);

		await expect(request("DELETE", `/api/tags/${tag.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: tag.id, untagged: 2 } },
		});
		await expect(
			temp.db.all(
				sql`select t.locked_fields as locked, (select group_concat(tag_id) from taggings where transaction_id = t.entry_id) as tags from transactions t where t.entry_id in (select id from entries where account_id = ${account.id})`,
			),
		).resolves.toEqual([
			{ locked: '["date","amount","label","tags"]', tags: kept.id },
			{ locked: '["date","amount","label","tags"]', tags: kept.id },
		]);
		expect((await tagList()).find((item) => item.id === tag.id)).toBeUndefined();
	});

	it("deletes a tagged transaction and an account whose transactions carry tags", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, label: "Marché" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const tag = await createTag(uniqueCategory("Vacances"));
		await tagAll(account.id, [tag.id]);

		expect((await request("DELETE", `/api/transactions/${data.id}`)).status).toBe(200);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(1);
		expect((await request("DELETE", `/api/accounts/${account.id}`)).status).toBe(200);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(0);
	});

	it.each([
		["PATCH", "/api/tags/nope", { name: "Autre" }],
		["DELETE", "/api/tags/nope", undefined],
	])("answers %s %s with NOT_FOUND", async (method, path, body) => {
		const response = await request(method, path, body);

		expect(response.status).toBe(404);
		expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
	});
});

// Story 4.5: bulk edit.

async function transactionIds(accountId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction' order by id`,
	);

	return rows.map((row) => row.id);
}

async function rowsOf(accountId: string) {
	return temp.db.all<{
		category: string | null;
		origin: string | null;
		merchant: string | null;
		excluded: number;
		locked: string;
		tags: string | null;
	}>(
		sql`select t.category_id as category, t.category_origin as origin, t.merchant_id as merchant, t.excluded as excluded, t.locked_fields as locked, (select group_concat(tag_id) from (select tag_id from taggings where transaction_id = t.entry_id order by tag_id)) as tags from transactions t join entries e on e.id = t.entry_id where e.account_id = ${accountId} order by e.id`,
	);
}

async function openWith(count: number) {
	const account = await openAccount();

	await Array.from({ length: count }, (_, index) => index).reduce(async (previous, index) => {
		await previous;
		await postTransaction(account.id, { ...expense, label: `Opération ${index}` });
	}, Promise.resolve());

	return { account, ids: await transactionIds(account.id) };
}

const manualLocks = '["date","amount","label"';

describe("POST /api/transactions/bulk-update", () => {
	it("sets a category on the given ids without moving the balance", async () => {
		const { account, ids } = await openWith(3);
		const groceries = await createCategory(uniqueCategory("Courses"));

		const response = await testClient(buildApp()).api.transactions["bulk-update"].$post({
			json: { ids, patch: { categoryId: groceries.id } },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { updated: 3 } });
		const rows = await rowsOf(account.id);
		expect(rows.map((row) => [row.category, row.origin, row.locked])).toEqual(
			ids.map(() => [groceries.id, "user", `${manualLocks},"category"]`]),
		);
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 3 * 4290);
	});

	it("clears a merchant, adds a tag and excludes, locking each", async () => {
		const { account, ids } = await openWith(2);
		const merchant = await createMerchant(uniqueCategory("Carrefour"));
		const kept = await createTag(uniqueCategory("Vacances"));
		const added = await createTag(uniqueCategory("Travaux"));
		await linkMerchant(account.id, merchant.id);
		await tagAll(account.id, [kept.id]);

		await [{ merchantId: null }, { addTagIds: [added.id] }, { excluded: true }].reduce(
			async (previous, patch) => {
				await previous;
				const { status } = await request("POST", "/api/transactions/bulk-update", { ids, patch });

				expect(status).toBe(200);
			},
			Promise.resolve(),
		);

		const rows = await rowsOf(account.id);
		expect(rows).toEqual(
			ids.map(() => ({
				category: null,
				origin: null,
				merchant: null,
				excluded: 1,
				locked: `${manualLocks},"merchant","tags","excluded"]`,
				tags: [kept.id, added.id].toSorted().join(","),
			})),
		);
	});

	it("updates every row the filter matches, refusing a page in the filter", async () => {
		const { account, ids } = await openWith(3);
		const groceries = await createCategory(uniqueCategory("Courses"));

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, category: "none", pageSize: "1" },
				patch: { categoryId: groceries.id },
			}),
		).resolves.toMatchObject({
			status: 400,
			body: { error: { fields: [{ path: "filter", code: "unrecognized_keys" }] } },
		});
		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, category: "none" },
				patch: { categoryId: groceries.id },
			}),
		).resolves.toEqual({ status: 200, body: { data: { updated: 3 } } });
		expect((await rowsOf(account.id)).map((row) => row.category)).toEqual(
			ids.map(() => groceries.id),
		);
	});

	it("reads a parent category in the filter as its children too", async () => {
		const { account } = await openWith(2);
		const parent = await createCategory(uniqueCategory("Maison"));
		const child = await createCategory(uniqueCategory("Travaux"), { parentId: parent.id });
		await categorise(account.id, child.id);

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: [account.id], category: [parent.id] },
				patch: { excluded: true },
			}),
		).resolves.toMatchObject({ body: { data: { updated: 2 } } });
	});

	it("answers 0 when the filter matches nothing", async () => {
		const { account } = await openWith(1);

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, q: "introuvable" },
				patch: { excluded: true },
			}),
		).resolves.toEqual({ status: 200, body: { data: { updated: 0 } } });
	});

	it.each([
		[
			"an unknown id",
			"ids",
			"invalid_value",
			(ids: string[]) => ({ ids: [...ids, "nope"], patch: { excluded: true } }),
		],
		[
			"an unknown category",
			"patch.categoryId",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { categoryId: "nope" } }),
		],
		[
			"an unknown merchant",
			"patch.merchantId",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { merchantId: "nope" } }),
		],
		[
			"an unknown tag",
			"patch.addTagIds",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { addTagIds: ["nope"] } }),
		],
		[
			"ids and a filter",
			"selection",
			"ids_or_filter",
			(ids: string[]) => ({ ids, filter: {}, patch: { excluded: true } }),
		],
		["an empty patch", "patch", "empty_patch", (ids: string[]) => ({ ids, patch: {} })],
	])("writes nothing for %s", async (_label, path, code, bodyOf) => {
		const { account, ids } = await openWith(2);
		const before = await rowsOf(account.id);

		const { status, body: response } = await request(
			"POST",
			"/api/transactions/bulk-update",
			bodyOf(ids),
		);

		expect(status).toBe(400);
		expect(errorBody.parse(response).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code }],
		});
		await expect(rowsOf(account.id)).resolves.toEqual(before);
	});

	it("refuses a selection with neither ids nor a filter", async () => {
		const { status, body } = await request("POST", "/api/transactions/bulk-update", {
			patch: { excluded: true },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "selection", code: "ids_or_filter" },
		]);
	});
});

describe("POST /api/transactions/bulk-delete", () => {
	it("deletes rows over two accounts with their taggings and puts both balances back", async () => {
		const first = await openWith(2);
		const second = await openWith(1);
		const tag = await createTag(uniqueCategory("Vacances"));
		await tagAll(second.account.id, [tag.id]);

		const response = await testClient(buildApp()).api.transactions["bulk-delete"].$post({
			json: { ids: [...first.ids, ...second.ids] },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { deleted: 3 } });
		await expect(transactionIds(first.account.id)).resolves.toEqual([]);
		await expect(transactionIds(second.account.id)).resolves.toEqual([]);
		await expect(balanceOf(first.account.id)).resolves.toBe(123456);
		await expect(balanceOf(second.account.id)).resolves.toBe(123456);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(0);
	});

	it("deletes every row the filter matches", async () => {
		const { account } = await openWith(3);

		await expect(
			request("POST", "/api/transactions/bulk-delete", { filter: { account: account.id } }),
		).resolves.toEqual({ status: 200, body: { data: { deleted: 3 } } });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("deletes nothing when an id names no transaction", async () => {
		const { account, ids } = await openWith(2);

		const { status, body } = await request("POST", "/api/transactions/bulk-delete", {
			ids: [...ids, "nope"],
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "ids", code: "invalid_value" }]);
		await expect(transactionIds(account.id)).resolves.toEqual(ids);
	});
});

describe("transfers", () => {
	async function ownRequest(method: string, path: string, body?: unknown) {
		const response = await buildApp(own?.db).request(path, {
			method,
			headers: { "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});

		return { status: response.status, body: z.unknown().parse(await response.json()) };
	}

	const candidateList = z.object({
		data: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				label: z.string(),
				amount: z.number(),
				currency: z.string(),
				accountId: z.string(),
				accountName: z.string(),
			}),
		),
	});

	const created = z.object({
		data: z.object({
			id: z.string(),
			outflowTransactionId: z.string(),
			inflowTransactionId: z.string(),
			kind: z.enum(TRANSFER_KINDS),
		}),
	});

	/** −500 on the checking account, +500 on the Livret A three days later, +500 six days later. */
	async function household() {
		const checking = await openOwn({ name: "Compte courant" });
		const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
		const card = await openOwn({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "0",
		});
		const outflow = await postOwn(checking.id, {
			date: "2026-09-10",
			label: "VIR LIVRET A",
			amount: "-500,00",
		});
		const inflow = await postOwn(livret.id, {
			date: "2026-09-13",
			label: "VIR COMPTE COURANT",
			amount: "500,00",
		});
		const later = await postOwn(livret.id, {
			date: "2026-09-16",
			label: "Plus tard",
			amount: "500,00",
		});

		return { checking, livret, card, outflow, inflow, later };
	}

	it("lists the candidates, then matches the one picked", async () => {
		const { livret, outflow, inflow } = await household();

		const listedCandidates = await ownRequest(
			"GET",
			`/api/transactions/${outflow}/transfer-candidates`,
		);

		expect(listedCandidates.status).toBe(200);
		expect(candidateList.parse(listedCandidates.body).data).toEqual([
			{
				id: inflow,
				date: "2026-09-13",
				label: "VIR COMPTE COURANT",
				amount: 50000,
				currency: "EUR",
				accountId: livret.id,
				accountName: "Livret A",
			},
		]);

		const matched = await ownRequest("POST", "/api/transfers", {
			transactionId: outflow,
			counterpartId: inflow,
		});

		expect(matched.status).toBe(201);
		expect(created.parse(matched.body).data).toMatchObject({
			outflowTransactionId: outflow,
			inflowTransactionId: inflow,
			kind: "internal_move",
		});
		const data = await listed("?direction=transfer");
		expect(data.items.map((item) => item.id).toSorted()).toEqual([outflow, inflow].toSorted());
		expect(data.items.find((item) => item.id === outflow)).toMatchObject({
			transfer: { kind: "internal_move", counterpartAccountName: "Livret A" },
		});
	});

	it("makes a payment into a card a card payment", async () => {
		const { checking, card } = await household();
		const payment = await postOwn(checking.id, {
			date: "2026-09-12",
			label: "PRLV CARTE",
			amount: "-300,00",
		});
		const repaid = await postOwn(card.id, {
			date: "2026-09-12",
			label: "REMBOURSEMENT",
			amount: "300,00",
		});

		const { status, body } = await ownRequest("POST", "/api/transfers", {
			transactionId: repaid,
			counterpartId: payment,
		});

		expect(status).toBe(201);
		expect(created.parse(body).data).toMatchObject({
			outflowTransactionId: payment,
			kind: "credit_card_payment",
		});
	});

	it("refuses a counterpart that is not a candidate, already matched included", async () => {
		const { checking, outflow, inflow } = await household();
		await ownRequest("POST", "/api/transfers", { transactionId: outflow, counterpartId: inflow });
		// Five days before the other +500, so nothing else qualifies.
		const second = await postOwn(checking.id, {
			date: "2026-09-11",
			label: "VIR LIVRET A",
			amount: "-500,00",
		});

		const refused = async (counterpartId: string) => {
			const { status, body } = await ownRequest("POST", "/api/transfers", {
				transactionId: second,
				counterpartId,
			});

			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "counterpartId", code: "not_a_candidate" }],
			});
		};

		await refused(inflow);
		await refused("nope");
		const { body } = await ownRequest("GET", `/api/transactions/${second}/transfer-candidates`);
		expect(candidateList.parse(body).data).toEqual([]);
	});

	it("unmatches a transfer, both sides becoming standard again", async () => {
		const { outflow, inflow } = await household();
		const matched = await ownRequest("POST", "/api/transfers", {
			transactionId: outflow,
			counterpartId: inflow,
		});
		const { id } = created.parse(matched.body).data;

		await expect(ownRequest("DELETE", `/api/transfers/${id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id } },
		});
		const data = await listed("?direction=transfer");
		expect(data.items).toEqual([]);
		expect((await listed("?direction=expense&direction=income")).total).toBe(3);
	});

	it("answers NOT_FOUND for an unknown transaction or transfer", async () => {
		const { inflow } = await household();

		const notFound = async (method: string, path: string, body?: unknown) => {
			const response = await ownRequest(method, path, body);

			expect(response.status).toBe(404);
			expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
		};

		await notFound("GET", "/api/transactions/nope/transfer-candidates");
		await notFound("POST", "/api/transfers", { transactionId: "nope", counterpartId: inflow });
		await notFound("DELETE", "/api/transfers/nope");
	});

	it("refuses a body without both ids", async () => {
		const { status, body } = await request("POST", "/api/transfers", { transactionId: "t1" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "counterpartId", code: "invalid_type" },
		]);
	});

	it("filters by direction, and deletes the rows of a direction in bulk", async () => {
		const { checking, outflow, inflow, later } = await household();
		await ownRequest("POST", "/api/transfers", { transactionId: outflow, counterpartId: inflow });
		const spent = await postOwn(checking.id, { date: "2026-09-14", label: "Café", amount: "-20" });
		const earned = await postOwn(checking.id, { date: "2026-09-14", label: "Prime", amount: "30" });

		expect((await listed("?direction=expense")).items.map((item) => item.id)).toEqual([spent]);
		// The +500 left alone on the Livret is income until someone matches it.
		expect((await listed("?direction=income")).items.map((item) => item.id).toSorted()).toEqual(
			[earned, later].toSorted(),
		);
		const refused = await ownRequest("GET", "/api/transactions?direction=refund");
		expect(refused.status).toBe(400);

		await expect(
			ownRequest("POST", "/api/transactions/bulk-delete", {
				filter: { direction: "expense" },
			}),
		).resolves.toEqual({ status: 200, body: { data: { deleted: 1 } } });
	});
});
