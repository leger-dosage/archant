import type { TempDatabase } from "../testing/temp-database.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";
import type { NewAccountInput } from "./ledger.ts";

import { eq, sql } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { server } from "../../vitest.setup.ts";
import { validateEnv } from "../env.ts";
import { createLogger } from "../lib/logger.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PKCS8_BASE64,
	TEST_PROVIDER_URL,
} from "../testing/bank.ts";
import {
	FIXTURE_AUTH_URL,
	FIXTURE_CARD_UID,
	FIXTURE_CHECKING_UID,
	FIXTURE_CONSENT_END,
	FIXTURE_IBAN_HEAD,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
} from "../testing/enable-banking.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import {
	bankDepsFromEnv,
	bankSetup,
	completeConnection,
	linkBankAccounts,
	listBankAccounts,
	listConnections,
	listInstitutions,
	startConnection,
} from "./bank-connections.ts";
import { decrypt } from "./crypto.ts";
import { balanceOn, createAccount, ingest } from "./ledger.ts";

const NOW = Date.parse("2026-09-24T10:00:00Z");
const DAY = 86_400_000;
const MINUTE = 60_000;

const BASE_ENV = {
	DATABASE_URL: "file:x.db",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
	BETTER_AUTH_URL: "http://localhost:5173",
};

const FULL_ENV = {
	...BASE_ENV,
	ENABLE_BANKING_APPLICATION_ID: TEST_APPLICATION_ID,
	ENABLE_BANKING_PRIVATE_KEY: TEST_PKCS8_BASE64,
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
};

let temp: TempDatabase;
let logLines: string[];

function deps(): BankConnectionDeps {
	logLines = [];

	return {
		db: temp.db,
		timeZone: "Europe/Paris",
		logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
		...bankDepsFromEnv(validateEnv(FULL_ENV)),
	};
}

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	// Accounts keep their history, which the ledger alone deletes: earlier
	// tests' ones are set aside rather than removed.
	await temp.db.update(accounts).set({ bankAccountId: null, active: false });
	await temp.db.delete(bankConnections);
});

const rows = () => temp.db.select().from(bankConnections);

/** The `state` the API sent to the provider on its latest `/auth`. */
function sentState(requests: ReturnType<typeof mockProvider>): string {
	const auth = requests.findLast((request) => request.path === "/auth");
	const body = auth?.body;

	if (typeof body !== "object" || body === null || !("state" in body)) {
		throw new Error("No /auth request was sent.");
	}

	return String(body.state);
}

describe("bankDepsFromEnv", () => {
	it("is available with the three variables, and redirects to the return page", () => {
		const bank = bankDepsFromEnv(validateEnv(FULL_ENV));

		expect(bankSetup(bank)).toEqual({ available: true, missing: [] });
		expect(bank.bankConnector?.id).toBe("enable-banking");
		expect(bank.redirectUrl).toBe("http://localhost:5173/settings/banks/callback");
	});

	it("names ENCRYPTION_KEY alone when it is the one missing", () => {
		const bank = bankDepsFromEnv(validateEnv({ ...FULL_ENV, ENCRYPTION_KEY: "" }));

		expect(bankSetup(bank)).toEqual({ available: false, missing: ["ENCRYPTION_KEY"] });
		expect(bank.bankConnector).toBeNull();
	});

	it("names every missing variable, never a value", () => {
		const bank = bankDepsFromEnv(validateEnv(BASE_ENV));

		expect(bankSetup(bank)).toEqual({
			available: false,
			missing: ["ENABLE_BANKING_APPLICATION_ID", "ENABLE_BANKING_PRIVATE_KEY", "ENCRYPTION_KEY"],
		});
	});
});

