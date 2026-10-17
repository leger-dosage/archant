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
import { merchants } from "@archant/data/schema/merchants";

import * as registry from "../connectors/registry.ts";
import { addDays } from "../domain/dates.ts";
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
	FIXTURE_CONSENT_END,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
	transactionsPage,
} from "../testing/enable-banking.ts";
import { loggedFigures } from "../testing/logs.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { updateAccount } from "./accounts.ts";
import { bankDepsFromEnv, completeConnection, disconnectConnection } from "./bank-connections.ts";
import { encrypt } from "./crypto.ts";
import { createAccount } from "./ledger/accounts.ts";
import { balanceOn } from "./ledger/balances.ts";
import { linkBankAccount } from "./ledger/bank-link.ts";
import { deleteTransaction } from "./ledger/edits.ts";
import * as recurringService from "./recurring/pipeline.ts";
import { getNetWorth } from "./reports.ts";
import {
	startConnectionSync,
	startDailySync,
	syncAll,
	syncConnection,
	windowStart,
} from "./sync.ts";

// A spy that builds the real connector, so one test can make a single call
// throw something no provider answer produces.
vi.mock("../connectors/registry.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof registry>();

	return { ...actual, createBankConnector: vi.fn(actual.createBankConnector) };
});

const NOW = Date.parse("2026-09-24T10:00:00Z");
const anyId: unknown = expect.any(String);
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
		// As the provider's session holds it, so reading it writes nothing.
		consentExpiresAt: FIXTURE_CONSENT_END,
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
		{ bankAccountId, balance: toMinorUnits(100000) },
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

/** Every log line, without pino's envelope and the duration, which change from run to run. */
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
	const figures = loggedFigures(logLines);

	for (const secret of FIXTURE_SECRETS) {
		expect(figures).not.toContain(secret);
	}

	// A uid is a UUID, which `loggedFigures` masks: searched in the lines themselves.
	const text = logLines.join("\n");

	for (const uid of [FIXTURE_CHECKING_UID, FIXTURE_CARD_UID]) {
		expect(text).not.toContain(uid);
	}
}

/** The account's current anchor: the bank balance it last recorded. */
async function anchorOf(accountId: string) {
	const [row] = await temp.db.all<{ date: string; amount: number }>(
		sql`select date, amount from entries where account_id = ${accountId} and valuation_kind = 'current_anchor'`,
	);

	return row;
}

