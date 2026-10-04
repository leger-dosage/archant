import type { CreateAccountInput } from "../schemas/accounts.ts";
import type { CreateCategoryInput } from "../schemas/categories.ts";
import type { SignedInTemplate } from "./auth.ts";
import type { TempDatabase } from "./temp-database.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import { z } from "zod";

import { validateEnv } from "../env.ts";
import { createLogger } from "../lib/logger.ts";
import { bankDepsFromEnv } from "../services/bank-connections.ts";
import { buildTestApp, createSignedInTemplate, createTestAuth, withSession } from "./auth.ts";
import { TEST_APPLICATION_ID, TEST_ENCRYPTION_KEY_BASE64, TEST_PKCS1_BASE64 } from "./bank.ts";
import { mockProvider } from "./enable-banking.ts";
import { createTempDatabase } from "./temp-database.ts";

// Live bindings: `useSignedInApp` assigns them before the file's first test.
export let template: SignedInTemplate;
export let temp: TempDatabase;
export let logLines: string[];

// Signed in as the administrator: every request carries the session cookie
// and the interface's origin. Unauthenticated behaviour lives in
// routes/middleware/auth.spec.ts.
export function buildApp(db = temp.db) {
	logLines = [];
	const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

	return withSession(buildTestApp(db, logger), template.cookie);
}

/** A database of its own, already holding the signed-in administrator. */
export async function freshDatabase() {
	return createTempDatabase(template.file);
}

// Each listing test owns its database, so it passes alone or in any order.
export let own: TempDatabase | undefined;

// A spec file cannot assign an imported binding, so a test takes its own
// database, or a fresh log, through these.

/** A database of the running test's own, disposed after it. */
export async function ownDatabase(): Promise<TempDatabase> {
	own = await freshDatabase();

	return own;
}

/** Starts the log the next app writes afresh. */
export function clearLogLines(): void {
	logLines = [];
}

export async function ownClient() {
	own = await freshDatabase();

	return testClient(buildApp(own.db)).api.accounts;
}

export const errorBody = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		fields: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
	}),
});

export const valid = {
	name: "Compte joint",
	type: "depository",
	subtype: "checking",
	currency: "EUR",
	openingBalance: "1 234,56",
	openingDate: "2026-09-01",
} as const;

export const mortgage = {
	name: "Prêt immobilier",
	type: "loan",
	subtype: "mortgage",
	openingBalance: "180 000,00",
} as const;

export const pea = {
	name: "PEA",
	type: "investment",
	subtype: "pea",
	openingBalance: "25 000,00",
} as const;

export const home = {
	name: "Maison",
	type: "property",
	subtype: "single_family_home",
	openingBalance: "320 000,00",
} as const;

export const car = {
	name: "Voiture",
	type: "vehicle",
	subtype: null,
	openingBalance: "18 500,00",
} as const;

/**
 * One sign-in per spec file, against a database of its own: Better Auth
 * allows three sign-ins per ten seconds, and each file's limit lives in its
 * database.
 */
export function useSignedInApp(): void {
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
}