describe("when unavailable", () => {
	it("refuses every operation with BANK_CONNECTOR_UNAVAILABLE", async () => {
		const unavailable = {
			...deps(),
			...bankDepsFromEnv(validateEnv({ ...FULL_ENV, ENCRYPTION_KEY: "" })),
		};
		const refused = { code: "BANK_CONNECTOR_UNAVAILABLE", status: 503 };

		await expect(listInstitutions(unavailable, "FR")).rejects.toMatchObject(refused);
		await expect(
			startConnection(unavailable, { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject(refused);
		await expect(completeConnection(unavailable, { code: "c", state: "s" })).rejects.toMatchObject(
			refused,
		);
		await expect(listConnections(unavailable)).rejects.toMatchObject(refused);
		await expect(listBankAccounts(unavailable, "c1")).rejects.toMatchObject(refused);
		await expect(
			linkBankAccounts(unavailable, "c1", {
				links: [{ bankAccountId: "b1", action: "link", accountId: "a1" }],
			}),
		).rejects.toMatchObject(refused);
	});
});

describe("listInstitutions", () => {
	it("lists a country's banks by name, without their consent length", async () => {
		mockProvider();

		await expect(listInstitutions(deps(), "FR")).resolves.toEqual([
			{
				name: "Banque Test",
				country: "FR",
				logo: "https://enablebanking.com/brands/FR/Banque%20Test/",
				bic: "BTSTFRPP",
			},
			{ name: "Caisse Sans Limite", country: "FR", logo: null, bic: null },
			{ name: "Crédit Exemple", country: "FR", logo: null, bic: null },
		]);
	});

	it("logs a provider failure with its status and code only", async () => {
		mockProvider({ aspsps: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });
		const service = deps();

		await expect(listInstitutions(service, "FR")).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
		expect(logLines.join("")).toContain('"providerCode":"UNAUTHORIZED"');
		expect(logLines.join("")).not.toContain("Invalid token");
	});
});

describe("startConnection", () => {
	it("asks for 90 days of a 180-day bank and stores a pending row keyed by the state", async () => {
		const requests = mockProvider();

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Test" }),
		).resolves.toEqual({ url: FIXTURE_AUTH_URL });

		const auth = requests.find((request) => request.path === "/auth");
		expect(auth?.body).toMatchObject({
			access: { valid_until: new Date(NOW + 90 * DAY).toISOString() },
			aspsp: { name: "Banque Test", country: "FR" },
			redirect_url: "http://localhost:5173/settings/banks/callback",
		});
		await expect(rows()).resolves.toEqual([
			expect.objectContaining({
				connector: "enable-banking",
				institutionName: "Banque Test",
				country: "FR",
				status: "pending",
				authorizationState: sentState(requests),
				sessionId: null,
				consentExpiresAt: null,
				createdAt: NOW,
			}),
		]);
	});

	it("asks for 30 days of a 30-day bank", async () => {
		const requests = mockProvider();

		await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

		expect(requests.find((request) => request.path === "/auth")?.body).toMatchObject({
			access: { valid_until: new Date(NOW + 30 * DAY).toISOString() },
		});
	});

	it("refuses a bank the provider does not list, and writes nothing", async () => {
		const requests = mockProvider();

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Inconnue" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "institution", code: "invalid_value" }],
		});
		expect(requests.map((request) => request.path)).toEqual(["/aspsps"]);
		await expect(rows()).resolves.toEqual([]);
	});

	it("removes the pending row and names the URL when the redirect is not registered", async () => {
		mockProvider({ auth: () => HttpResponse.json(fixtures.redirectNotAllowed, { status: 400 }) });
		const service = deps();

		await expect(
			startConnection(service, { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject({
			code: "BANK_REDIRECT_NOT_ALLOWED",
			status: 502,
			params: { url: "http://localhost:5173/settings/banks/callback" },
		});
		await expect(rows()).resolves.toEqual([]);
		expect(logLines.join("")).toContain('"providerCode":"REDIRECT_URI_NOT_ALLOWED"');
		expect(logLines.join("")).toContain('"status":400');
		expect(logLines.join("")).toContain('"connectionId":"');
	});

	it("writes nothing when the bank list cannot be read", async () => {
		mockProvider({ aspsps: () => new HttpResponse(null, { status: 503 }) });

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR" });
		await expect(rows()).resolves.toEqual([]);
	});

	it("deletes pending attempts older than 30 minutes, and keeps recent ones", async () => {
		mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		vi.setSystemTime(NOW + 20 * MINUTE);
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		vi.setSystemTime(NOW + 31 * MINUTE);

		await startConnection(deps(), { country: "FR", institution: "Banque Test" });

		const kept = await rows();
		expect(kept.map((row) => row.createdAt).toSorted((left, right) => left - right)).toEqual([
			NOW + 20 * MINUTE,
			NOW + 31 * MINUTE,
		]);
	});
});

describe("completeConnection", () => {
	async function started() {
		const requests = mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });

		return sentState(requests);
	}

	it("stores an active connection with its session encrypted and its consent end", async () => {
		const state = await started();
		const service = deps();

		const connection = await completeConnection(service, { code: "the-code", state });

		expect(connection).toMatchObject({
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			consentExpiresAt: FIXTURE_CONSENT_END,
			createdAt: NOW,
		});
		const [row] = await rows();
		expect(row?.status).toBe("active");
		expect(row?.authorizationState).toBeNull();
		expect(row?.sessionId).toMatch(/^v1:/u);
		expect(row?.sessionId).not.toContain(FIXTURE_SESSION_ID);
		expect(decrypt(Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"), row?.sessionId ?? "")).toBe(
			FIXTURE_SESSION_ID,
		);
		expect(logLines.join("")).toContain(`"connectionId":"${connection.id}"`);
		expect(logLines.join("")).not.toContain(FIXTURE_SESSION_ID);
	});

	it("refuses an unknown state and writes nothing", async () => {
		await started();
		const before = await rows();

		await expect(
			completeConnection(deps(), { code: "the-code", state: crypto.randomUUID() }),
		).rejects.toMatchObject({ code: "BANK_AUTHORIZATION_INVALID", status: 400 });
		await expect(rows()).resolves.toEqual(before);
	});

	it("refuses a replayed state, leaving the first connection as it was", async () => {
		const state = await started();
		await completeConnection(deps(), { code: "the-code", state });
		const before = await rows();

		await expect(completeConnection(deps(), { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_AUTHORIZATION_INVALID",
		});
		await expect(rows()).resolves.toEqual(before);
	});

	it("refuses a state 31 minutes old and writes nothing", async () => {
		const state = await started();
		const before = await rows();
		vi.setSystemTime(NOW + 31 * MINUTE);

		await expect(completeConnection(deps(), { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_AUTHORIZATION_INVALID",
		});
		await expect(rows()).resolves.toEqual(before);
	});

	it("keeps a row claimed at minute 29 while a start at minute 31 cleans up", async () => {
		const state = await started();
		vi.setSystemTime(NOW + 29 * MINUTE);
		// Another tab starts a connection while the provider opens the session.
		server.use(
			http.post(`${TEST_PROVIDER_URL}/sessions`, async () => {
				vi.setSystemTime(NOW + 31 * MINUTE);
				await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

				return HttpResponse.json(fixtures.session);
			}),
		);

		await expect(completeConnection(deps(), { code: "the-code", state })).resolves.toMatchObject({
			institutionName: "Banque Test",
			status: "active",
		});
		await expect(rows()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ institutionName: "Banque Test", status: "active" }),
			]),
		);
	});

	it("accepts a state 29 minutes old", async () => {
		const state = await started();
		vi.setSystemTime(NOW + 29 * MINUTE);

		await expect(completeConnection(deps(), { code: "the-code", state })).resolves.toMatchObject({
			status: "active",
		});
	});

	it("stores nothing from a session without an id, and logs none of it", async () => {
		const state = await started();
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					accounts: [{ account_id: { iban: "FR7612345" } }],
					access: { valid_until: "2026-12-20T10:00:00Z" },
				}),
		});
		const service = deps();

		await expect(completeConnection(service, { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
			status: 502,
		});
		await expect(rows()).resolves.toEqual([]);
		expect(logLines.join("")).toContain('"status":200');
		expect(logLines.join("")).not.toContain("FR7612345");
	});
});