/** The fixtures' balances, the booked one the ledger takes set to `amount`. */
function bankBalancesWith(amount: string) {
	const { balances } = z
		.object({ balances: z.array(z.record(z.string(), z.unknown())) })
		.parse(fixtures.balances);

	return {
		balances: balances.map((row) =>
			row["balance_type"] === "CLBD"
				? { ...row, balance_amount: { currency: "EUR", amount } }
				: row,
		),
	};
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

/**
 * Page one as the fixtures, less the pending line unless asked, then page
 * two answering `status` with `code`, a 500 by default.
 */
function failingOnPageTwo(withPending = true, status = 500, code = "ASPSP_ERROR") {
	return mockProvider({
		transactions: (url) =>
			url.searchParams.get("continuation_key") === "page-2"
				? HttpResponse.json({ error: code }, { status })
				: firstPage(withPending),
	});
}

const balanceRequests = (requests: ReturnType<typeof mockProvider>) =>
	requests.filter(({ path }) => path.endsWith("/balances"));

describe("windowStart", () => {
	it("reads three months back for an account never synced", () => {
		expect(windowStart(null, "2026-09-24", "Europe/Paris", null, null)).toBe("2026-06-24");
		// Rails' `3.months.ago` on the 31st of May: the last day of February.
		expect(windowStart(null, "2026-05-31", "Europe/Paris", null, null)).toBe("2026-02-28");
	});

	it("reads from seven days before the last sync, on its day in the app's zone", () => {
		// 23:30 UTC on the 20th is the 21st in Paris.
		expect(
			windowStart(Date.parse("2026-09-20T23:30:00Z"), "2026-09-24", "Europe/Paris", null, null),
		).toBe("2026-09-14");
	});

	it("starts no later than the oldest pending entry, so its absence means something", () => {
		const yesterday = Date.parse("2026-09-23T10:00:00Z");

		expect(windowStart(yesterday, "2026-09-24", "Europe/Paris", "2026-09-04", null)).toBe(
			"2026-09-04",
		);
		expect(windowStart(yesterday, "2026-09-24", "Europe/Paris", "2026-09-20", null)).toBe(
			"2026-09-16",
		);
		expect(windowStart(null, "2026-09-24", "Europe/Paris", "2026-06-01", null)).toBe("2026-06-01");
	});

	it("reads from the connection's start date for an account never synced", () => {
		expect(windowStart(null, "2026-09-24", "Europe/Paris", null, "2025-01-15")).toBe("2025-01-15");
		expect(windowStart(null, "2026-09-24", "Europe/Paris", "2024-12-01", "2025-01-15")).toBe(
			"2024-12-01",
		);
	});

	it("keeps a synced account's window whatever the start date", () => {
		expect(
			windowStart(
				Date.parse("2026-09-23T10:00:00Z"),
				"2026-09-24",
				"Europe/Paris",
				null,
				"2025-01-15",
			),
		).toBe("2026-09-16");
	});
});

/** A booked debit of 4,50 on 20 September, `fields` on top. */
const bankLine = (reference: string, fields: Record<string, unknown>) => ({
	entry_reference: reference,
	transaction_amount: { amount: "4.50", currency: "EUR" },
	credit_debit_indicator: "DBIT",
	status: "BOOK",
	booking_date: "2026-09-20",
	...fields,
});

describe("syncConnection", () => {
	it("brings the bank's lines in once, and sets today's balance to the bank's booked one", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			["?date_from=2026-06-24", "?date_from=2026-06-24&continuation_key=page-2"],
		);
		// Five booked lines and the pending one; the informational one stays out.
		await expect(transactionCount(accountId)).resolves.toBe(6);
		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
		// The bank's booked 1 234,56: the pending 12,00 counts in no balance.
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

	it("names lines from the household's merchants, and creates each counterparty's, as Sure", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const netflix = randomUUID();
		await temp.db
			.insert(merchants)
			.values({ id: netflix, name: "Netflix", createdAt: 0, updatedAt: 0 });

		await syncConnection(deps(), connectionId);

		await expect(
			temp.db.all(
				sql`select t.label, m.name as merchant, t.merchant_id as merchantId, t.locked_fields as locks from entries e join transactions t on t.entry_id = e.id left join merchants m on m.id = t.merchant_id where e.account_id = ${accountId} order by e.date, t.label`,
			),
		).resolves.toEqual([
			{
				label: "Employeur Test",
				merchant: "Employeur Test",
				merchantId: anyId,
				locks: "{}",
			},
			{ label: "Prélèvement", merchant: null, merchantId: null, locks: "{}" },
			{
				label: "Carrefour Market",
				merchant: "Carrefour Market",
				merchantId: anyId,
				locks: "{}",
			},
			{ label: "Netflix", merchant: "Netflix", merchantId: netflix, locks: "{}" },
			{ label: "Virement entrant", merchant: null, merchantId: null, locks: "{}" },
			{
				label: "Boulangerie Test",
				merchant: "Boulangerie Test",
				merchantId: anyId,
				locks: "{}",
			},
		]);
	});

	it("names a later account's line from a merchant an earlier account's sync created", async () => {
		const shop = `Glacier ${randomUUID()}`;
		mockProvider({
			transactions: (url) =>
				HttpResponse.json({
					transactions: [
						url.pathname.includes(FIXTURE_CHECKING_UID)
							? bankLine("glace-1", { creditor: { name: shop }, remittance_information: ["CB"] })
							: bankLine("glace-2", {
									remittance_information: [`CB ${shop.toUpperCase()} 19/09`],
								}),
					],
					continuation_key: null,
				}),
		});
		const connectionId = await newConnection();
		const checking = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		const card = await linkedAccount(connectionId, FIXTURE_CARD_UID);
		// The card is read second.
		await temp.db
			.update(bankAccounts)
			.set({ createdAt: NOW + 1 })
			.where(eq(bankAccounts.id, card.bankAccountId));

		await syncConnection(deps(), connectionId);

		const rows = async (accountId: string) =>
			temp.db.all(
				sql`select t.label, t.merchant_id as merchantId from entries e join transactions t on t.entry_id = e.id where e.account_id = ${accountId}`,
			);
		const [created] = await temp.db
			.select({ id: merchants.id })
			.from(merchants)
			.where(eq(merchants.name, shop));
		await expect(rows(checking.accountId)).resolves.toEqual([
			{ label: shop, merchantId: created?.id },
		]);
		await expect(rows(card.accountId)).resolves.toEqual([{ label: shop, merchantId: created?.id }]);
	});

	it("dates the bank's balance today, whatever day it describes, as Sure", async () => {
		mockProvider({
			balances: () =>
				HttpResponse.json({
					balances: [
						{
							balance_amount: { currency: "EUR", amount: "1234.56" },
							balance_type: "CLBD",
							reference_date: "2026-09-22",
						},
					],
				}),
		});
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await syncConnection(deps(), connectionId);

		await expect(anchorOf(accountId)).resolves.toEqual({ date: "2026-09-24", amount: 123456 });
	});

	it("reads an account's first statement from the connection's start date", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ syncStartDate: "2025-01-15" });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await syncConnection(deps(), connectionId);

		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).map(({ search }) => search)).toEqual(
			["?date_from=2025-01-15", "?date_from=2025-01-15&continuation_key=page-2"],
		);
	});

	it("keeps a synced account's window when the start date moves", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ syncStartDate: "2026-06-01" });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		await temp.db
			.update(bankConnections)
			.set({ syncStartDate: "2025-01-15" })
			.where(eq(bankConnections.id, connectionId));
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).at(-2)?.search).toBe(
			"?date_from=2026-09-17",
		);
	});

	it("reads an account linked later from the stored start date, the synced one from its last sync", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ syncStartDate: "2025-01-15" });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		vi.setSystemTime(NOW + 7 * DAY);
		await linkedAccount(connectionId, FIXTURE_CARD_UID);

		await syncConnection(deps(), connectionId);

		expect(transactionRequests(requests, FIXTURE_CHECKING_UID).at(-2)?.search).toBe(
			"?date_from=2026-09-17",
		);
		expect(transactionRequests(requests, FIXTURE_CARD_UID)[0]?.search).toBe(
			"?date_from=2025-01-15",
		);
	});

	it("keeps what a bank returns when it holds less history than asked, without an error", async () => {
		// Asked two years back, the bank answers with its recent lines only, as
		// PSD2 lets it.
		const requests = mockProvider();
		const connectionId = await newConnection({ syncStartDate: "2024-09-24" });
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		const status = await syncConnection(deps(), connectionId);

		expect(status).toEqual({ lastSyncedAt: NOW, lastError: null });
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID)[0]?.search).toBe(
			"?date_from=2024-09-24",
		);
		await expect(transactionCount(accountId)).resolves.toBe(6);
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
			amount: 123456,
		});
	});

	it("keeps the first day's bank balance as a snapshot when the next day brings another", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		const before = await getNetWorth(deps(), "6M");
		vi.setSystemTime(NOW + DAY);
		mockProvider({ balances: () => HttpResponse.json(bankBalancesWith("1200.00")) });

		await syncConnection(deps(), connectionId);

		await expect(anchorOf(accountId)).resolves.toEqual({ date: "2026-09-25", amount: 120000 });
		await expect(
			temp.db.all(
				sql`select date, amount from entries where account_id = ${accountId} and valuation_kind = 'reconciliation'`,
			),
		).resolves.toEqual([{ date: "2026-09-24", amount: 123456 }]);
		await expect(balanceOn(deps(), accountId, "2026-09-24")).resolves.toMatchObject({
			amount: 123456,
		});
		const after = await getNetWorth(deps(), "6M");
		expect(after.points.filter(({ date }) => date <= "2026-09-24")).toEqual(before.points);
		expect(after.netWorth).toBe(120000);
	});

	it("brings back a line the user deleted when the next sync rereads it, as Sure does", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		const [latest] = await temp.db.all<{ id: string; date: string }>(
			sql`select e.id, e.date from entries e join transactions t on t.entry_id = e.id where e.account_id = ${accountId} and t.pending = 0 order by e.date desc limit 1`,
		);
		const dayBefore = addDays(latest?.date ?? "", -1);
		const before = await balanceOn(deps(), accountId, dayBefore);
		const count = (await transactionCount(accountId)) ?? 0;
		await deleteTransaction(deps(), latest?.id ?? "", { origin: "user" });
		const deleted = await balanceOn(deps(), accountId, dayBefore);
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		await expect(transactionCount(accountId)).resolves.toBe(count);
		expect(deleted).not.toEqual(before);
		await expect(balanceOn(deps(), accountId, dayBefore)).resolves.toEqual(before);
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
			"?date_from=2026-06-25",
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
			amount: 123456,
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

	it("after a renewal that leaves out the card, still reads it under its last uid, its failure the run's error", async () => {
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
		// The new session no longer knows the card's uid.
		const requests = mockProvider({
			transactions: (url) =>
				url.pathname.includes(FIXTURE_CARD_UID)
					? HttpResponse.json({ error: "NOT_FOUND" }, { status: 404 })
					: transactionsPage(url),
		});

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW - 2 * 60 * MINUTE,
			lastError: "BANK_PROVIDER_ERROR",
		});

		expect(requests.some(({ path }) => path.includes(FIXTURE_CARD_UID))).toBe(true);
		await expect(transactionCount(checking.accountId)).resolves.toBe(6);
		await expect(bankAccountSyncedAt(checking.bankAccountId)).resolves.toBe(NOW);
		await expect(bankAccountSyncedAt(card.bankAccountId)).resolves.toBeNull();
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: Date.parse("2026-12-20T10:00:00Z"),
		});
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
		// The session alone, read before any account.
		expect(requests.map(({ path }) => path)).toEqual([`/sessions/${FIXTURE_SESSION_ID}`]);
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
		const run = vi.spyOn(recurringService, "runRecurring").mockImplementation(async () => {
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
		expect(run).toHaveBeenCalledWith(syncDeps, { backfill: false });
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
		const run = vi
			.spyOn(recurringService, "runRecurring")
			.mockRejectedValue(new Error("amount 4290 refused"));
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
		expect(loggedFigures(logLines)).not.toContain("4290");
		expect(run).toHaveBeenCalledWith(syncDeps, { backfill: false });
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
			syncConnection({ ...deps(), bankCredentials: null }, connectionId),
		).rejects.toMatchObject({ code: "BANK_CONNECTOR_UNAVAILABLE" });
	});
});

