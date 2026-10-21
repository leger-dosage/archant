import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { sessions, users } from "@archant/data/schema/auth";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { goalAccounts, goals } from "@archant/data/schema/goals";
import { importMappings } from "@archant/data/schema/import-mappings";
import { invitations } from "@archant/data/schema/invitations";
import {
	recurringAllocations,
	recurringMatchRejections,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import { ruleRuns, rules } from "@archant/data/schema/rules";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";
import { transactions } from "@archant/data/schema/transactions";

import { createLogger } from "../../lib/logger.ts";
import {
	deps,
	importStatement,
	line,
	setToday,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { LEASE_MS } from "../bank-connections.ts";
import { DEFAULT_SURE_IMPORT_LIMITS, importSureArchive } from "../sure-import.ts";
import { addAttachment } from "./attachments.ts";
import { resetFinancialData } from "./reset.ts";
import { createTransferBetween } from "./transfers.ts";

useLedgerDatabase();

/**
 * What Sure's `Family::FinancialDataReset#delete_financial_data!` deletes,
 * mapped to Archant's tables.
 */
const RESET = [
	"accounts",
	"balances",
	"bank_accounts",
	"bank_connections",
	"budget_categories",
	"budgets",
	"categories",
	"cost_basis_locks",
	"entries",
	"entry_keys",
	"goal_accounts",
	"holdings",
	"import_mappings",
	"imports",
	"merchants",
	"recurrence_rules",
	"recurring_allocations",
	"recurring_match_rejections",
	"recurring_occurrences",
	"recurring_price_changes",
	"recurring_transactions",
	"rejected_transfers",
	"rule_actions",
	"rule_conditions",
	"rule_runs",
	"rules",
	"taggings",
	"tags",
	"trades",
	"transaction_attachments",
	"transactions",
	"transfer_fees",
	"transfers",
];

/** What it keeps: the users and their sign-in, the instance's settings, goals and the global securities. */
const KEPT = [
	"__drizzle_migrations",
	"assistant_calls",
	"auth_accounts",
	"goals",
	"invitations",
	"jwks",
	"oauth_access_tokens",
	"oauth_client_assertions",
	"oauth_client_resources",
	"oauth_clients",
	"oauth_consents",
	"oauth_refresh_tokens",
	"oauth_resources",
	"rate_limits",
	"securities",
	"security_prices",
	"sessions",
	"settings",
	"sign_in_failures",
	"two_factors",
	"users",
	"verifications",
];

const record = (type: string, data: Record<string, unknown>) => ({ type, data });

/**
 * A Sure archive with two levels of categories, a tag, a merchant, a split, a
 * transfer and a refused pair, a trade and a locked holding, a valuation, a
 * budget, a rule and a recurring series.
 */
const ARCHIVE = [
	record("Account", {
		id: "a1",
		name: "Compte joint",
		balance: "0",
		currency: "EUR",
		accountable_type: "Depository",
	}),
	record("Account", {
		id: "a2",
		name: "Livret A",
		balance: "0",
		currency: "EUR",
		accountable_type: "Depository",
	}),
	record("Account", {
		id: "i1",
		name: "PEA",
		balance: "0",
		currency: "EUR",
		accountable_type: "Investment",
	}),
	record("Category", { id: "c1", name: "Alimentation" }),
	record("Category", { id: "c2", name: "Boulangerie", parent_id: "c1" }),
	record("Tag", { id: "g1", name: "Voyage" }),
	record("Merchant", { id: "m1", name: "Boulanger" }),
	record("Transaction", {
		id: "t1",
		account_id: "a1",
		date: "2026-09-10",
		amount: "100",
		category_id: "c2",
		merchant_id: "m1",
		tag_ids: ["g1"],
		split_lines: [{ amount: "60", category_id: "c1", tag_ids: ["g1"] }, { amount: "40" }],
	}),
	record("Transaction", { id: "t2", account_id: "a1", date: "2026-09-11", amount: "12" }),
	record("Transaction", { id: "t3", account_id: "a1", date: "2026-09-12", amount: "50" }),
	record("Transaction", { id: "t4", account_id: "a2", date: "2026-09-12", amount: "-50" }),
	record("Transfer", { outflow_transaction_id: "t3", inflow_transaction_id: "t4" }),
	record("Transaction", { id: "t5", account_id: "a1", date: "2026-09-13", amount: "7" }),
	record("Transaction", { id: "t6", account_id: "a2", date: "2026-09-13", amount: "-7" }),
	record("RejectedTransfer", { outflow_transaction_id: "t5", inflow_transaction_id: "t6" }),
	record("Trade", {
		account_id: "i1",
		date: "2026-09-02",
		amount: "10",
		qty: "1",
		price: "10",
		ticker: "AAPL",
		security_name: "Apple",
	}),
	record("Holding", {
		account_id: "i1",
		date: "2026-09-05",
		amount: "10",
		qty: "1",
		price: "10",
		ticker: "AAPL",
		cost_basis: "9.5",
		cost_basis_source: "manual",
		cost_basis_locked: true,
	}),
	record("Valuation", { id: "v1", account_id: "a2", date: "2026-09-15", amount: "500" }),
	record("Budget", {
		id: "b1",
		start_date: "2026-09-01",
		end_date: "2026-09-30",
		budgeted_spending: "1200",
		expected_income: "3000",
		currency: "EUR",
	}),
	record("BudgetCategory", { budget_id: "b1", category_id: "c1", budgeted_spending: "300" }),
	record("Rule", {
		id: "r1",
		name: "Boulangerie",
		active: true,
		conditions: [{ condition_type: "transaction_name", operator: "like", value: "PAIN" }],
		actions: [{ action_type: "set_transaction_merchant", value: "Boulanger" }],
	}),
	record("RecurringTransaction", {
		id: "rc1",
		account_id: "a1",
		name: "Loyer",
		amount: "900",
		currency: "EUR",
		expected_day_of_month: 1,
		last_occurrence_date: "2026-09-01",
		next_expected_date: "2026-10-01",
		status: "active",
	}),
	record("RecurrenceRule", { recurring_transaction_id: "rc1", frequency: "monthly" }),
];

async function idOf(table: typeof accounts | typeof rules | typeof recurringTransactions) {
	const row = await temp.db.select({ id: table.id }).from(table).limit(1).get();

	if (row === undefined) {
		throw new Error("The archive wrote no row.");
	}

	return row.id;
}

async function accountNamed(name: string) {
	const row = await temp.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.name, name))
		.get();

	if (row === undefined) {
		throw new Error(`No account is named ${name}.`);
	}

	return row.id;
}

