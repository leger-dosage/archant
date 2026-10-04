import type { ServiceDeps } from "../deps.ts";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { budgetCategories, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { goalAccounts, goals } from "@archant/data/schema/goals";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { ruleActions, ruleConditions, rules } from "@archant/data/schema/rules";
import { securities } from "@archant/data/schema/securities";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import { trades } from "@archant/data/schema/trades";
import { transactionAttachments } from "@archant/data/schema/transaction-attachments";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { today } from "../../domain/dates.ts";
import { balanceOn } from "./balances.ts";
import { KEYS_PER_LOOKUP, asInflow, asOutflow, inSequence, notSplitParent } from "./shared.ts";

/**
 * Every column the archive reads, by table, under its TypeScript key (AD-23).
 * The archive holds what is listed here and nothing else: a whole row is never
 * serialised, because a column added later would then leave in it unseen, as
 * Sure's `Account#as_json` lets provider ids leave. `export.spec.ts` fails
 * when a column of a migrated database is in neither this list nor
 * `LEFT_OUT`, or in both.
 */
export const EXPORTED_COLUMNS = {
	accounts: {
		id: accounts.id,
		name: accounts.name,
		type: accounts.type,
		subtype: accounts.subtype,
		currency: accounts.currency,
		details: accounts.details,
		active: accounts.active,
		excludedFromReports: accounts.excludedFromReports,
		createdAt: accounts.createdAt,
		updatedAt: accounts.updatedAt,
	},
	balances: {
		accountId: balances.accountId,
		date: balances.date,
		balance: balances.balance,
		currency: balances.currency,
	},
	categories: {
		id: categories.id,
		name: categories.name,
		kind: categories.kind,
		color: categories.color,
		icon: categories.icon,
		parentId: categories.parentId,
		createdAt: categories.createdAt,
		updatedAt: categories.updatedAt,
	},
	tags: {
		id: tags.id,
		name: tags.name,
		createdAt: tags.createdAt,
		updatedAt: tags.updatedAt,
	},
	merchants: {
		id: merchants.id,
		name: merchants.name,
		createdAt: merchants.createdAt,
		updatedAt: merchants.updatedAt,
	},
	recurring_transactions: {
		id: recurringTransactions.id,
		accountId: recurringTransactions.accountId,
		merchantId: recurringTransactions.merchantId,
		label: recurringTransactions.label,
		amount: recurringTransactions.amount,
		currency: recurringTransactions.currency,
		expectedDayOfMonth: recurringTransactions.expectedDayOfMonth,
		lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
		nextExpectedDate: recurringTransactions.nextExpectedDate,
		occurrenceCount: recurringTransactions.occurrenceCount,
		status: recurringTransactions.status,
		manual: recurringTransactions.manual,
		createdAt: recurringTransactions.createdAt,
		updatedAt: recurringTransactions.updatedAt,
	},
	entries: {
		id: entries.id,
		accountId: entries.accountId,
		kind: entries.kind,
		valuationKind: entries.valuationKind,
		date: entries.date,
		amount: entries.amount,
		currency: entries.currency,
		parentEntryId: entries.parentEntryId,
		createdAt: entries.createdAt,
		updatedAt: entries.updatedAt,
	},
	transactions: {
		entryId: transactions.entryId,
		label: transactions.label,
		notes: transactions.notes,
		reference: transactions.reference,
		excluded: transactions.excluded,
		possibleDuplicate: transactions.possibleDuplicate,
		pending: transactions.pending,
		lockedFields: transactions.lockedFields,
		categoryId: transactions.categoryId,
		categoryOrigin: transactions.categoryOrigin,
		merchantId: transactions.merchantId,
	},
	taggings: {
		transactionId: taggings.transactionId,
		tagId: taggings.tagId,
	},
	trades: {
		entryId: trades.entryId,
		securityId: trades.securityId,
		quantity: trades.quantity,
		price: trades.price,
		fee: trades.fee,
	},
	// What a `Trade` line names its security by, as Sure's exporter: Sure's
	// all.ndjson has no `Security` line, which its importer refuses.
	securities: {
		id: securities.id,
		isin: securities.isin,
		ticker: securities.ticker,
		mic: securities.mic,
		name: securities.name,
	},
	transaction_attachments: {
		id: transactionAttachments.id,
		transactionId: transactionAttachments.transactionId,
		filename: transactionAttachments.filename,
		contentType: transactionAttachments.contentType,
		byteSize: transactionAttachments.byteSize,
		createdAt: transactionAttachments.createdAt,
	},
	transfers: {
		id: transfers.id,
		outflowTransactionId: transfers.outflowTransactionId,
		inflowTransactionId: transfers.inflowTransactionId,
		kind: transfers.kind,
		createdAt: transfers.createdAt,
	},
	rejected_transfers: {
		id: rejectedTransfers.id,
		outflowTransactionId: rejectedTransfers.outflowTransactionId,
		inflowTransactionId: rejectedTransfers.inflowTransactionId,
		createdAt: rejectedTransfers.createdAt,
	},
	budgets: {
		id: budgets.id,
		month: budgets.month,
		currency: budgets.currency,
		budgetedSpending: budgets.budgetedSpending,
		expectedIncome: budgets.expectedIncome,
		createdAt: budgets.createdAt,
		updatedAt: budgets.updatedAt,
	},
	budget_categories: {
		id: budgetCategories.id,
		budgetId: budgetCategories.budgetId,
		categoryId: budgetCategories.categoryId,
		budgetedSpending: budgetCategories.budgetedSpending,
		rolloverEnabled: budgetCategories.rolloverEnabled,
		createdAt: budgetCategories.createdAt,
		updatedAt: budgetCategories.updatedAt,
	},
	goals: {
		id: goals.id,
		name: goals.name,
		targetAmount: goals.targetAmount,
		currency: goals.currency,
		targetDate: goals.targetDate,
		color: goals.color,
		icon: goals.icon,
		notes: goals.notes,
		state: goals.state,
		kind: goals.kind,
		targetMode: goals.targetMode,
		targetMonths: goals.targetMonths,
		completedAmount: goals.completedAmount,
		completedAt: goals.completedAt,
		createdAt: goals.createdAt,
		updatedAt: goals.updatedAt,
	},
	goal_accounts: {
		goalId: goalAccounts.goalId,
		accountId: goalAccounts.accountId,
		allocatedAmount: goalAccounts.allocatedAmount,
	},
	rules: {
		id: rules.id,
		name: rules.name,
		enabled: rules.enabled,
		effectiveDate: rules.effectiveDate,
		createdAt: rules.createdAt,
		updatedAt: rules.updatedAt,
	},
	rule_conditions: {
		id: ruleConditions.id,
		ruleId: ruleConditions.ruleId,
		parentId: ruleConditions.parentId,
		position: ruleConditions.position,
		conditionType: ruleConditions.conditionType,
		operator: ruleConditions.operator,
		value: ruleConditions.value,
	},
	rule_actions: {
		id: ruleActions.id,
		ruleId: ruleActions.ruleId,
		position: ruleActions.position,
		actionType: ruleActions.actionType,
		value: ruleActions.value,
		replacement: ruleActions.replacement,
	},
};

const SECRETS = "Credentials, sessions or keys: nothing in the archive may let anyone sign in.";

/**
 * What the archive leaves out, and why: a reason per column under its
 * TypeScript key, or one for a whole table under its SQL name.
 */
export const LEFT_OUT = {
	__drizzle_migrations: "Drizzle's record of the migrations applied, not the household's data.",
	accounts: {
		bankAccountId: "The link to a bank connection, which is never exported.",
	},
	assistant_calls: "The log of what assistants did, with their client ids: not money.",
	auth_accounts: SECRETS,
	bank_accounts:
		"Provider ids and IBAN hashes: the archive holds the accounts, never the bank behind them.",
	bank_connections: "Encrypted bank sessions and consent state, useless outside this instance.",
	budget_categories: {
		rolledOverAmount:
			"What the last budget write carried in, which a recategorised transaction leaves stale: the archive computes the chain again.",
	},
	deleted_entry_keys: "Deduplication keys of deleted lines, meaningful to this instance only.",
	entries: {
		importId: "The import that wrote the entry; imports and their raw files never leave.",
	},
	entry_keys: "Deduplication keys, meaningful to this instance only.",
	import_mappings: "A saved CSV column mapping, a setting.",
	imports: "Raw import files and their previews.",
	invitations: SECRETS,
	jwks: SECRETS,
	oauth_access_tokens: SECRETS,
	oauth_client_assertions: SECRETS,
	oauth_client_resources: SECRETS,
	oauth_clients: SECRETS,
	oauth_consents: SECRETS,
	oauth_refresh_tokens: SECRETS,
	oauth_resources: SECRETS,
	rate_limits: "Sign-in throttling.",
	recurring_transactions: {
		labelKey: "The normalised label detection groups by, derived from the label again.",
	},
	rule_runs: "The history of rule applications, as Sure's export leaves it out.",
	securities: {
		currency: "A trade's currency is its account's, which its line carries (AD-6).",
		provider: "Where prices come from, a setting of this instance: Sure picks its own provider.",
		offline: "Fetch bookkeeping, recounted by the next fetches.",
		failedFetchCount: "Fetch bookkeeping, recounted by the next fetches.",
		firstPriceOn: "The provider's first day, which its next fetch finds again.",
		createdAt: "Sure's Trade line names a security without its timestamps.",
		updatedAt: "Sure's Trade line names a security without its timestamps.",
	},
	security_prices:
		"Prices fetched from the provider, which Sure's all.ndjson does not carry: the provider fetches them again.",
	sessions: SECRETS,
	settings: "Instance settings, the saved Enable Banking credentials among them.",
	sign_in_failures: "Sign-in throttling.",
	transactions: {
		expectedTransferAccountId:
			"A rule's « Virement avec » waiting for its other side, read once by the next matching.",
		pendingMissedOn: "Sync bookkeeping for a pending line, recounted by the next sync.",
		pendingMissedSyncs: "Sync bookkeeping for a pending line, recounted by the next sync.",
	},
	transaction_attachments: {
		content:
			"The file itself: the archive lists each attachment, as Sure's manifest does, without its bytes.",
	},
	two_factors: SECRETS,
	users: SECRETS,
	verifications: SECRETS,
} satisfies Record<string, string | Record<string, string>>;

type Reader = Pick<ServiceDeps["db"], "select">;

/** Rows per keyset page of the two tables that grow with history. */
const PAGE_ROWS = 2000;

/** Every account, oldest first, with its balance today; `null` before its opening date. */
export async function exportedAccounts(deps: ServiceDeps) {
	const rows = await deps.db
		.select(EXPORTED_COLUMNS.accounts)
		.from(accounts)
		.orderBy(asc(accounts.createdAt), asc(accounts.id));
	const date = today(deps.timeZone);

	return Promise.all(
		rows.map(async (row) => ({ ...row, balance: await balanceOn(deps, row.id, date) })),
	);
}

/**
 * Every page `read` gives after the last row of the one before, in order,
 * until an empty one. Each is read only when the caller asks for it, so a
 * slow client holds no more than one page.
 */
async function* keysetPages<Row>(
	read: (after: Row | null) => Promise<Row[]>,
	after: Row | null = null,
): AsyncGenerator<Row[]> {
	const page = await read(after);
	const last = page.at(-1);

	if (last === undefined) {
		return;
	}

	yield page;
	yield* keysetPages(read, last);
}

/** Every stored daily balance, by account then day, `size` rows at a time, along the primary key. */
export function balancePages(db: Reader, size = PAGE_ROWS) {
	return keysetPages(async (after: { accountId: string; date: string } | null) =>
		db
			.select(EXPORTED_COLUMNS.balances)
			.from(balances)
			.where(
				after === null
					? undefined
					: sql`(${balances.accountId}, ${balances.date}) > (${after.accountId}, ${after.date})`,
			)
			.orderBy(asc(balances.accountId), asc(balances.date))
			.limit(size),
	);
}

export function exportedCategories(db: Reader) {
	return db.select(EXPORTED_COLUMNS.categories).from(categories).orderBy(asc(categories.name));
}

export function exportedTags(db: Reader) {
	return db.select(EXPORTED_COLUMNS.tags).from(tags).orderBy(asc(tags.name));
}

export function exportedMerchants(db: Reader) {
	return db.select(EXPORTED_COLUMNS.merchants).from(merchants).orderBy(asc(merchants.name));
}

export function exportedRecurring(db: Reader) {
	return db
		.select(EXPORTED_COLUMNS.recurring_transactions)
		.from(recurringTransactions)
		.orderBy(asc(recurringTransactions.createdAt), asc(recurringTransactions.id));
}

/** The tag ids of each transaction of `ids`, sorted. */
async function tagsOf(db: Reader, ids: readonly string[]): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await db
			.select(EXPORTED_COLUMNS.taggings)
			.from(taggings)
			.where(inArray(taggings.transactionId, chunk))
			.orderBy(asc(taggings.tagId));

		for (const row of rows) {
			found.set(row.transactionId, [...(found.get(row.transactionId) ?? []), row.tagId]);
		}
	});

	return found;
}