/** Enable Banking refusing the session read with `status`, and the fixtures elsewhere. */
const sessionAnswering = (status: number) =>
	mockProvider({ session: () => HttpResponse.json({ error: "UNAUTHORIZED" }, { status }) });

describe("the session, read before any account", () => {
	it.each([401, 404])(
		"ends the consent now on a %i, reads no account, and the next day's sync skips it",
		async (status) => {
			const requests = sessionAnswering(status);
			const connectionId = await newConnection({ lastSyncedAt: NOW - 5 * DAY });
			const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

			await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
				code: "CONSENT_EXPIRED",
				status: 409,
			});

			expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
				`GET /sessions/${FIXTURE_SESSION_ID}`,
			]);
			await expect(connectionRow(connectionId)).resolves.toMatchObject({
				consentExpiresAt: NOW,
				lastError: "CONSENT_EXPIRED",
				lastSyncedAt: NOW - 5 * DAY,
				syncStartedAt: null,
				status: "active",
			});
			await expect(transactionCount(accountId)).resolves.toBe(0);
			await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBeNull();
			expect(logged()).toContainEqual(
				expect.objectContaining({
					msg: "bank consent revoked",
					connectionId,
					code: "CONSENT_EXPIRED",
				}),
			);

			vi.setSystemTime(NOW + DAY);
			await expect(startDailySync(deps())).resolves.toMatchObject({ leased: [] });
			await expect(syncAll(deps())).resolves.toEqual([
				{ id: connectionId, result: "consent_expired" },
			]);
			expect(requests).toHaveLength(1);
		},
	);

	it("reports a refused session to the cron as an ended consent", async () => {
		sessionAnswering(404);
		const connectionId = await newConnection();
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncAll(deps())).resolves.toEqual([
			{ id: connectionId, result: "consent_expired" },
		]);
	});

	it("moves the stored consent end to the provider's, then syncs the accounts", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ consentExpiresAt: NOW + 10 * DAY });
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});

		expect(requests[0]?.path).toBe(`/sessions/${FIXTURE_SESSION_ID}`);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: FIXTURE_CONSENT_END,
		});
		await expect(transactionCount(accountId)).resolves.toBeGreaterThan(0);
	});

	it("keeps the stored consent end when the session names none, and syncs the accounts", async () => {
		mockProvider({ session: () => HttpResponse.json({ status: "AUTHORIZED", access: {} }) });
		const connectionId = await newConnection({ consentExpiresAt: NOW + 10 * DAY });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: NOW + 10 * DAY,
		});
	});

	it("takes a session id that no longer decrypts as a refused session, asking the provider nothing", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection({ sessionId: "not-a-ciphertext" });
		await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).rejects.toMatchObject({
			code: "CONSENT_EXPIRED",
		});

		expect(requests).toEqual([]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: NOW,
			lastError: "CONSENT_EXPIRED",
		});
		expect(logged()).toContainEqual(
			expect.objectContaining({ connectionId, code: "SESSION_UNREADABLE" }),
		);
	});

	it("fails the run on any other session failure, reading no account and keeping the consent", async () => {
		const requests = sessionAnswering(500);
		const connectionId = await newConnection({ lastSyncedAt: NOW - 5 * DAY });
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW - 5 * DAY,
			lastError: "BANK_PROVIDER_ERROR",
		});

		expect(requests).toHaveLength(1);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: FIXTURE_CONSENT_END,
			syncStartedAt: null,
		});
		await expect(transactionCount(accountId)).resolves.toBe(0);
		expect(logged()).toContainEqual(
			expect.objectContaining({ msg: "bank session read failed", code: "BANK_PROVIDER_ERROR" }),
		);
	});

	it("keeps an account's 404 that account's error, the consent untouched", async () => {
		mockProvider({
			transactions: (url) =>
				url.pathname.includes(FIXTURE_CARD_UID)
					? HttpResponse.json({ error: "NOT_FOUND" }, { status: 404 })
					: transactionsPage(url),
		});
		const connectionId = await newConnection();
		const checking = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await linkedAccount(connectionId, FIXTURE_CARD_UID);

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: null,
			lastError: "BANK_PROVIDER_ERROR",
		});

		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			consentExpiresAt: FIXTURE_CONSENT_END,
		});
		await expect(bankAccountSyncedAt(checking.bankAccountId)).resolves.toBe(NOW);
	});

	it("logs the currency kept and how many funded balances in others were left out, never an amount", async () => {
		mockProvider({
			balances: () =>
				HttpResponse.json({
					balances: [
						{ balance_amount: { currency: "USD", amount: "12.00" }, balance_type: "CLBD" },
						{ balance_amount: { currency: "EUR", amount: "1234.56" }, balance_type: "CLBD" },
					],
				}),
		});
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await syncConnection(deps(), connectionId);

		await expect(anchorOf(accountId)).resolves.toMatchObject({ amount: 123456 });
		expect(logged()).toContainEqual(
			expect.objectContaining({
				msg: "bank balances in other currencies left out",
				connectionId,
				accountId,
				currency: "EUR",
				otherCurrencies: 1,
			}),
		);
		expect(loggedFigures(logLines)).not.toContain("12.00");
		expectNoSecretLogged();
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
		const actual = await vi.importActual<typeof registry>("../connectors/registry.ts");
		vi.mocked(registry.createBankConnector).mockImplementationOnce((id, config) => ({
			...actual.createBankConnector(id, config),
			fetchBalance: () => Promise.reject(new Error("amount 123456 refused")),
		}));

		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
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
				"?date_from=2026-06-24",
				"?date_from=2026-06-27",
				// Each page asks from the start asked for, as Sure's importer.
				"?date_from=2026-06-24&continuation_key=page-2",
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
				"?date_from=2026-07-07&continuation_key=page-2",
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

	it("fails the account and writes nothing on a 500 after page one", async () => {
		const requests = failingOnPageTwo();
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		await expect(syncAll(deps())).resolves.toEqual([{ id: connectionId, result: "failed" }]);

		await expect(transactionCount(accountId)).resolves.toBe(0);
		await expect(anchorOf(accountId)).resolves.toMatchObject({ amount: 100000 });
		expect(balanceRequests(requests)).toEqual([]);
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBeNull();
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			lastSyncedAt: null,
			lastError: "BANK_PROVIDER_ERROR",
		});
		expect(logged()).toContainEqual(
			expect.objectContaining({
				msg: "bank account sync failed",
				accountId,
				code: "BANK_PROVIDER_ERROR",
			}),
		);
		expectNoSecretLogged();
	});

	it.each([400, 422])(
		"syncs a read cut short by a %i after page one, with its balance",
		async (status) => {
			const requests = failingOnPageTwo(true, status, "WRONG_REQUEST_PARAMETERS");
			const connectionId = await newConnection();
			const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

			await expect(syncAll(deps())).resolves.toEqual([{ id: connectionId, result: "synced" }]);

			// Page one: three booked lines and the pending one.
			await expect(transactionCount(accountId)).resolves.toBe(4);
			await expect(anchorOf(accountId)).resolves.toMatchObject({ amount: 123456 });
			expect(balanceRequests(requests)).toHaveLength(1);
			await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
			await expect(connectionRow(connectionId)).resolves.toMatchObject({
				lastSyncedAt: NOW,
				lastError: null,
			});
			expect(logged()).toContainEqual(
				expect.objectContaining({
					level: 50,
					msg: "bank account read cut short",
					accountId,
					code: "WRONG_REQUEST_PARAMETERS",
					status,
					lines: 4,
				}),
			);
			expectNoSecretLogged();

			// The next read starts from the window the cut-short read moved.
			const again = mockProvider();
			vi.setSystemTime(NOW + DAY);

			await syncConnection(deps(), connectionId);

			expect(transactionRequests(again, FIXTURE_CHECKING_UID)[0]?.search).toBe(
				"?date_from=2026-09-17",
			);
		},
	);

	it("counts no miss on a read cut short", async () => {
		mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await syncConnection(deps(), connectionId);
		failingOnPageTwo(false, 422, "WRONG_REQUEST_PARAMETERS");
		vi.setSystemTime(NOW + DAY);

		await syncConnection(deps(), connectionId);

		await expect(pendingOf(accountId)).resolves.toEqual([
			{ date: "2026-09-23", amount: -1200, missed: 0 },
		]);
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
			{ bankAccountId, balance: toMinorUnits(100000) },
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
		await expect(syncAll({ ...deps(), encryptionKey: null })).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
		});
	});
});