describe("listConnections", () => {
	it("lists active connections without any secret, pending ones left out", async () => {
		const requests = mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		const state = sentState(requests);
		await completeConnection(deps(), { code: "the-code", state });
		await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

		const list = await listConnections(deps());

		expect(list).toHaveLength(1);
		expect(list).toMatchObject([
			{
				connector: "enable-banking",
				institutionName: "Banque Test",
				country: "FR",
				status: "active",
				consentExpiresAt: FIXTURE_CONSENT_END,
				createdAt: NOW,
			},
		]);
		expect(JSON.stringify(list)).not.toMatch(/v1:|sessionId|authorizationState/u);
	});
});

/** A connection through the whole flow, with the session fixture's two accounts. */
async function connected(sessions?: () => Response) {
	const requests = mockProvider(sessions === undefined ? {} : { sessions });
	await startConnection(deps(), { country: "FR", institution: "Banque Test" });

	return completeConnection(deps(), { code: "the-code", state: sentState(requests) });
}

describe("completeConnection and the session's accounts", () => {
	it("keeps each shared account with its last four IBAN characters only", async () => {
		const connection = await connected();

		const stored = await temp.db
			.select()
			.from(bankAccounts)
			.where(eq(bankAccounts.bankConnectionId, connection.id))
			.orderBy(bankAccounts.name);
		expect(stored).toEqual([
			expect.objectContaining({
				identificationHash: "anonymised-hash-card",
				providerUid: FIXTURE_CARD_UID,
				name: "Carte Visa Premier",
				ibanLast4: null,
				currency: "EUR",
				cashAccountType: "CARD",
			}),
			expect.objectContaining({
				identificationHash: "anonymised-hash-checking",
				providerUid: FIXTURE_CHECKING_UID,
				name: "Compte courant",
				ibanLast4: "0185",
				currency: "EUR",
				cashAccountType: "CACC",
			}),
		]);
		expect(JSON.stringify(stored)).not.toContain(FIXTURE_IBAN_HEAD);
		expect(logLines.join("")).toContain('"accounts":2');
		expect(logLines.join("")).not.toContain(FIXTURE_CHECKING_UID);
	});

	it("keeps one row per identification hash, the last one listed", async () => {
		const [first] = z
			.array(z.unknown())
			.parse(z.object({ accounts: z.unknown() }).parse(fixtures.session).accounts);
		const connection = await connected(() =>
			HttpResponse.json({
				...z.object({}).passthrough().parse(fixtures.session),
				accounts: [
					first,
					{ ...z.object({}).passthrough().parse(first), uid: "u-2", product: "Renommé" },
				],
			}),
		);

		await expect(
			temp.db
				.select({ uid: bankAccounts.providerUid, name: bankAccounts.name })
				.from(bankAccounts)
				.where(eq(bankAccounts.bankConnectionId, connection.id)),
		).resolves.toEqual([{ uid: "u-2", name: "Renommé" }]);
	});

	it("opens a connection that shares no account", async () => {
		const connection = await connected(() =>
			HttpResponse.json({
				session_id: "s",
				accounts: [],
				access: { valid_until: "2026-12-20T10:00:00Z" },
			}),
		);

		await expect(listBankAccounts(deps(), connection.id)).resolves.toEqual([]);
	});
});