/**
 * Which rows of a split a page holds: its lines and never its parent, as
 * `transactions.csv` lists them, or its parent with its lines under
 * `splitLines`, as `all.ndjson` nests them (AD-20). An unsplit transaction is
 * in both.
 */
export type SplitView = "lines" | "nested";

type PageKey = { date: string; createdAt: number; id: string };

/** The tag ids and the split lines, empty unless `nested`, of each of `rows`. */
async function withDetails<Row extends { id: string }>(
	db: Reader,
	rows: readonly Row[],
	view: SplitView,
) {
	const ids = rows.map((row) => row.id);
	const lines: Awaited<ReturnType<typeof splitLinesOf>> = [];

	if (view === "nested") {
		await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
			lines.push(...(await splitLinesOf(db, chunk)));
		});
	}

	const tagIds = await tagsOf(db, [...ids, ...lines.map((line) => line.id)]);
	const linesOf = new Map<string | null, ((typeof lines)[number] & { tagIds: string[] })[]>();

	for (const line of lines) {
		linesOf.set(line.parentEntryId, [
			...(linesOf.get(line.parentEntryId) ?? []),
			{ ...line, tagIds: tagIds.get(line.id) ?? [] },
		]);
	}

	return rows.map((row) => ({
		...row,
		tagIds: tagIds.get(row.id) ?? [],
		splitLines: linesOf.get(row.id) ?? [],
	}));
}