/** A card's current anchor and details. */
async function cardState(accountId: string) {
	const row = await temp.db
		.select({ details: accounts.details })
		.from(accounts)
		.where(eq(accounts.id, accountId))
		.get();

	return { anchor: (await anchorOf(accountId))?.amount ?? null, details: row?.details };
}

describe("a credit card's bank balance", () => {
	type CardSetup = {
		creditLimit?: number | null;
		toggle?: boolean;
		availableCredit?: number | null;
	};

	/** A card of `connectionId` on the fixtures' card, linked without a balance. */
	async function linkedCard(connectionId: string, setup: CardSetup = {}) {
		const bankAccountId = randomUUID();

		await temp.db.insert(bankAccounts).values({
			id: bankAccountId,
			bankConnectionId: connectionId,
			identificationHash: `hash-${bankAccountId}`,
			providerUid: FIXTURE_CARD_UID,
			name: "Carte Visa Premier",
			currency: "EUR",
			cashAccountType: "CARD",
			creditLimit:
				setup.creditLimit === undefined || setup.creditLimit === null
					? null
					: toMinorUnits(setup.creditLimit),
			treatBalanceAsAvailableCredit: setup.toggle ?? false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const account = await createAccount(
			deps(),
			{
				name: "Carte Visa Premier",
				type: "credit_card",
				subtype: null,
				currency: "EUR",
				openingBalance: toMinorUnits(0),
				openingDate: "2026-06-01",
				details: {
					availableCredit:
						setup.availableCredit === undefined || setup.availableCredit === null
							? null
							: toMinorUnits(setup.availableCredit),
					minimumPayment: toMinorUnits(2500),
					apr: 159900,
					expirationDate: "2028-04-30",
					annualFee: null,
				},
			},
			{ origin: "sync" },
		);
		await linkBankAccount(deps(), account.id, { bankAccountId, balance: null }, { origin: "sync" });

		return { accountId: account.id, bankAccountId };
	}

	async function cardAfterSync(reported: string, setup: CardSetup) {
		mockProvider({ balances: () => HttpResponse.json(bankBalancesWith(reported)) });
		const connectionId = await newConnection();
		const { accountId } = await linkedCard(connectionId, setup);

		await syncConnection(deps(), connectionId);

		return { accountId, connectionId, ...(await cardState(accountId)) };
	}

	it("takes the debt as the bank limit less the reported credit, toggle on", async () => {
		const card = await cardAfterSync("900.00", { creditLimit: 100000, toggle: true });

		expect(card.anchor).toBe(10000);
		// Its other details stay as typed.
		expect(card.details).toEqual({
			availableCredit: 100000,
			minimumPayment: 2500,
			apr: 159900,
			expirationDate: "2028-04-30",
			annualFee: null,
		});
		await expect(balanceOn(deps(), card.accountId, "2026-09-24")).resolves.toEqual({
			amount: 10000,
			currency: "EUR",
		});
	});

	it("owes nothing on an overpaid card, toggle on", async () => {
		const card = await cardAfterSync("1050.00", { creditLimit: 100000, toggle: true });

		expect(card.anchor).toBe(0);
		expect(card.details).toMatchObject({ availableCredit: 100000 });
	});

	it("subtracts from « Crédit disponible » without a bank limit, toggle on", async () => {
		const card = await cardAfterSync("900.00", { availableCredit: 100000, toggle: true });

		expect(card.anchor).toBe(10000);
		expect(card.details).toMatchObject({ availableCredit: 100000 });
	});

	it("writes no balance and clears « Crédit disponible » with no limit anywhere, toggle on", async () => {
		const card = await cardAfterSync("900.00", { toggle: true });

		expect(card.anchor).toBeNull();
		expect(card.details).toMatchObject({ availableCredit: null, minimumPayment: 2500 });
		await expect(connectionRow(card.connectionId)).resolves.toMatchObject({ lastError: null });
	});

	it("keeps the reported debt and refreshes the credit left from a bank limit, toggle off", async () => {
		const card = await cardAfterSync("100.00", { creditLimit: 100000, availableCredit: 300000 });

		expect(card.anchor).toBe(10000);
		expect(card.details).toMatchObject({ availableCredit: 90000 });
	});

	it("keeps the reported debt and « Crédit disponible » without a bank limit, toggle off", async () => {
		const card = await cardAfterSync("-100.00", { availableCredit: 300000 });

		expect(card.anchor).toBe(10000);
		expect(card.details).toMatchObject({ availableCredit: 300000 });
	});

	it("counts a bank limit of zero as none", async () => {
		const card = await cardAfterSync("100.00", { creditLimit: 0, availableCredit: 300000 });

		expect(card.anchor).toBe(10000);
		expect(card.details).toMatchObject({ availableCredit: 300000 });
	});

	it("changes neither the balance nor the details for a balance in another currency", async () => {
		const { balances } = bankBalancesWith("900.00");
		mockProvider({
			balances: () =>
				HttpResponse.json({
					balances: balances.map((row) => ({
						...row,
						balance_amount: { currency: "USD", amount: "900.00" },
					})),
				}),
		});
		const connectionId = await newConnection();
		const { accountId } = await linkedCard(connectionId, {
			creditLimit: 100000,
			toggle: true,
			availableCredit: 300000,
		});

		await syncConnection(deps(), connectionId);

		expect((await cardState(accountId)).details).toMatchObject({ availableCredit: 300000 });
	});

	it("reads a depository's bank balance as it is, whatever its bank account says", async () => {
		mockProvider({ balances: () => HttpResponse.json(bankBalancesWith("900.00")) });
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);
		await temp.db
			.update(bankAccounts)
			.set({ creditLimit: toMinorUnits(100000), treatBalanceAsAvailableCredit: true })
			.where(eq(bankAccounts.id, bankAccountId));

		await syncConnection(deps(), connectionId);

		await expect(cardState(accountId)).resolves.toEqual({ anchor: 90000, details: null });
	});

	it("interprets the balance a link writes, as a sync does", async () => {
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedCard(connectionId, {
			creditLimit: 100000,
			toggle: true,
		});

		await linkBankAccount(
			deps(),
			accountId,
			{ bankAccountId, balance: toMinorUnits(-90000) },
			{ origin: "sync" },
		);

		await expect(cardState(accountId)).resolves.toMatchObject({
			anchor: 10000,
			details: { availableCredit: 100000 },
		});
	});

	it("leaves a link without a balance when no limit reads the available credit", async () => {
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedCard(connectionId, { toggle: true });

		await linkBankAccount(
			deps(),
			accountId,
			{ bankAccountId, balance: toMinorUnits(90000) },
			{ origin: "sync" },
		);

		await expect(cardState(accountId)).resolves.toMatchObject({
			anchor: null,
			details: { availableCredit: null },
		});
	});

	it("starts the connection's sync when the toggle changes, and the balance reads the new way", async () => {
		const requests = mockProvider({
			balances: () => HttpResponse.json(bankBalancesWith("900.00")),
		});
		const connectionId = await newConnection();
		const { accountId, bankAccountId } = await linkedCard(connectionId, { creditLimit: 100000 });

		const saved = await updateAccount(deps(), accountId, { treatBalanceAsAvailableCredit: true });

		expect(saved.treatBalanceAsAvailableCredit).toBe(true);
		// The lease is taken before the save answers; the bank is read after.
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncAttemptedAt: NOW });
		await vi.waitFor(
			async () => {
				await expect(connectionRow(connectionId)).resolves.toMatchObject({
					lastSyncedAt: NOW,
					syncStartedAt: null,
				});
			},
			{ timeout: 10_000 },
		);
		expect(balanceRequests(requests)).toHaveLength(1);
		await expect(cardState(accountId)).resolves.toMatchObject({
			anchor: 10000,
			details: { availableCredit: 100000 },
		});
		await expect(
			temp.db
				.select({ toggle: bankAccounts.treatBalanceAsAvailableCredit })
				.from(bankAccounts)
				.where(eq(bankAccounts.id, bankAccountId))
				.get(),
		).resolves.toEqual({ toggle: true });
	});

	it("syncs a connection synced minutes ago when the toggle changes, but never past a held lease", async () => {
		const requests = mockProvider({
			balances: () => HttpResponse.json(bankBalancesWith("900.00")),
		});
		const connectionId = await newConnection({ lastSyncedAt: NOW - 5 * MINUTE });
		const { accountId } = await linkedCard(connectionId, { creditLimit: 100000 });

		await updateAccount(deps(), accountId, { treatBalanceAsAvailableCredit: true });

		await vi.waitFor(
			async () => {
				await expect(connectionRow(connectionId)).resolves.toMatchObject({
					lastSyncedAt: NOW,
					syncStartedAt: null,
				});
			},
			{ timeout: 10_000 },
		);
		expect(balanceRequests(requests)).toHaveLength(1);
		await expect(cardState(accountId)).resolves.toMatchObject({ anchor: 10000 });

		const held = await newConnection({ syncStartedAt: NOW - 2 * MINUTE });
		await expect(startConnectionSync(deps(), held)).resolves.toMatchObject({ leased: [] });
	});

	it("starts nothing for a connection not active, past its consent or without a connector", async () => {
		const pending = await newConnection({ status: "pending" });
		const expired = await newConnection({ consentExpiresAt: NOW });
		const active = await newConnection();

		const started = await Promise.all([
			startConnectionSync(deps(), pending),
			startConnectionSync(deps(), expired),
			startConnectionSync({ ...deps(), encryptionKey: null }, active),
			startConnectionSync({ ...deps(), bankCredentials: null }, active),
		]);

		expect(started.map(({ leased }) => leased)).toEqual([[], [], [], []]);
		await expect(connectionRow(active)).resolves.toMatchObject({ syncAttemptedAt: null });
	});

	it("saves the toggle when its sync cannot start, logging the code alone", async () => {
		const connectionId = await newConnection();
		const { accountId } = await linkedCard(connectionId, { creditLimit: 100000 });
		vi.mocked(registry.createBankConnector).mockImplementationOnce(() => {
			throw new Error("amount 123456 refused");
		});
		const failing = deps();

		const saved = await updateAccount(failing, accountId, { treatBalanceAsAvailableCredit: true });

		expect(saved.treatBalanceAsAvailableCredit).toBe(true);
		expect(logged()).toContainEqual(
			expect.objectContaining({
				connectionId,
				code: "INTERNAL_ERROR",
				msg: "bank sync failed to start",
			}),
		);
		expect(loggedFigures(logLines)).not.toContain("123456");
	});

	it("starts no sync when the toggle is saved unchanged", async () => {
		const requests = mockProvider();
		const connectionId = await newConnection();
		const { accountId } = await linkedCard(connectionId, { toggle: true });

		await updateAccount(deps(), accountId, { treatBalanceAsAvailableCredit: true, name: "Visa" });

		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncAttemptedAt: null,
			syncStartedAt: null,
		});
		expect(requests).toEqual([]);
	});
});