const eur: NewAccountInput = {
	name: "Compte joint",
	type: "depository",
	subtype: "checking",
	currency: "EUR",
	openingBalance: toMinorUnits(123456),
	openingDate: "2026-09-01",
};

const openAccount = (overrides: Partial<NewAccountInput> = {}) =>
	createAccount(
		{ db: temp.db, timeZone: "Europe/Paris" },
		{ ...eur, ...overrides },
		{ origin: "user" },
	);

async function bankAccountsOf(connectionId: string) {
	const list = await listBankAccounts(deps(), connectionId);
	const checking = list.find((row) => row.name === "Compte courant");
	const card = list.find((row) => row.name === "Carte Visa Premier");

	if (checking === undefined || card === undefined) {
		throw new Error("The fixture's accounts are missing.");
	}

	return { list, checking, card };
}

// Read through SQL: only the ledger imports the entries table (AD-2).
async function valuations(accountId: string) {
	return temp.db.all<{ kind: string; date: string; amount: number }>(
		sql`select valuation_kind as kind, date, amount from entries where account_id = ${accountId} and kind = 'valuation' order by date`,
	);
}

async function entriesOf(accountId: string) {
	return temp.db.all<Record<string, unknown>>(
		sql`select * from entries where account_id = ${accountId} order by id`,
	);
}

const allEntries = () =>
	temp.db.all<Record<string, unknown>>(sql`select * from entries order by id`);

/** Answers each uid's balances from `byUid`, the fixture otherwise. */
function balancesBy(byUid: Record<string, unknown>) {
	return (url: URL) => {
		const uid = url.pathname.split("/")[2] ?? "";

		return HttpResponse.json(byUid[uid] ?? fixtures.balances);
	};
}

const itbd = (amount: string) => ({
	balances: [{ balance_amount: { amount, currency: "EUR" }, balance_type: "ITBD" }],
});