/** The split lines of `parentIds`, by creation, as Sure orders them. */
function splitLinesOf(db: Reader, parentIds: readonly string[]) {
	return db
		.select({ ...EXPORTED_COLUMNS.entries, transaction: EXPORTED_COLUMNS.transactions })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(inArray(entries.parentEntryId, [...parentIds]))
		.orderBy(asc(entries.createdAt), asc(entries.id));
}

/**
 * One page of transactions after `after`, by date then creation, each with
 * its tags, its transfer side, and its split lines as `view` says.
 */
async function transactionPage(db: Reader, view: SplitView, size: number, after: PageKey | null) {
	const page = await db
		.select({
			...EXPORTED_COLUMNS.entries,
			transaction: EXPORTED_COLUMNS.transactions,
			// `null` for a transaction outside a transfer, or on its other side.
			outflowOf: { id: asOutflow.id, kind: asOutflow.kind },
			inflowOf: { id: asInflow.id, kind: asInflow.kind },
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(
			and(
				eq(entries.kind, "transaction"),
				view === "lines" ? notSplitParent : isNull(entries.parentEntryId),
				after === null
					? undefined
					: sql`(${entries.date}, ${entries.createdAt}, ${entries.id}) > (${after.date}, ${after.createdAt}, ${after.id})`,
			),
		)
		.orderBy(asc(entries.date), asc(entries.createdAt), asc(entries.id))
		.limit(size);

	return withDetails(db, page, view);
}

/** A transaction as the archive reads it. */
export type ExportedTransactionRow = Awaited<ReturnType<typeof transactionPage>>[number];

/**
 * Every transaction, by date then creation, `size` rows at a time, a split
 * as `view` says. The keyset follows `entries_kind_date`, so a page costs the
 * same at the end of a decade as at its start.
 */
export function transactionPages(db: Reader, view: SplitView, size = PAGE_ROWS) {
	return keysetPages(async (after: PageKey | null) => transactionPage(db, view, size, after));
}

const outflowEntry = alias(entries, "outflow_entry");
const inflowEntry = alias(entries, "inflow_entry");

function sideOf(side: typeof outflowEntry | typeof inflowEntry) {
	return {
		accountId: side.accountId,
		date: side.date,
		amount: side.amount,
		currency: side.currency,
	};
}

/** Every transfer, oldest first, with what Sure checks of its two sides. */
export function exportedTransfers(db: Reader) {
	return db
		.select({
			...EXPORTED_COLUMNS.transfers,
			outflow: sideOf(outflowEntry),
			inflow: sideOf(inflowEntry),
		})
		.from(transfers)
		.innerJoin(outflowEntry, eq(outflowEntry.id, transfers.outflowTransactionId))
		.innerJoin(inflowEntry, eq(inflowEntry.id, transfers.inflowTransactionId))
		.orderBy(asc(transfers.createdAt), asc(transfers.id));
}

export function exportedRejectedTransfers(db: Reader) {
	return db
		.select(EXPORTED_COLUMNS.rejected_transfers)
		.from(rejectedTransfers)
		.orderBy(asc(rejectedTransfers.createdAt), asc(rejectedTransfers.id));
}

/** Every trade with its security, by date then creation, as `transactions.csv` orders its lines. */
export function exportedTrades(db: Reader) {
	return db
		.select({
			...EXPORTED_COLUMNS.entries,
			trade: EXPORTED_COLUMNS.trades,
			security: EXPORTED_COLUMNS.securities,
		})
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.innerJoin(securities, eq(securities.id, trades.securityId))
		.orderBy(asc(entries.date), asc(entries.createdAt), asc(entries.id));
}

/**
 * Every valuation, by account and day. An opening anchor carries the stored
 * balance of its day, `dayBalance`: a bank-linked account is computed
 * backward and never reads its anchor's amount (AD-8), so that balance is the
 * only figure true of both kinds of account. `null` on every other row.
 */
export async function exportedValuations(deps: ServiceDeps) {
	const rows = await deps.db
		.select(EXPORTED_COLUMNS.entries)
		.from(entries)
		.where(eq(entries.kind, "valuation"))
		.orderBy(asc(entries.accountId), asc(entries.date), asc(entries.createdAt), asc(entries.id));

	return Promise.all(
		rows.map(async (row) => ({
			...row,
			dayBalance:
				row.valuationKind === "opening_anchor"
					? await balanceOn(deps, row.accountId, row.date)
					: null,
		})),
	);
}

export function exportedBudgets(db: Reader) {
	return db.select(EXPORTED_COLUMNS.budgets).from(budgets).orderBy(asc(budgets.month));
}

/** Every category amount of every month, with its month and that budget's currency. */
export function exportedBudgetCategories(db: Reader) {
	return db
		.select({
			...EXPORTED_COLUMNS.budget_categories,
			month: EXPORTED_COLUMNS.budgets.month,
			currency: EXPORTED_COLUMNS.budgets.currency,
		})
		.from(budgetCategories)
		.innerJoin(budgets, eq(budgets.id, budgetCategories.budgetId))
		.orderBy(asc(budgets.month), asc(budgetCategories.createdAt), asc(budgetCategories.id));
}

export function exportedGoals(db: Reader) {
	return db.select(EXPORTED_COLUMNS.goals).from(goals).orderBy(asc(goals.createdAt), asc(goals.id));
}

/** Every goal's links, with that goal's currency, by goal then account. */
export function exportedGoalAccounts(db: Reader) {
	return db
		.select({ ...EXPORTED_COLUMNS.goal_accounts, currency: EXPORTED_COLUMNS.goals.currency })
		.from(goalAccounts)
		.innerJoin(goals, eq(goals.id, goalAccounts.goalId))
		.orderBy(asc(goals.createdAt), asc(goalAccounts.goalId), asc(goalAccounts.accountId));
}

/** Every rule in application order, with its conditions and actions in the form's order. */
export async function exportedRules(db: Reader) {
	const [ruleRows, conditionRows, actionRows] = await Promise.all([
		db.select(EXPORTED_COLUMNS.rules).from(rules).orderBy(asc(rules.createdAt), asc(rules.id)),
		db
			.select(EXPORTED_COLUMNS.rule_conditions)
			.from(ruleConditions)
			.orderBy(asc(ruleConditions.position), asc(ruleConditions.id)),
		db
			.select(EXPORTED_COLUMNS.rule_actions)
			.from(ruleActions)
			.orderBy(asc(ruleActions.position), asc(ruleActions.id)),
	]);

	return ruleRows.map((rule) => ({
		...rule,
		conditions: conditionRows.filter((condition) => condition.ruleId === rule.id),
		actions: actionRows.filter((action) => action.ruleId === rule.id),
	}));
}

/**
 * Every attachment, without its bytes, with its transaction's account, by
 * transaction, name and id, as Sure's manifest sorts them.
 */
export function exportedAttachments(db: Reader) {
	return db
		.select({ ...EXPORTED_COLUMNS.transaction_attachments, accountId: entries.accountId })
		.from(transactionAttachments)
		.innerJoin(entries, eq(entries.id, transactionAttachments.transactionId))
		.orderBy(
			asc(transactionAttachments.transactionId),
			asc(transactionAttachments.filename),
			asc(transactionAttachments.id),
		);
}
