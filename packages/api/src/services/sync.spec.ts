import type { TempDatabase } from "../testing/temp-database.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";

import { eq, sql } from "drizzle-orm";
import { HttpResponse } from "msw";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { validateEnv } from "../env.ts";
import { createLogger } from "../lib/logger.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PKCS8_BASE64,
} from "../testing/bank.ts";
import {
	FIXTURE_CARD_UID,
	FIXTURE_CHECKING_UID,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
	transactionsPage,
} from "../testing/enable-banking.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { bankDepsFromEnv, completeConnection, disconnectConnection } from "./bank-connections.ts";
import { encrypt } from "./crypto.ts";
import { balanceOn, createAccount, linkBankAccount } from "./ledger.ts";
import * as recurringService from "./recurring.ts";
import { syncAll, syncConnection, windowStart } from "./sync.ts";

const NOW = Date.parse("2026-09-24T10:00:00Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

const ENV = {
	DATABASE_URL: "file:x.db",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
	BETTER_AUTH_URL: "http://localhost:5173",
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
		...bankDepsFromEnv(validateEnv(ENV)),
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
	vi.restoreAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	// Accounts keep their history, which the ledger alone deletes: earlier
	// tests' ones are set aside rather than removed.
	await temp.db.update(accounts).set({ bankAccountId: null, active: false });
	await temp.db.delete(bankConnections);
});