/** Enable Banking holding every transactions answer until `release` is called. */
function heldProvider() {
	const gate: { open?: () => void } = {};
	const held = new Promise<void>((resolve) => {
		gate.open = resolve;
	});
	const requests = mockProvider({
		transactions: async (url) => {
			await held;

			return transactionsPage(url);
		},
	});

	return { requests, release: () => gate.open?.() };
}

describe("startDailySync", () => {
	const HOUR = 60 * MINUTE;

	/** A linked connection whose last run, yesterday, synced 20 hours ago. */
	async function dueConnection(fields: Partial<typeof bankConnections.$inferInsert> = {}) {
		const connectionId = await newConnection({
			lastSyncedAt: Date.now() - 20 * HOUR,
			syncAttemptedAt: Date.now() - 20 * HOUR,
			...fields,
		});
		const linked = await linkedAccount(connectionId, FIXTURE_CHECKING_UID);

		return { connectionId, ...linked };
	}

	it("takes the lease before it resolves, and reads the bank only in the run", async () => {
		const { requests, release } = heldProvider();
		const { connectionId, accountId, bankAccountId } = await dueConnection();

		const daily = await startDailySync(deps());

		expect(daily.leased).toEqual([connectionId]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: NOW,
			syncAttemptedAt: NOW,
		});
		expect(requests).toEqual([]);

		const running = daily.run();
		await vi.waitFor(
			() => {
				expect(transactionRequests(requests, FIXTURE_CHECKING_UID)).toHaveLength(1);
			},
			{ timeout: 10_000 },
		);
		// The bank has not answered: the lease is still held.
		await expect(connectionRow(connectionId)).resolves.toMatchObject({ syncStartedAt: NOW });
		release();
		await running;

		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: null,
			syncAttemptedAt: NOW,
			lastSyncedAt: NOW,
			lastError: null,
		});
		await expect(bankAccountSyncedAt(bankAccountId)).resolves.toBe(NOW);
		await expect(transactionCount(accountId)).resolves.toBe(6);
	});

	it("syncs a connection once when two requests race for it", async () => {
		const requests = mockProvider();
		const { connectionId, accountId } = await dueConnection();

		const [first, second] = await Promise.all([startDailySync(deps()), startDailySync(deps())]);
		await Promise.all([first.run(), second.run()]);

		expect([...first.leased, ...second.leased]).toEqual([connectionId]);
		expect(transactionRequests(requests, FIXTURE_CHECKING_UID)).toHaveLength(2);
		await expect(transactionCount(accountId)).resolves.toBe(6);

		const third = await startDailySync(deps());
		expect(third.leased).toEqual([]);
	});

	it("starts nothing after a failed attempt today, while the button still syncs", async () => {
		const requests = mockProvider();
		// 08:00 in Paris, today.
		const { connectionId } = await dueConnection({
			syncAttemptedAt: Date.parse("2026-09-24T06:00:00Z"),
			lastError: "BANK_PROVIDER_ERROR",
		});

		const daily = await startDailySync(deps());
		await daily.run();

		expect(daily.leased).toEqual([]);
		expect(requests).toEqual([]);
		await expect(syncConnection(deps(), connectionId)).resolves.toEqual({
			lastSyncedAt: NOW,
			lastError: null,
		});
	});

	it("skips a connection the cron synced late last night, then takes it past the hour", async () => {
		mockProvider();
		// 23:30 in Paris, the day before the visit.
		const lateCron = Date.parse("2026-09-24T21:30:00Z");
		const { connectionId } = await dueConnection({
			lastSyncedAt: lateCron,
			syncAttemptedAt: lateCron,
		});
		// 00:10 in Paris.
		vi.setSystemTime(Date.parse("2026-09-24T22:10:00Z"));
		const syncDeps = deps();

		const early = await startDailySync(syncDeps);

		expect(early.leased).toEqual([]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: null,
			syncAttemptedAt: lateCron,
		});
		// Silent, like the cron: every page would otherwise log it.
		expect(logLines).toEqual([]);

		// 00:31 in Paris.
		vi.setSystemTime(Date.parse("2026-09-24T22:31:00Z"));
		const later = await startDailySync(syncDeps);
		await later.run();

		expect(later.leased).toEqual([connectionId]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			lastSyncedAt: Date.parse("2026-09-24T22:31:00Z"),
		});
	});

	it("starts nothing for an ended consent, a pending connection or a held lease", async () => {
		const requests = mockProvider();
		await dueConnection({ consentExpiresAt: NOW - 1 });
		await newConnection({ status: "pending", syncAttemptedAt: null });
		await dueConnection({ syncStartedAt: NOW - 2 * MINUTE });

		const daily = await startDailySync(deps());
		await daily.run();

		expect(daily.leased).toEqual([]);
		expect(requests).toEqual([]);
	});

	it("counts the day in the app's zone: 23:50 and 00:05 in Paris are two days", async () => {
		mockProvider();
		// 23:50 in Paris on the 24th, a failed attempt; both instants fall on
		// the 24th in UTC.
		const { connectionId } = await dueConnection({
			syncAttemptedAt: Date.parse("2026-09-24T21:50:00Z"),
			lastError: "BANK_PROVIDER_ERROR",
		});
		const visit = Date.parse("2026-09-24T22:05:00Z");
		vi.setSystemTime(visit);

		const daily = await startDailySync(deps());
		await daily.run();

		expect(daily.leased).toEqual([connectionId]);
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncAttemptedAt: visit,
			lastSyncedAt: visit,
			lastError: null,
		});
		const utc = await startDailySync({ ...deps(), timeZone: "UTC" });
		expect(utc.leased).toEqual([]);
	});

	it("logs a run that throws with its connection and code, releases the lease and never rejects", async () => {
		mockProvider();
		const { connectionId } = await dueConnection();
		// The lease, then the bank account's window, then the connection's
		// state: that third write fails.
		const failing = failingThirdUpdate();

		const daily = await startDailySync(failing);

		await expect(daily.run()).resolves.toBeUndefined();
		await expect(connectionRow(connectionId)).resolves.toMatchObject({
			syncStartedAt: null,
			syncAttemptedAt: NOW,
		});
		expect(logged()).toContainEqual(
			expect.objectContaining({
				msg: "bank sync failed",
				connectionId,
				code: "INTERNAL_ERROR",
			}),
		);
	});

	it("syncs the due connections one after another, oldest first, logged as automatic", async () => {
		const requests = mockProvider();
		const first = await dueConnection({ createdAt: NOW - 2 });
		const secondId = await newConnection({ createdAt: NOW - 1, syncAttemptedAt: null });
		await linkedAccount(secondId, FIXTURE_CARD_UID);
		const syncDeps = deps();

		const daily = await startDailySync(syncDeps);
		await daily.run();

		expect(daily.leased).toEqual([first.connectionId, secondId]);
		expect(
			requests
				.filter(({ path }) => path.endsWith("/transactions"))
				.map(({ path }) => path.split("/")[2]),
		).toEqual([FIXTURE_CHECKING_UID, FIXTURE_CHECKING_UID, FIXTURE_CARD_UID, FIXTURE_CARD_UID]);
		expect(logged().filter(({ msg }) => msg === "bank connection synced")).toEqual([
			expect.objectContaining({ connectionId: first.connectionId, trigger: "auto" }),
			expect.objectContaining({ connectionId: secondId, trigger: "auto" }),
		]);
		expectNoSecretLogged();
	});

	it("counts a run of the button or the cron as the day's attempt, failed or not", async () => {
		failingOn(FIXTURE_CHECKING_UID);
		const button = await dueConnection({ createdAt: NOW - 2 });
		const cron = await newConnection({ createdAt: NOW - 1, syncAttemptedAt: null });
		await linkedAccount(cron, FIXTURE_CARD_UID);

		await expect(syncConnection(deps(), button.connectionId)).resolves.toMatchObject({
			lastError: "BANK_PROVIDER_ERROR",
		});
		await expect(syncAll(deps())).resolves.toContainEqual({ id: cron, result: "synced" });

		await expect(connectionRow(button.connectionId)).resolves.toMatchObject({
			syncAttemptedAt: NOW,
		});
		await expect(connectionRow(cron)).resolves.toMatchObject({ syncAttemptedAt: NOW });
		await expect(startDailySync(deps())).resolves.toMatchObject({ leased: [] });
	});

	it("reads nothing and takes no lease while the bank is unconfigured", async () => {
		const { connectionId } = await dueConnection();
		const before = await connectionRow(connectionId);

		const withoutKey = await startDailySync({ ...deps(), encryptionKey: null });
		const withoutCredentials = await startDailySync({ ...deps(), bankCredentials: null });

		expect([...withoutKey.leased, ...withoutCredentials.leased]).toEqual([]);
		await expect(connectionRow(connectionId)).resolves.toEqual(before);
	});
});
