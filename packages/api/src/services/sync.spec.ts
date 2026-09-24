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
	mockProvider,
	transactionsPage,
} from "../testing/enable-banking.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { bankDepsFromEnv } from "./bank-connections.ts";
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

describe("windowStart", () => {
	it("reads three months back for an account never synced", () => {
		expect(windowStart(null, "2026-09-24", "Europe/Paris")).toBe("2026-06-26");
	});

	it("reads from seven days before the last sync, on its day in the app's zone", () => {
		// 23:30 UTC on the 20th is the 21st in Paris.
		expect(windowStart(Date.parse("2026-09-20T23:30:00Z"), "2026-09-24", "Europe/Paris")).toBe(
			"2026-09-14",
		);
	});
});

describe("syncConnection", () => {
	it("brings the bank's booked lines in once, and sets today's balance to the bank's", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			["?date_from=2026-06-26", "?date_from=2026-06-26&continuation_key=page-2"],
		);
		// Five booked lines; the pending and the informational ones stay out.
		await expect(transactionCount(accountId)).resolves.toBe(5);
		await expect(balanceOn(deps(), accountId, "2026-09-24")).resolves.toEqual({
			amount: 123456,
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
		await expect(transactionCount(accountId)).resolves.toBe(5);
		await expect(balanceOn(deps(), accountId, "2026-09-25")).resolves.toMatchObject({
			amount: 123456,
		});
	});

	it("commits the accounts that sync and rolls back the one that fails", async () => {
		failingOn(FIXTURE_CARD_UID);
		const connectionId = await newConnection({ lastSyncedAt: NOW - 2 * DAY });
		const good = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const bad = await linkedAccount(connectionId, FIXTURE_CARD_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW - 2 * DAY, lastError: "BANK_PROVIDER_ERROR" });
		await expect(transactionCount(good.accountId)).resolves.toBe(5);
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
		await expect(transactionCount(bad.accountId)).resolves.toBe(5);
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
		await expect(transactionCount(accountId)).resolves.toBe(5);
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

	it("reads nothing once the consent has ended, and answers the state unchanged", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ consentExpiresAt: NOW - 1 });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: null,
			lastError: null,
		});
		expect(requests).toEqual([]);
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
		await expect(transactionCount(accountId)).resolves.toBe(5);
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

		// Timestamps, the process and the duration are numbers any figure may hide in.
		const logged = logLines
			.map((line) => {
				const {
					time: _time,
					pid: _pid,
					hostname: _host,
					durationMs: _duration,
					...rest
				} = logLine.parse(JSON.parse(line));

				return JSON.stringify(rest);
			})
			.join("\n");
		expect(logged).toContain('"msg":"bank account synced"');
		expect(logged).toContain('"code":"BANK_PROVIDER_ERROR"');
		for (const secret of [
			"4290",
			"42.90",
			"250000",
			"123456",
			"1234.56",
			"Carrefour",
			FIXTURE_CHECKING_UID,
			FIXTURE_CARD_UID,
			FIXTURE_SESSION_ID,
		]) {
			expect(logged).not.toContain(secret);
		}
		expect(logged).not.toMatch(/FR\d{2}/u);
	});

	it("answers BANK_CONNECTOR_UNAVAILABLE while unconfigured", async () => {
		const connectionId = await newConnection();

		await expect(
			syncConnection({ ...deps(), bankConnector: null }, connectionId),
		).rejects.toMatchObject({ code: "BANK_CONNECTOR_UNAVAILABLE" });
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
			{ id: expired, result: "skipped" },
		]);
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