async function newConnection(fields: Partial<typeof bankConnections.$inferInsert> = {}) {
	const id = randomUUID();

	await temp.db.insert(bankConnections).values({
		id,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		sessionId: encrypt(Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"), FIXTURE_SESSION_ID),
		consentExpiresAt: NOW + 60 * DAY,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...fields,
	});

	return id;
}

/** A bank account of `connectionId`, linked to a new account at 1 000,00. */
async function linkedAccount(connectionId: string, uid: string) {
	const bankAccountId = randomUUID();

	await temp.db.insert(bankAccounts).values({
		id: bankAccountId,
		bankConnectionId: connectionId,
		identificationHash: `hash-${bankAccountId}`,
		providerUid: uid,
		name: "Compte courant",
		currency: "EUR",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	const account = await createAccount(
		deps(),
		{
			name: "Compte courant",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2026-06-01",
		},
		{ origin: "sync" },
	);
	await linkBankAccount(
		deps(),
		account.id,
		{ bankAccountId, balance: { amount: toMinorUnits(100000), date: null } },
		{ origin: "sync" },
	);

	return { accountId: account.id, bankAccountId };
}

async function transactionCount(accountId: string) {
	const [row] = await temp.db.all<{ total: number }>(
		sql`select count(*) as total from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	return row?.total;
}

async function pendingOf(accountId: string) {
	return temp.db.all<{ date: string; amount: number; missed: number }>(
		sql`select e.date, e.amount, t.pending_missed_syncs as missed from entries e join transactions t on t.entry_id = e.id where e.account_id = ${accountId} and t.pending = 1 order by e.date`,
	);
}

/** The fixtures, with the first page's pending line left out. */
function withoutPending() {
	const page = z
		.object({ transactions: z.array(z.record(z.string(), z.unknown())) })
		.loose()
		.parse(fixtures.transactionsPage1);

	return mockProvider({
		transactions: (url) =>
			url.searchParams.get("continuation_key") === "page-2"
				? transactionsPage(url)
				: HttpResponse.json({
						...page,
						transactions: page.transactions.filter((line) => line["status"] !== "PDNG"),
					}),
	});
}

async function connectionRow(id: string) {
	return temp.db.select().from(bankConnections).where(eq(bankConnections.id, id)).get();
}

async function bankAccountSyncedAt(id: string) {
	const row = await temp.db
		.select({ lastSyncedAt: bankAccounts.lastSyncedAt })
		.from(bankAccounts)
		.where(eq(bankAccounts.id, id))
		.get();

	return row?.lastSyncedAt;
}

const transactionRequests = (requests: ReturnType<typeof mockProvider>, uid: string) =>
	requests.filter(({ path }) => path === `/accounts/${uid}/transactions`);

/** Enable Banking answering 500 on `uid`'s transactions, and the fixtures elsewhere. */
function failingOn(uid: string) {
	return mockProvider({
		transactions: (url) =>
			url.pathname.includes(uid)
				? HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 })
				: transactionsPage(url),
	});
}

/** Deps whose third `update` outside a transaction throws, as a full disk would. */
function failingThirdUpdate(): BankConnectionDeps {
	const base = deps();
	const { db } = base;
	let calls = 0;

	return {
		...base,
		db: {
			select: db.select.bind(db),
			selectDistinct: db.selectDistinct.bind(db),
			insert: db.insert.bind(db),
			delete: db.delete.bind(db),
			transaction: db.transaction.bind(db),
			update: (table) => {
				calls += 1;

				if (calls === 3) {
					throw new Error("disk full");
				}

				return db.update(table);
			},
		},
	};
}

const logLine = z.record(z.string(), z.unknown());

/** Every log line, without the timestamps, process and duration any figure may hide in. */
function logged(): Record<string, unknown>[] {
	return logLines.map((line) => {
		const {
			time: _time,
			pid: _pid,
			hostname: _host,
			durationMs: _duration,
			...rest
		} = logLine.parse(JSON.parse(line));

		return rest;
	});
}

/** The fixtures' amounts and names, which no log line may carry. */
const FIXTURE_SECRETS = ["4290", "42.90", "250000", "123456", "1234.56", "1200", "Carrefour"];

function expectNoSecretLogged() {
	const text = logged()
		.map((line) => JSON.stringify(line))
		.join("\n");

	for (const secret of [...FIXTURE_SECRETS, FIXTURE_CHECKING_UID, FIXTURE_CARD_UID]) {
		expect(text).not.toContain(secret);
	}
}

/** The account's current anchor: the bank balance it last recorded. */
async function anchorOf(accountId: string) {
	const [row] = await temp.db.all<{ date: string; amount: number }>(
		sql`select date, amount from entries where account_id = ${accountId} and valuation_kind = 'current_anchor'`,
	);

	return row;
}

const balancesFailing = () => HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 });

/** Enable Banking refusing every `date_from` before `accepted`, `null` refusing them all. */
function refusingBefore(accepted: string | null, page: (url: URL) => Response = transactionsPage) {
	return mockProvider({
		transactions: (url) =>
			accepted === null || (url.searchParams.get("date_from") ?? "") < accepted
				? HttpResponse.json({ error: "WRONG_TRANSACTIONS_PERIOD" }, { status: 400 })
				: page(url),
	});
}

/** The fixtures' first page, less its pending line when `withPending` is false. */
function firstPage(withPending: boolean) {
	const page = z
		.object({ transactions: z.array(z.record(z.string(), z.unknown())) })
		.loose()
		.parse(fixtures.transactionsPage1);

	return HttpResponse.json({
		...page,
		transactions: page.transactions.filter((line) => withPending || line["status"] !== "PDNG"),
	});
}

/** Page one as the fixtures, less the pending line unless asked, then a 500 on page two. */
function failingOnPageTwo(withPending = true) {
	return mockProvider({
		transactions: (url) =>
			url.searchParams.get("continuation_key") === "page-2"
				? HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 })
				: firstPage(withPending),
	});
}

const balanceRequests = (requests: ReturnType<typeof mockProvider>) =>
	requests.filter(({ path }) => path.endsWith("/balances"));

describe("windowStart", () => {
	it("reads three months back for an account never synced", () => {
		expect(windowStart(null, "2026-09-24", "Europe/Paris", null)).toBe("2026-06-26");
	});

	it("reads from seven days before the last sync, on its day in the app's zone", () => {
		// 23:30 UTC on the 20th is the 21st in Paris.
		expect(
			windowStart(Date.parse("2026-09-20T23:30:00Z"), "2026-09-24", "Europe/Paris", null),
		).toBe("2026-09-14");
	});

	it("starts no later than the oldest pending entry, so its absence means something", () => {
		const yesterday = Date.parse("2026-09-23T10:00:00Z");

		expect(windowStart(yesterday, "2026-09-24", "Europe/Paris", "2026-09-04")).toBe("2026-09-04");
		expect(windowStart(yesterday, "2026-09-24", "Europe/Paris", "2026-09-20")).toBe("2026-09-16");
		expect(windowStart(null, "2026-09-24", "Europe/Paris", "2026-06-01")).toBe("2026-06-01");
	});
});

describe("syncConnection", () => {
	it("brings the bank's lines in once, and sets today's balance to the bank's with the pending line", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			["?date_from=2026-06-26", "?date_from=2026-06-26&continuation_key=page-2"],
		);
		// Five booked lines and the pending one; the informational one stays out.
		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
		// The bank's booked 1 234,56, less the pending 12,00 it leaves out.
		await expect(balanceOn(deps(), accountId, "2026-09-24")).resolves.toEqual({
			amount: 122256,
			currency: "EUR",
		});
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
		await expect(
			temp.db.all(
				sql`select distinct source, connection_id as connectionId, import_id as importId from entry_keys where account_id = ${accountId}`,
			),
		).resolves.toEqual([{ source: "enable-banking", connectionId, importId: null }]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncStartedAt: null });
	});

	it("creates nothing a day later, reading from seven days before the last sync", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		vi.setSystemTime(NOW + DAY);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW + DAY, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).at(-2)?.search).toBe(
			"?date_from=2026-09-17",
		);
		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(balanceOn(deps(), accountId, "2026-09-25")).resolves.toMatchObject({
			amount: 122256,
		});
	});

	it("commits the accounts that sync and rolls back the one that fails", async () => {
		failingOn(FIXTURE_CARD_UID);
		const connectionId = await newConnection({ lastSyncedAt: NOW - 2 * DAY });
		const good = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const bad = await linkedAccount(connectionId, FIXTURE_CARD_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW - 2 * DAY, lastError: "BANK_PROVIDER_ERROR" });
		await expect(transactionCount(good.accountId)).resolves.toBe(6);
		await expect(transactionCount(bad.accountId)).resolves.toBe(0);
		await expect(bankAccountSyncedAt(good.bankAccountId)).resolves.toBe(NOW);
		await expect(bankAccountSyncedAt(bad.bankAccountId)).resolves.toBeNull();
		await expect(balanceOn(deps(), bad.accountId, "2026-09-24")).resolves.toMatchObject({
			amount: 100000,
		});
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncStartedAt: null });
	});

	it("keeps each bank account's own window, and clears the error once every account syncs", async () => {
		failingOn(FIXTURE_CARD_UID);
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const bad = await linkedAccount(connectionId, FIXTURE_CARD_UID);
		await syncConnection(deps(), connectionId);
		vi.setSystemTime(NOW + DAY);
		const requests = mockProvider();

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW + DAY, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID)[0]?.search).toBe(
			"?date_from=2026-09-17",
		);
		// The failed account starts from three months back, not from the others' sync.
		expect(transactionRequests(requests, FIXTURE_CARD_UID)[0]?.search).toBe(
			"?date_from=2026-06-27",
		);
		await expect(transactionCount(bad.accountId)).resolves.toBe(6);
	});

	it("reads from the oldest pending entry when it is older than the overlap", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		await temp.db.run(
			sql`update entries set date = '2026-09-04' where account_id = ${accountId} and id in (select entry_id from transactions where pending = 1)`,
		);
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).at(-2)?.search).toBe(
			"?date_from=2026-09-04",
		);
	});

	it("deletes a pending entry missing from two successful syncs in a row", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		withoutPending();
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 1 },
		]);
		vi.setSystemTime(NOW + 2 * DAY);

		await syncConnection(deps(), connectionId);

		await expect(pendingOf(accountId)).resolves.toEqual([]);
		await expect(transactionCount(accountId)).resolves.toBe(5);
		await expect(balanceOn(deps(), accountId, "2026-09-26")).resolves.toMatchObject({
			amount: 123456,
		});
	});

	it("counts one miss for two syncs an hour apart without the pending line", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		withoutPending();
		vi.setSystemTime(NOW + DAY);
		await syncConnection(deps(), connectionId);
		// Just over an hour on: the spacing between syncs refuses anything sooner.
		vi.setSystemTime(NOW + DAY + 61 * MINUTE);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastError: null,
		});

		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 1 },
		]);
	});

	it("keeps one entry for a pending line listed beside its booked version", async () => {
		const page = z
			.object({ transactions: z.array(z.record(z.string(), z.unknown())) })
			.loose()
			.parse(fixtures.transactionsPage1);
		const [groceries] = page.transactions;
		mockProvider({
			transactions: (url) =>
				url.searchParams.get("continuation_key") === "page-2"
					? transactionsPage(url)
					: HttpResponse.json({
							...page,
							transactions: [
								...page.transactions,
								{
									...groceries,
									transaction_id: null,
									status: "PDNG",
									booking_date: null,
									value_date: null,
									transaction_date: "2026-09-21",
								},
							],
						}),
		});
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await syncConnection(deps(), connectionId);

		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
		await expect(balanceOn(deps(), accountId, "2026-09-24")).resolves.toEqual({
			amount: 122256,
			currency: "EUR",
		});
	});

	it("starts the count over when the pending line comes back", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		withoutPending();
		vi.setSystemTime(NOW + DAY);
		await syncConnection(deps(), connectionId);
		mockProvider();
		vi.setSystemTime(NOW + 2 * DAY);

		await syncConnection(deps(), connectionId);

		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
	});

	it("never counts a failed sync as a miss", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		withoutPending();
		vi.setSystemTime(NOW + DAY);
		await syncConnection(deps(), connectionId);
		failingOn(FIXTURE_CHECKING_UID);
		vi.setSystemTime(NOW + 2 * DAY);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastError: "BANK_PROVIDER_ERROR",
		});
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 1 },
		]);
	});

	it("refuses while another sync holds the lease, and reads nothing", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ syncStartedAt: NOW - 2 * MINUTE });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "SYNC_IN_PROGRESS",
		});
		expect(requests.filter(({ path }) => path.startsWith("/accounts/"))).toEqual([]);
		// The lease stays with its holder.
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: NOW - 2 * MINUTE,
		});
	});

	it("takes over a lease older than ten minutes", async () => {
		mockProvider();
		const connectionId = await newConnection({ syncStartedAt: NOW - 11 * MINUTE });
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastSyncedAt: NOW,
		});
		await expect(transactionCount(accountId)).resolves.toBe(6);
	});

	it("refuses a connection synced less than an hour ago", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ lastSyncedAt: NOW - 30 * MINUTE });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "SYNC_TOO_RECENT",
		});
		expect(requests).toEqual([]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncStartedAt: null });
	});

	it("answers CONSENT_EXPIRED once the consent has ended, reading and writing nothing", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({
			consentExpiresAt: NOW - 1,
			lastSyncedAt: NOW - 5 * DAY,
		});
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const before = await connectionRow(connectionId);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "CONSENT_EXPIRED",
			status: 409,
		});
		expect(requests).toEqual([]);
		await expect(connectionRow(connectionId)).resolves.toEqual(before);
		await expect(transactionCount(accountId)).resolves.toBe(0);
	});

	it("syncs within the hour once after a renewal, then keeps the hour again", async () => {
		mockProvider();
		const connectionId = await newConnection({
			lastSyncedAt: NOW - 10 * MINUTE,
			authorizedAt: NOW - 2 * MINUTE,
		});
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastSyncedAt: NOW,
			lastError: null,
		});

		vi.setSystemTime(NOW + MINUTE);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "SYNC_TOO_RECENT",
		});
	});

	it("spends the renewal's exception on a failed sync, then keeps the hour again", async () => {
		failingOn(FIXTURE_CHECKING_UID);
		const connectionId = await newConnection({
			lastSyncedAt: NOW - 10 * MINUTE,
			authorizedAt: NOW - 2 * MINUTE,
		});
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastSyncedAt: NOW - 10 * MINUTE,
			lastError: "BANK_PROVIDER_ERROR",
		});
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ authorizedAt: null });

		vi.setSystemTime(NOW + MINUTE);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "SYNC_TOO_RECENT",
		});
	});

	it("after a renewal that drops the card, syncs the rest and never asks for the card's uid", async () => {
		const connectionId = await newConnection({
			lastSyncedAt: NOW - 2 * 60 * MINUTE,
			authorizationState: "renewal-state",
			authorizationStartedAt: NOW - MINUTE,
		});
		const checking = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const card = await linkedAccount(connectionId, FIXTURE_CARD_UID);
		// The new consent shares the current account alone, under the same uid.
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					session_id: "renewed-session",
					access: { valid_until: "2026-12-20T10:00:00Z" },
					accounts: [
						{
							uid: FIXTURE_CHECKING_UID,
							identification_hash: `hash-${checking.bankAccountId}`,
							currency: "EUR",
							product: "Compte courant",
						},
					],
				}),
		});
		await completeConnection(deps(), { code: "new-code", state: "renewal-state" });
		const requests = mockProvider();

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});

		expect(requests.filter(({ path }) => path.includes(FIXTURE_CARD_UID))).toEqual([]);
		await expect(transactionCount(checking.accountId)).resolves.toBe(6);
		await expect(bankAccountSyncedAt(card.bankAccountId)).resolves.toBeNull();
		const [row] = await temp.db
			.select({ bankAccountId: accounts.bankAccountId })
			.from(accounts)
			.where(eq(accounts.id, card.accountId));
		expect(row).toEqual({ bankAccountId: card.bankAccountId });
	});

	it("answers NOT_FOUND for a connection that is not active, or unknown", async () => {
		const pending = await newConnection({ status: "pending" });

		await expect(syncConnection(deps(), pending)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(syncConnection(deps(), randomUUID())).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("leaves out a bank account whose account is inactive, or that feeds none", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, accountId));
		await temp.db.insert(bankAccounts).values({
			id: randomUUID(),
			bankConnectionId: connectionId,
			identificationHash: "hash-unlinked",
			providerUid: FIXTURE_CARD_UID,
			name: "Carte",
			currency: "EUR",
			createdAt: NOW,
			updatedAt: NOW,
		});

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: null,
			lastError: null,
		});
		expect(requests).toEqual([]);
	});

	it("releases the lease when the run throws", async () => {
		mockProvider();
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		// The lease, then the bank account's window, then the connection's
		// state: that third write fails.
		const failing = failingThirdUpdate();

		await expect(syncConnection(failing, connectionId)).rejects.toThrow("disk full");
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncStartedAt: null });
	});

	it("leaves a lease another run took over to that run", async () => {
		mockProvider();
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const syncDeps = deps();
		const takenOver = NOW + 11 * MINUTE;
		// While this run reads the bank, its lease expires and another run takes it.
		vi.spyOn(recurringService, "detectRecurring").mockImplementation(async () => {
			await temp.db
				.update(bankConnections)
				.set({ syncStartedAt: takenOver })
				.where(eq(bankConnections.id, connectionId));

			return { detected: 0 };
		});

		await syncConnection(syncDeps, connectionId);

		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: takenOver,
		});
	});

	it("leaves a connection with nothing linked unsynced, so its first link syncs at once", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();

		await expect(syncAll(deps())).resolves.toEqual([{ id: connectionId, result: "synced" }]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			lastSyncedAt: null,
			lastError: null,
		});

		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});
		await expect(transactionCount(accountId)).resolves.toBe(6);
		expect(requests.length).toBeGreaterThan(0);
	});

	it("keeps the sync when recurring detection fails, and logs its code only", async () => {
		mockProvider();
		vi.spyOn(recurringService, "detectRecurring").mockRejectedValue(
			new Error("amount 4290 refused"),
		);
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const syncDeps = deps();

		await expect(syncConnection(syncDeps, connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});
		const failure = logLines
			.map((line) => logLine.parse(JSON.parse(line)))
			.find((line) => line["msg"] === "recurring detection failed");
		expect(failure).toMatchObject({ connectionId, code: "INTERNAL_ERROR" });
		expect(logLines.join("")).not.toContain("4290");
	});

	it("logs ids, counts, durations and codes, never an amount, an IBAN, a uid or the session", async () => {
		failingOn(FIXTURE_CARD_UID);
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await linkedAccount(connectionId, FIXTURE_CARD_UID);
		const syncDeps = deps();

		await syncConnection(syncDeps, connectionId);

		const text = logged()
			.map((line) => JSON.stringify(line))
			.join("\n");
		expect(text).toContain('"msg":"bank account synced"');
		expect(text).toContain('"code":"BANK_PROVIDER_ERROR"');
		expectNoSecretLogged();
		expect(text).not.toContain(FIXTURE_SESSION_ID);
		expect(text).not.toMatch(/FR\d{2}/u);
	});

	it("answers BANK_CONNECTOR_UNAVAILABLE while unconfigured", async () => {
		const connectionId = await newConnection();

		await expect(
			syncConnection({ ...deps(), bankConnector: null }, connectionId),
		).rejects.toMatchObject({ code: "BANK_CONNECTOR_UNAVAILABLE" });
	});
});

describe("a bank read that fails part way", () => {
	it("syncs the lines of an account whose balance fails, keeping its previous balance", async () => {
		const requests = mockProvider({ balances: balancesFailing });
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const anchor = await anchorOf(accountId);

		await expect(syncAll(deps())).resolves.toEqual([{ id: connectionId, result: "synced" }]);

		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(anchorOf(accountId)).resolves.toEqual(anchor);
		expect(anchor).toMatchObject({ amount: 100000 });
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			lastSyncedAt: NOW,
			lastError: "BANK_BALANCE_UNAVAILABLE",
		});
		expect(balanceRequests(requests)).toHaveLength(1);
		expect(logged()).toContainEqual(
			expect.objectContaining({
				msg: "bank account balance unavailable",
				accountId,
				code: "BANK_PROVIDER_ERROR",
			}),
		);
		expectNoSecretLogged();
	});

	it("clears the balance's error once a sync reads it", async () => {
		mockProvider({ balances: balancesFailing });
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		mockProvider();
		vi.setSystemTime(NOW + DAY);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW + DAY,
			lastError: null,
		});
		await expect(anchorOf(accountId)).resolves.toMatchObject({ amount: 123456 });
	});

	it("fails the account on a balance error that is not the bank's answer", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const syncDeps = deps();
		const connector = syncDeps.bankConnector;

		if (connector === null) {
			throw new Error("The test deps have no bank connector.");
		}

		vi.spyOn(connector, "fetchBalance").mockRejectedValue(new Error("amount 123456 refused"));

		await expect(syncConnection(syncDeps, connectionId)).resolves.toEqual({
			lastSyncedAt: null,
			lastError: "INTERNAL_ERROR",
		});
		await expect(transactionCount(accountId)).resolves.toBe(0);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBeNull();
		expectNoSecretLogged();
	});

	it("names another account's failure before a missing balance", async () => {
		mockProvider({
			balances: (url) =>
				url.pathname.includes(FIXTURE_CHECKING_UID)
					? balancesFailing()
					: HttpResponse.json(fixtures.balances),
			transactions: (url) =>
				url.pathname.includes(FIXTURE_CARD_UID)
					? HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 })
					: transactionsPage(url),
		});
		const connectionId = await newConnection({ lastSyncedAt: NOW - 2 * DAY });
		const good = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const bad = await linkedAccount(connectionId, FIXTURE_CARD_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW - 2 * DAY,
			lastError: "BANK_PROVIDER_ERROR",
		});
		await expect(transactionCount(good.accountId)).resolves.toBe(6);
		await expect(anchorOf(good.accountId)).resolves.toMatchObject({ amount: 100000 });
		await expect(bankAccountSyncedAt(good.bankAccountId)).resolves.toBe(NOW);
		await expect(transactionCount(bad.accountId)).resolves.toBe(0);
		await expect(bankAccountSyncedAt(bad.bankAccountId)).resolves.toBeNull();
	});

	it("reads 89 days back when the bank refuses the first window", async () => {
		const requests = refusingBefore("2026-06-27");
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			[
				"?date_from=2026-06-26",
				"?date_from=2026-06-27",
				"?date_from=2026-06-27&continuation_key=page-2",
			],
		);
		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
		expect(logged()).toContainEqual(
			expect.objectContaining({ msg: "bank account window shortened", accountId, windowDays: 89 }),
		);
	});

	it("fails the account when the bank refuses 89, 60 and 30 days too", async () => {
		const requests = refusingBefore(null);
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: null,
			lastError: "BANK_PROVIDER_ERROR",
		});
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID)).toHaveLength(4);
		await expect(transactionCount(accountId)).resolves.toBe(0);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBeNull();
	});

	it("asks for no other window when a short one is refused", async () => {
		const requests = refusingBefore(null);
		const connectionId = await newConnection({ lastSyncedAt: NOW - 2 * DAY });
		const { bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await temp.db
			.update(bankAccounts)
			.set({ lastSyncedAt: NOW - 2 * DAY })
			.where(eq(bankAccounts.id, bankAccountId));

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastError: "BANK_PROVIDER_ERROR",
		});
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			["?date_from=2026-09-15"],
		);
	});

	it("counts no miss on a pending entry older than the window the bank accepted", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		// Eighty days before the next sync's day, the 25th.
		await temp.db.run(
			sql`update entries set date = '2026-07-07' where account_id = ${accountId} and id in (select entry_id from transactions where pending = 1)`,
		);
		vi.setSystemTime(NOW + DAY);
		const requests = refusingBefore("2026-07-27", (url) =>
			url.searchParams.get("continuation_key") === "page-2"
				? transactionsPage(url)
				: firstPage(false),
		);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW + DAY,
			lastError: null,
		});
		// The 89-day window starts before the refused one: never asked.
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			[
				"?date_from=2026-07-07",
				"?date_from=2026-07-27",
				"?date_from=2026-07-27&continuation_key=page-2",
			],
		);
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-07-07", amount: -1200, missed: 0 },
		]);
		expect(logged()).toContainEqual(
			expect.objectContaining({ msg: "bank account window shortened", windowDays: 60 }),
		);
	});

	it("keeps the lines of the pages read before a failure, reads no balance and leaves the account failed", async () => {
		const requests = failingOnPageTwo();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncAll(deps())).resolves.toEqual([{ id: connectionId, result: "failed" }]);

		// Page one: three booked lines and the pending one.
		await expect(transactionCount(accountId)).resolves.toBe(4);
		await expect(anchorOf(accountId)).resolves.toMatchObject({ amount: 100000 });
		expect(balanceRequests(requests)).toEqual([]);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBeNull();
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			lastSyncedAt: null,
			lastError: "BANK_PROVIDER_ERROR",
		});
		expect(logged()).toContainEqual(
			expect.objectContaining({
				msg: "bank account read interrupted",
				accountId,
				code: "BANK_PROVIDER_ERROR",
				lines: 4,
			}),
		);
		expectNoSecretLogged();

		// The next read starts from the same day, and recognises what page one wrote.
		const again = mockProvider();
		vi.setSystemTime(NOW + 2 * 60 * MINUTE);

		await expect(syncConnection(deps(), connectionId)).resolves.toMatchObject({
			lastError: null,
		});
		expect(transactionRequests(again, FIXTURE_CHECKING_UID)[0]?.search).toBe(
			"?date_from=2026-06-26",
		);
		await expect(transactionCount(accountId)).resolves.toBe(6);
	});

	it("counts no miss on a read that stopped part way, and keeps the account's window", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		failingOnPageTwo(false);
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ lastSyncedAt: NOW });
	});
});

describe("a bank connected again", () => {
	it("recognises every line synced before the disconnection, duplicating none", async () => {
		mockProvider();
		const first = await newConnection();
		const { accountId } = await linkedAccount(first, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), first);
		await expect(transactionCount(accountId)).resolves.toBe(6);
		await disconnectConnection(deps(), first);
		const second = await newConnection();
		const bankAccountId = randomUUID();
		await temp.db.insert(bankAccounts).values({
			id: bankAccountId,
			bankConnectionId: second,
			identificationHash: `hash-${bankAccountId}`,
			providerUid: FIXTURE_CHECKING_UID,
			name: "Compte courant",
			currency: "EUR",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await linkBankAccount(
			deps(),
			accountId,
			{ bankAccountId, balance: { amount: toMinorUnits(100000), date: null } },
			{ origin: "sync" },
		);

		await expect(syncConnection(deps(), second)).resolves.toMatchObject({ lastError: null });

		await expect(transactionCount(accountId)).resolves.toBe(6);
	});
});

describe("syncAll", () => {
	it("syncs every active connection, skipping what the button would refuse", async () => {
		failingOn(FIXTURE_CARD_UID);
		const synced = await newConnection({ createdAt: NOW - 5 });
		await linkedAccount(synced, FIXTURE_CHECKING_UID);
		const failed = await newConnection({ createdAt: NOW - 4 });
		await linkedAccount(failed, FIXTURE_CARD_UID);
		const leased = await newConnection({ createdAt: NOW - 3, syncStartedAt: NOW - 2 * MINUTE });
		const recent = await newConnection({ createdAt: NOW - 2, lastSyncedAt: NOW - 30 * MINUTE });
		const expired = await newConnection({ createdAt: NOW - 1, consentExpiresAt: NOW });
		await newConnection({ status: "pending" });

		await expect(syncAll(deps())).resolves.toEqual([
			{ id: synced, result: "synced" },
			{ id: failed, result: "failed" },
			{ id: leased, result: "skipped" },
			{ id: recent, result: "skipped" },
			{ id: expired, result: "consent_expired" },
		]);
		await expect(connectionRow(expired)).resolves.toMatchObject({
			lastSyncedAt: null,
			lastError: null,
			syncStartedAt: null,
		});
		await expect(connectionRow(failed)).resolves.toMatchObject({
			lastSyncedAt: null,
			lastError: "BANK_PROVIDER_ERROR",
		});
	});

	it("goes on with the next connection when one throws", async () => {
		mockProvider();
		const first = await newConnection({ createdAt: NOW - 2 });
		await linkedAccount(first, FIXTURE_CHECKING_UID);
		const second = await newConnection({ createdAt: NOW - 1 });
		await linkedAccount(second, FIXTURE_CARD_UID);
		const failing = failingThirdUpdate();

		await expect(syncAll(failing)).resolves.toEqual([
			{ id: first, result: "failed" },
			{ id: second, result: "synced" },
		]);
	});

	it("answers BANK_CONNECTOR_UNAVAILABLE while unconfigured", async () => {
		await expect(syncAll({ ...deps(), bankConnector: null })).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
		});
	});
});