export async function request(method: string, path: string, body?: unknown) {
	const response = await buildApp().request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

export async function openAccount(overrides: Partial<CreateAccountInput> = {}) {
	const response = await testClient(buildApp()).api.accounts.$post({
		json: { ...valid, ...overrides },
	});

	return (await response.json()).data;
}

export const expense = { date: "2026-09-10", label: "Boulangerie", amount: "-42,90" };

export async function postTransaction(accountId: string, json: Record<string, string | null>) {
	return request("POST", `/api/accounts/${accountId}/transactions`, json);
}

export async function balanceOf(accountId: string) {
	const response = await testClient(buildApp()).api.accounts[":id"].$get({
		param: { id: accountId },
	});

	return (await response.json()).data.balance;
}

export const listItem = z.object({
	id: z.string(),
	accountId: z.string(),
	accountName: z.string(),
	accountType: z.string(),
	recurring: z.boolean(),
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
	transferSuggested: z.boolean(),
	possibleDuplicate: z.boolean(),
	parentEntryId: z.string().nullable(),
	splitParent: z.boolean(),
});

export const listBody = z.object({
	data: z.strictObject({
		items: z.array(listItem),
		splitParents: z.array(listItem),
		page: z.number(),
		pageSize: z.number(),
	}),
});

export const totalsBody = z.object({
	data: z.strictObject({
		total: z.number(),
		sum: z.object({
			amount: z.number(),
			income: z.number(),
			expense: z.number(),
			currency: z.string(),
			skippedCount: z.number(),
		}),
	}),
});

/** The I/O matrix of Story 1.5, each test in its own database. */
export async function listOwn(query: string) {
	const response = await buildApp(own?.db).request(`/api/transactions${query}`);
	const body = z.unknown().parse(await response.json());

	return { status: response.status, body };
}

export async function totalsOwn(query: string) {
	const response = await buildApp(own?.db).request(`/api/transactions/totals${query}`);
	const body = z.unknown().parse(await response.json());

	return { status: response.status, body };
}

/**
 * A page and the totals of the same filter, as the interface asks for them:
 * `/totals` ignores `page` and `pageSize`, so the query goes to both as it is.
 */
export async function listed(query: string) {
	const [list, totals] = await Promise.all([listOwn(query), totalsOwn(query)]);

	expect(list.status, JSON.stringify(list.body)).toBe(200);
	expect(totals.status, JSON.stringify(totals.body)).toBe(200);

	return { ...listBody.parse(list.body).data, ...totalsBody.parse(totals.body).data };
}

export async function openOwn(overrides: Partial<CreateAccountInput> = {}) {
	own ??= await freshDatabase();
	const response = await testClient(buildApp(own.db)).api.accounts.$post({
		json: { ...valid, ...overrides },
	});

	return (await response.json()).data;
}

export async function postOwn(accountId: string, json: Record<string, string>) {
	const response = await buildApp(own?.db).request(`/api/accounts/${accountId}/transactions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(json),
	});

	return z.object({ data: z.object({ id: z.string() }) }).parse(await response.json()).data.id;
}

// The I/O matrix of Story 1.4: checking opened on 2026-01-10 at 1 500,00, a
// -120,00 on 2026-03-02, and the clock at 2026-09-21.
export const pinned = { openingBalance: "1 500,00", openingDate: "2026-01-10" };

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

export async function openPinned(overrides: Partial<CreateAccountInput> = {}) {
	const account = await openAccount({ ...pinned, ...overrides });
	await postTransaction(account.id, { date: "2026-03-02", label: "Courses", amount: "-120,00" });

	return account;
}

export async function postSnapshot(accountId: string, json: Record<string, string>) {
	return request("POST", `/api/accounts/${accountId}/snapshots`, json);
}

export async function recorded(accountId: string, json: Record<string, string>) {
	const { status, body } = await postSnapshot(accountId, json);

	expect(status).toBe(201);

	return z.object({ data: snapshotItem }).parse(body).data;
}

export async function snapshotsOf(accountId: string) {
	const { body } = await request("GET", `/api/accounts/${accountId}/snapshots`);

	return snapshotPage.parse(body).data;
}

export async function balanceOnDay(accountId: string, date: string) {
	// The chart's data: every day since the opening date.
	const response = await testClient(buildApp()).api.accounts[":id"].balances.$get({
		param: { id: accountId },
		query: { period: "all" },
	});
	const { points } = (await response.json()).data;

	return points.find((point) => point.date === date)?.balance;
}

// Story 2.1: import an OFX file with preview.

export const importBody = z.object({
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

export const creditAgricole = async () =>
	new Uint8Array(
		await readFile(
			new URL("../connectors/ofx/fixtures/credit-agricole-102-sgml.ofx", import.meta.url),
		),
	);

/** A valid one-line card statement grown to `size` bytes by blank lines before `<OFX>`. */
export function paddedOfx(size: number): Uint8Array {
	const body = new TextEncoder().encode(
		"<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260910<TRNAMT>-12.00<FITID>P1<NAME>Librairie</STMTTRN>\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
	);
	const bytes = new Uint8Array(size).fill(0x0a);

	bytes.set(body, size - body.length);

	return bytes;
}

export async function upload(accountId: string, bytes: Uint8Array, name = "releve.ofx") {
	const form = new FormData();
	form.append("file", new File([bytes], name));
	const response = await buildApp().request(`/api/accounts/${accountId}/imports`, {
		method: "POST",
		body: form,
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

export async function uploaded(accountId: string, bytes: Uint8Array) {
	const { status, body } = await upload(accountId, bytes);

	expect(status).toBe(201);

	return importBody.parse(body).data;
}

export async function transactionsOf(accountId: string) {
	const response = await testClient(buildApp()).api.accounts[":id"].transactions.$get({
		param: { id: accountId },
		query: {},
	});

	return (await response.json()).data;
}

/** An account of its own database, opened early enough for three months of lines. */
export async function ownRecurringAccount() {
	own = await freshDatabase();
	const app = buildApp(own.db);
	const response = await testClient(app).api.accounts.$post({
		json: { ...valid, openingDate: "2026-01-01" },
	});

	return { app, db: own.db, account: (await response.json()).data };
}

export async function recurringRows(db: TempDatabase["db"]) {
	return db.all(
		sql`select account_id as accountId, merchant_id as merchantId, label_key as labelKey, amount, currency, expected_day_of_month as day, last_occurrence_date as last, next_expected_date as next, occurrence_count as count from recurring_transactions`,
	);
}

export async function confirmedImport(accountId: string) {
	const preview = await uploaded(accountId, await creditAgricole());
	await request("POST", `/api/imports/${preview.id}/confirm`);

	return preview.id;
}

export const category = (name: string, overrides: Partial<CreateCategoryInput> = {}) => ({
	name,
	kind: "expense" as const,
	color: "#e99537",
	icon: "tag" as const,
	parentId: null,
	...overrides,
});

/** A name no other test of this file uses: the categories share one database. */
export const uniqueCategory = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;

export async function createCategory(name: string, overrides: Partial<CreateCategoryInput> = {}) {
	const response = await testClient(buildApp()).api.categories.$post({
		json: category(name, overrides),
	});

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Puts every transaction of the account in the category, by hand through the API. */
export async function categorise(accountId: string, categoryId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { categoryId });

		expect(status).toBe(200);
	}, Promise.resolve());
}

export async function createMerchant(name: string) {
	const response = await testClient(buildApp()).api.merchants.$post({ json: { name } });

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Links every transaction of the account to the merchant, by hand through the API. */
export async function linkMerchant(accountId: string, merchantId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { merchantId });

		expect(status).toBe(200);
	}, Promise.resolve());
}

export async function createTag(name: string) {
	const response = await testClient(buildApp()).api.tags.$post({ json: { name } });

	expect(response.status).toBe(201);

	return (await response.json()).data;
}

/** Tags every transaction of the account, by hand through the API. */
export async function tagAll(accountId: string, tagIds: string[]) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	await rows.reduce(async (previous, row) => {
		await previous;
		const { status } = await request("PATCH", `/api/transactions/${row.id}`, { tagIds });

		expect(status).toBe(200);
	}, Promise.resolve());
}

export async function tagList(db = temp.db) {
	const response = await testClient(buildApp(db)).api.tags.$get();

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

export async function ownRequest(method: string, path: string, body?: unknown) {
	const response = await buildApp(own?.db).request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

/** The I/O matrix of Story 6.1, each test in its own database. */
export async function netWorthOf(period?: "1M" | "3M" | "6M" | "1Y" | "all") {
	own ??= await freshDatabase();
	const response = await testClient(buildApp(own.db)).api.reports["net-worth"].$get({
		query: period === undefined ? {} : { period },
	});

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

export const ownCard = {
	name: "Carte",
	type: "credit_card",
	subtype: null,
	openingBalance: "300,00",
} as const;

/** The I/O matrix of Story 6.2, each test in its own database. */
export async function cashFlowOf(month: string) {
	own ??= await freshDatabase();
	const response = await testClient(buildApp(own.db)).api.reports["cash-flow"].$get({
		query: { month },
	});

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

export async function sendOwn(method: string, path: string, body?: unknown) {
	const response = await buildApp(own?.db).request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const json = z.unknown().parse(await response.json());

	expect(response.status, JSON.stringify(json)).toBeLessThan(300);

	return json;
}

export async function ownCategory(name: string, overrides: Partial<CreateCategoryInput> = {}) {
	own ??= await freshDatabase();
	const body = await sendOwn("POST", "/api/categories", category(name, overrides));

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

// PKCS#1, as an older control panel export, so the whole path signs with it.
export function configuredBank() {
	const { bankCredentials, encryptionKey, bankApiUrl } = bankDepsFromEnv(
		validateEnv({
			DATABASE_URL: "file:x.db",
			BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
			BETTER_AUTH_URL: "http://localhost:5173",
			ENABLE_BANKING_APPLICATION_ID: TEST_APPLICATION_ID,
			ENABLE_BANKING_PRIVATE_KEY: TEST_PKCS1_BASE64,
			ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
		}),
	);

	return { bankCredentials, encryptionKey, bankApiUrl };
}

export async function bankApp(bank = configuredBank()) {
	own = await freshDatabase();
	logLines = [];
	const logger = createLogger("info", { write: (text: string) => logLines.push(text) });

	return withSession(buildTestApp(own.db, logger, undefined, {}, bank), template.cookie);
}

/**
 * Marks today's first-visit sync as run: the test's next requests would
 * otherwise start it beside them, racing whatever the test itself syncs.
 */
export async function attemptedToday(connectionId: string) {
	if (own === undefined) {
		throw new Error("attemptedToday needs the test's own database.");
	}

	await own.db.run(
		sql`update bank_connections set sync_attempted_at = ${Date.now()} where id = ${connectionId}`,
	);
}

export async function syncApp(bank: Parameters<typeof buildTestApp>[4] = configuredBank()) {
	own = await freshDatabase();
	logLines = [];
	const logger = createLogger("info", { write: (text: string) => logLines.push(text) });
	// Started before the test spies on the database: Better Auth's start reads it.
	const auth = createTestAuth(own.db, logger);
	await auth.$context;

	return { db: own.db, app: buildTestApp(own.db, logger, auth, {}, bank) };
}

export async function linkedConnection(app: ReturnType<typeof buildTestApp>) {
	const requests = mockProvider();
	const client = testClient(withSession(app, template.cookie)).api["bank-connections"];
	await client.$post({ json: { country: "FR", institution: "Banque Test" } });
	const { state } = z
		.object({ state: z.string() })
		.parse(requests.find((sent) => sent.path === "/auth")?.body);
	const connection = (await (await client.callback.$post({ json: { code: "c", state } })).json())
		.data;
	await attemptedToday(connection.id);
	const rows = (await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json())
		.data;
	const checking = rows.find((row) => row.name === "Compte courant");
	const linked = await client[":id"].accounts.$post({
		param: { id: connection.id },
		json: {
			links: [
				{
					bankAccountId: checking?.id ?? "",
					action: "create",
					type: "depository",
					subtype: "checking",
				},
			],
		},
	});
	const account = (await linked.json()).data.find((row) => row.id === checking?.id)?.account;

	return { client, connection, accountId: account?.id ?? "", requests };
}