async function transactionId() {
	const row = await temp.db
		.select({ id: transactions.entryId })
		.from(transactions)
		.innerJoin(entries, eq(entries.id, transactions.entryId))
		.where(eq(entries.date, "2026-09-11"))
		.get();

	if (row === undefined) {
		throw new Error("The archive wrote no transaction on 2026-09-11.");
	}

	return row.id;
}

/**
 * Fills every table the reset empties, and the kept ones it must leave: a
 * Sure archive, then a statement import with its keys and mapping, a bank
 * connection linked to an account, an attachment, a rule run, a series' due
 * payments, a goal backed by an account, and the users and settings around.
 */
async function household({ syncStartedAt = null }: { syncStartedAt?: number | null } = {}) {
	setToday("2026-09-21T10:00:00Z");
	const now = Date.now();
	const userId = crypto.randomUUID();

	await temp.db.insert(users).values({
		id: userId,
		name: "Dominique",
		email: `${userId}@example.test`,
		role: "admin",
		createdAt: new Date(now),
		updatedAt: new Date(now),
	});
	await temp.db.insert(sessions).values({
		id: crypto.randomUUID(),
		token: crypto.randomUUID(),
		userId,
		expiresAt: new Date(now + 86_400_000),
		createdAt: new Date(now),
		updatedAt: new Date(now),
	});
	await temp.db.insert(settings).values({ key: `test_${userId}`, value: "kept", updatedAt: now });
	await temp.db.insert(invitations).values({
		id: crypto.randomUUID(),
		email: `invited-${userId}@example.test`,
		role: "viewer",
		tokenHash: crypto.randomUUID(),
		inviterId: userId,
		expiresAt: now + 86_400_000,
		createdAt: now,
	});
	await temp.db.insert(assistantCalls).values({
		id: crypto.randomUUID(),
		clientId: "claude",
		tool: "list_accounts",
		outcome: "ok",
		changedRows: 0,
		createdAt: now,
	});
	const securityId = crypto.randomUUID();
	await temp.db
		.insert(securities)
		.values({ id: securityId, name: "Fonds", currency: "EUR", createdAt: now, updatedAt: now });
	await temp.db.insert(securityPrices).values({
		securityId,
		date: "2026-09-18",
		price: toMicros(12_000_000),
		currency: "EUR",
		source: "manual",
	});

	await importSureArchive(
		{ db: temp.db, timeZone: "Europe/Paris", logger: createLogger("silent") },
		{
			name: "all.ndjson",
			bytes: new TextEncoder().encode(ARCHIVE.map((row) => JSON.stringify(row)).join("\n")),
		},
		DEFAULT_SURE_IMPORT_LIMITS,
	);

	const checking = await accountNamed("Compte joint");
	await temp.db.update(users).set({ defaultAccountId: checking }).where(eq(users.id, userId));
	await importStatement(checking, {
		transactions: [line({ externalId: "F1", label: "CB PAIN", amount: toMinorUnits(-320) })],
		balance: null,
		rejected: [],
	});
	await temp.db.insert(importMappings).values({
		accountId: checking,
		mapping: {
			delimiter: ";",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["date", "label", "amount"],
		},
		updatedAt: now,
	});

	const connectionId = crypto.randomUUID();
	const bankAccountId = crypto.randomUUID();
	await temp.db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque",
		country: "FR",
		status: "active",
		sessionId: "session",
		syncStartedAt,
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.insert(bankAccounts).values({
		id: bankAccountId,
		bankConnectionId: connectionId,
		identificationHash: "hash",
		providerUid: "uid",
		name: "Compte courant",
		currency: "EUR",
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.update(accounts).set({ bankAccountId }).where(eq(accounts.id, checking));

	const entryId = await transactionId();
	await addAttachment(
		deps(),
		entryId,
		{
			filename: "ticket.pdf",
			contentType: "application/pdf",
			bytes: new TextEncoder().encode("%PDF"),
		},
		{ origin: "user" },
	);

	const ruleId = await idOf(rules);
	await temp.db.insert(ruleRuns).values({
		id: crypto.randomUUID(),
		ruleId,
		rule: { name: "Boulangerie", conditions: [], actions: [] },
		matchedCount: 1,
		changedCount: 1,
		executedAt: now,
		position: 0,
	});
	await temp.db.insert(ruleRuns).values({
		id: crypto.randomUUID(),
		// A run whose rule was deleted since: it goes too.
		ruleId: null,
		rule: { name: "Boulangerie", conditions: [], actions: [] },
		matchedCount: 1,
		changedCount: 1,
		executedAt: now,
		position: 0,
	});

	const seriesId = await idOf(recurringTransactions);
	const occurrenceId = crypto.randomUUID();
	await temp.db.insert(recurringOccurrences).values({
		id: occurrenceId,
		recurringTransactionId: seriesId,
		// A month before the archive's series starts, which its import has not generated.
		originalDueOn: "2026-06-01",
		dueOn: "2026-06-01",
		currency: "EUR",
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.insert(recurringAllocations).values({
		id: crypto.randomUUID(),
		recurringOccurrenceId: occurrenceId,
		entryId,
		allocatedAmount: 1200,
		state: "confirmed",
		source: "user_confirmed",
		paidOn: "2026-09-11",
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.insert(recurringMatchRejections).values({
		id: crypto.randomUUID(),
		recurringTransactionId: seriesId,
		entryId,
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.insert(recurringPriceChanges).values({
		id: crypto.randomUUID(),
		recurringTransactionId: seriesId,
		effectiveOn: "2026-09-01",
		previousAmount: 85_000,
		newAmount: 90_000,
		currency: "EUR",
		entryId,
		createdAt: now,
		updatedAt: now,
	});

	const goalId = crypto.randomUUID();
	await temp.db.insert(goals).values({
		id: goalId,
		name: "Vacances",
		targetAmount: 300_000,
		currency: "EUR",
		color: "#4ea7fc",
		createdAt: now,
		updatedAt: now,
	});
	await temp.db.insert(goalAccounts).values({ goalId, accountId: await accountNamed("Livret A") });
	await createTransferBetween(
		deps(),
		{
			fromAccountId: await accountNamed("Compte joint"),
			toAccountId: await accountNamed("Livret A"),
			date: "2026-09-12",
			amount: toMinorUnits(5000),
			sourceFee: toMinorUnits(100),
			destinationFee: toMinorUnits(0),
			tagIds: [],
		},
		{ origin: "user" },
	);

	return { userId };
}

async function tableNames() {
	const rows = await temp.db.all<{ name: string }>(
		sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
	);

	return rows.map(({ name }) => name);
}

async function countOf(table: string) {
	const row = await temp.db.get<{ count: number }>(
		sql`select count(*) as count from ${sql.identifier(table)}`,
	);

	return row?.count ?? 0;
}

async function counts(tables: readonly string[]) {
	return Object.fromEntries(
		await Promise.all(tables.map(async (table) => [table, await countOf(table)] as const)),
	);
}

/** Every row of every kept table, a user's default account aside: its foreign key empties it. */
async function keptRows() {
	const contents = await Promise.all(
		KEPT.map(async (table) => {
			const rows = await temp.db.all<Record<string, unknown>>(
				sql`select * from ${sql.identifier(table)} order by rowid`,
			);

			return [
				table,
				table === "users"
					? rows.map(({ default_account_id: _defaultAccount, ...row }) => row)
					: rows,
			] as const;
		}),
	);

	return Object.fromEntries(contents);
}

const reset = () => resetFinancialData(deps(), { origin: "user" });

describe("resetFinancialData", () => {
	it("knows every table of a migrated database as reset or kept, never both", async () => {
		expect(RESET.filter((table) => KEPT.includes(table))).toEqual([]);
		expect(await tableNames()).toEqual([...RESET, ...KEPT].toSorted());
	});

	it("empties each reset table and leaves each kept one as it was, users without a default account", async () => {
		const { userId } = await household();
		const before = await counts(RESET);

		// Fails if the seed stops reaching a table, rather than passing on an empty one.
		expect(Object.entries(before).filter(([, count]) => count === 0)).toEqual([]);

		const kept = await keptRows();

		await reset();

		expect(Object.values(await counts(RESET)).every((count) => count === 0)).toBe(true);
		expect(await keptRows()).toEqual(kept);
		expect(await countOf("goals")).toBeGreaterThan(0);
		await expect(
			temp.db.select({ id: users.defaultAccountId }).from(users).where(eq(users.id, userId)).get(),
		).resolves.toEqual({ id: null });
	});

	it("changes nothing in a household with no financial data", async () => {
		await reset();
		const kept = await keptRows();

		await expect(reset()).resolves.toBeUndefined();
		expect(await keptRows()).toEqual(kept);
	});

	it("refuses with SYNC_IN_PROGRESS while a sync holds a connection's lease, deleting nothing", async () => {
		await reset();
		setToday("2026-09-21T10:00:00Z");
		await household({ syncStartedAt: Date.now() - 60_000 });
		const before = await counts(RESET);

		await expect(reset()).rejects.toMatchObject({ code: "SYNC_IN_PROGRESS" });
		expect(await counts(RESET)).toEqual(before);

		// A lease a crashed sync left behind holds nothing back.
		await temp.db.update(bankConnections).set({ syncStartedAt: Date.now() - LEASE_MS - 1 });
		await reset();

		expect(await countOf("bank_connections")).toBe(0);
		expect(await countOf("accounts")).toBe(0);
	});
});