describe("listBankAccounts", () => {
	it("offers each bank account its suggestion and the compatible accounts, by name", async () => {
		const connection = await connected();
		const joint = await openAccount({ name: "Compte joint" });
		const other = await openAccount({ name: "Autre compte" });
		const savings = await openAccount({ name: "Livret", subtype: "savings" });
		await openAccount({ name: "Compte USD", currency: "USD" });
		await openAccount({ name: "PEA", type: "investment", subtype: "pea" });
		const inactive = await openAccount({ name: "Ancien compte" });
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, inactive.id));
		const visa = await openAccount({ name: "Visa", type: "credit_card", subtype: null });

		const { checking, card } = await bankAccountsOf(connection.id);

		expect(checking).toMatchObject({
			name: "Compte courant",
			ibanLast4: "0185",
			currency: "EUR",
			suggestion: { type: "depository", subtype: "checking" },
			account: null,
			candidates: [
				{ id: other.id, name: "Autre compte", type: "depository", subtype: "checking" },
				{ id: joint.id, name: "Compte joint", type: "depository", subtype: "checking" },
				{ id: savings.id, name: "Livret", type: "depository", subtype: "savings" },
			],
		});
		expect(card).toMatchObject({
			ibanLast4: null,
			suggestion: { type: "credit_card", subtype: null },
			candidates: [{ id: visa.id, name: "Visa" }],
		});
		expect(JSON.stringify(checking)).not.toContain(FIXTURE_CHECKING_UID);
		expect(JSON.stringify(checking)).not.toContain("anonymised-hash");
	});

	it("suggests skipping a bank account of an unknown type", async () => {
		const connection = await connected(() =>
			HttpResponse.json({
				session_id: "s",
				accounts: [
					{
						uid: "u1",
						identification_hash: "h1",
						name: "Divers",
						currency: "EUR",
						cash_account_type: "OTHR",
					},
				],
				access: { valid_until: "2026-12-20T10:00:00Z" },
			}),
		);

		await expect(listBankAccounts(deps(), connection.id)).resolves.toMatchObject([
			{ name: "Divers", suggestion: null },
		]);
	});

	it("answers NOT_FOUND for an unknown or pending connection", async () => {
		mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		const [pending] = await rows();

		await expect(listBankAccounts(deps(), crypto.randomUUID())).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(listBankAccounts(deps(), pending?.id ?? "")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("linkBankAccounts", () => {
	const today = "2026-09-24";

	it("creates a checking account at the bank balance, opened two years back", async () => {
		const connection = await connected();
		const { checking } = await bankAccountsOf(connection.id);
		const requests = mockProvider();

		const list = await linkBankAccounts(deps(), connection.id, {
			links: [
				{ bankAccountId: checking.id, action: "create", type: "depository", subtype: "checking" },
			],
		});

		const row = list.find((item) => item.id === checking.id);
		expect(row?.account?.name).toBe("Compte courant");
		expect(row?.candidates).toEqual([]);
		const accountId = row?.account?.id ?? "";
		const created = await temp.db.select().from(accounts).where(eq(accounts.id, accountId)).get();
		expect(created).toMatchObject({
			name: "Compte courant",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			bankAccountId: checking.id,
		});
		await expect(valuations(accountId)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2024-09-24", amount: 123456 },
			{ kind: "current_anchor", date: today, amount: 123456 },
		]);
		await expect(balanceOn(deps(), accountId, today)).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
		expect(requests.map((request) => request.path)).toEqual([
			`/accounts/${FIXTURE_CHECKING_UID}/balances`,
		]);
		expect(logLines.join("")).not.toContain(FIXTURE_CHECKING_UID);
		expect(logLines.join("")).not.toContain("123456");
	});

	it("links a file-fed account, keeping its entries and ending on the bank balance", async () => {
		const connection = await connected();
		const { checking } = await bankAccountsOf(connection.id);
		const account = await openAccount();
		await ingest(
			{ db: temp.db, timeZone: "Europe/Paris" },
			account.id,
			{
				transactions: [
					{
						externalId: null,
						date: "2026-09-10",
						amount: toMinorUnits(-4290),
						currency: "EUR",
						label: "Boulangerie",
						reference: null,
						notes: null,
					},
				],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);
		const before = await entriesOf(account.id);
		mockProvider({ balances: balancesBy({ [FIXTURE_CHECKING_UID]: itbd("1000.00") }) });

		await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: checking.id, action: "link", accountId: account.id }],
		});

		await expect(entriesOf(account.id)).resolves.toEqual(expect.arrayContaining(before));
		await expect(balanceOn(deps(), account.id, today)).resolves.toMatchObject({ amount: 100000 });
		await expect(balanceOn(deps(), account.id, "2026-09-09")).resolves.toMatchObject({
			amount: 104290,
		});
	});

	it("dates the anchor on the day a closing balance describes", async () => {
		const connection = await connected();
		const { checking } = await bankAccountsOf(connection.id);
		mockProvider({
			balances: balancesBy({
				[FIXTURE_CHECKING_UID]: {
					balances: [
						{
							balance_amount: { amount: "1000.00", currency: "EUR" },
							balance_type: "CLBD",
							reference_date: "2026-09-23",
						},
					],
				},
			}),
		});

		const list = await linkBankAccounts(deps(), connection.id, {
			links: [
				{ bankAccountId: checking.id, action: "create", type: "depository", subtype: "checking" },
			],
		});

		const accountId = list.find((row) => row.id === checking.id)?.account?.id ?? "";
		await expect(valuations(accountId)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-23",
			amount: 100000,
		});
	});

	it("starts a relinked bank account's window afresh", async () => {
		const connection = await connected();
		const { checking } = await bankAccountsOf(connection.id);
		const create = { action: "create", type: "depository", subtype: "checking" } as const;
		mockProvider();
		await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: checking.id, ...create }],
		});
		// Synced once, then its account let go of it.
		await temp.db
			.update(bankAccounts)
			.set({ lastSyncedAt: NOW - DAY })
			.where(eq(bankAccounts.id, checking.id));
		await temp.db
			.update(accounts)
			.set({ bankAccountId: null })
			.where(eq(accounts.bankAccountId, checking.id));

		await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: checking.id, ...create }],
		});

		const row = await temp.db
			.select({ lastSyncedAt: bankAccounts.lastSyncedAt })
			.from(bankAccounts)
			.where(eq(bankAccounts.id, checking.id))
			.get();
		expect(row).toEqual({ lastSyncedAt: null });
	});

	it("creates a card owing the bank's balance, and leaves a skipped row linkable", async () => {
		const connection = await connected();
		const { checking, card } = await bankAccountsOf(connection.id);
		const joint = await openAccount();
		mockProvider({ balances: balancesBy({ [FIXTURE_CARD_UID]: itbd("-300.00") }) });

		const list = await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: card.id, action: "create", type: "credit_card", subtype: null }],
		});

		const cardAccount = list.find((row) => row.id === card.id)?.account?.id ?? "";
		await expect(valuations(cardAccount)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2024-09-24", amount: 30000 },
			{ kind: "current_anchor", date: today, amount: 30000 },
		]);
		await expect(balanceOn(deps(), cardAccount, today)).resolves.toMatchObject({ amount: 30000 });
		expect(list.find((row) => row.id === checking.id)).toMatchObject({
			account: null,
			candidates: [{ id: joint.id }],
		});
	});

	it("links without an anchor when the bank has no booked balance, or one in another currency", async () => {
		const connection = await connected();
		const { checking, card } = await bankAccountsOf(connection.id);
		const account = await openAccount();
		mockProvider({
			balances: balancesBy({
				[FIXTURE_CHECKING_UID]: {
					balances: [{ balance_amount: { amount: "5.00", currency: "EUR" }, balance_type: "XPCD" }],
				},
				[FIXTURE_CARD_UID]: {
					balances: [{ balance_amount: { amount: "5.00", currency: "USD" }, balance_type: "ITBD" }],
				},
			}),
		});

		const list = await linkBankAccounts(deps(), connection.id, {
			links: [
				{ bankAccountId: checking.id, action: "link", accountId: account.id },
				{ bankAccountId: card.id, action: "create", type: "credit_card", subtype: null },
			],
		});

		await expect(valuations(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		await expect(balanceOn(deps(), account.id, today)).resolves.toMatchObject({ amount: 123456 });
		const cardAccount = list.find((row) => row.id === card.id)?.account?.id ?? "";
		await expect(valuations(cardAccount)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2024-09-24", amount: 0 },
		]);
	});

	async function refused(input: Parameters<typeof linkBankAccounts>[2], connectionId: string) {
		const accountsBefore = await temp.db.select().from(accounts);
		const entriesBefore = await allEntries();
		const requests = mockProvider();

		const error: unknown = await linkBankAccounts(deps(), connectionId, input).catch(
			(reason: unknown) => reason,
		);

		await expect(temp.db.select().from(accounts)).resolves.toEqual(accountsBefore);
		await expect(allEntries()).resolves.toEqual(entriesBefore);
		expect(requests).toEqual([]);

		return error;
	}

	it("refuses an account in another currency and writes nothing", async () => {
		const connection = await connected();
		const { checking } = await bankAccountsOf(connection.id);
		const usd = await openAccount({ currency: "USD" });

		await expect(
			refused(
				{ links: [{ bankAccountId: checking.id, action: "link", accountId: usd.id }] },
				connection.id,
			),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			status: 400,
			fields: [{ path: "links.0.accountId", code: "invalid_value" }],
		});
	});

	it("refuses an account already fed by a bank, an unknown one, and one given twice", async () => {
		const connection = await connected();
		const { checking, card } = await bankAccountsOf(connection.id);
		const account = await openAccount();
		const visa = await openAccount({ type: "credit_card", subtype: null });
		await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: card.id, action: "link", accountId: visa.id }],
		});
		const other = await connected();
		const { checking: otherChecking } = await bankAccountsOf(other.id);

		await expect(
			refused(
				{ links: [{ bankAccountId: otherChecking.id, action: "link", accountId: visa.id }] },
				other.id,
			),
		).resolves.toMatchObject({ fields: [{ path: "links.0.accountId" }] });
		await expect(
			refused(
				{ links: [{ bankAccountId: checking.id, action: "link", accountId: "nope" }] },
				connection.id,
			),
		).resolves.toMatchObject({ fields: [{ path: "links.0.accountId" }] });
		await expect(
			refused(
				{
					links: [
						{ bankAccountId: checking.id, action: "link", accountId: account.id },
						{ bankAccountId: otherChecking.id, action: "link", accountId: account.id },
					],
				},
				connection.id,
			),
		).resolves.toMatchObject({
			fields: [{ path: "links.1.bankAccountId" }],
		});
	});

	it("refuses a bank account already linked, of another connection, or given twice", async () => {
		const connection = await connected();
		const { checking, card } = await bankAccountsOf(connection.id);
		const other = await connected();
		const { checking: otherChecking } = await bankAccountsOf(other.id);
		await linkBankAccounts(deps(), connection.id, {
			links: [{ bankAccountId: card.id, action: "create", type: "credit_card", subtype: null }],
		});
		const create = { action: "create", type: "depository", subtype: "checking" } as const;

		await expect(
			refused(
				{
					links: [
						{ bankAccountId: card.id, ...create },
						{ bankAccountId: otherChecking.id, ...create },
						{ bankAccountId: checking.id, ...create },
						{ bankAccountId: checking.id, ...create },
					],
				},
				connection.id,
			),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [
				{ path: "links.0.bankAccountId", code: "invalid_value" },
				{ path: "links.1.bankAccountId", code: "invalid_value" },
				{ path: "links.3.bankAccountId", code: "invalid_value" },
			],
		});
	});

	it("answers NOT_FOUND for an unknown connection", async () => {
		await expect(
			refused(
				{ links: [{ bankAccountId: "b1", action: "link", accountId: "a1" }] },
				crypto.randomUUID(),
			),
		).resolves.toMatchObject({ code: "NOT_FOUND" });
	});

	it("writes nothing when one balance cannot be read, and logs no uid", async () => {
		const connection = await connected();
		const { checking, card } = await bankAccountsOf(connection.id);
		const accountsBefore = await temp.db.select().from(accounts);
		mockProvider({
			balances: (url) =>
				url.pathname.includes(FIXTURE_CARD_UID)
					? HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 })
					: HttpResponse.json(fixtures.balances),
		});
		const service = deps();

		await expect(
			linkBankAccounts(service, connection.id, {
				links: [
					{ bankAccountId: checking.id, action: "create", type: "depository", subtype: "checking" },
					{ bankAccountId: card.id, action: "create", type: "credit_card", subtype: null },
				],
			}),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR", status: 502 });

		await expect(temp.db.select().from(accounts)).resolves.toEqual(accountsBefore);
		expect(logLines.join("")).toContain(`"connectionId":"${connection.id}"`);
		expect(logLines.join("")).toContain('"providerCode":"ASPSP_ERROR"');
		expect(logLines.join("")).not.toContain(FIXTURE_CARD_UID);
	});
});
