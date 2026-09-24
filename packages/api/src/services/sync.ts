import type { BankStatement } from "../connectors/bank-connector.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";
import type { ErrorCode } from "../lib/errors.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";

import { and, asc, eq, isNull, lt, or } from "drizzle-orm";

import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { addDays, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { logFailure, requireBankConnector } from "./bank-connections.ts";
import { ingest } from "./ledger.ts";
import { detectRecurring } from "./recurring.ts";

/** A run that crashed leaves its lease behind; after this long, it is free again. */
export const LEASE_MS = 10 * 60 * 1000;

/** Two syncs of one connection at least this far apart: banks cap unattended reads per day. */
export const MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Sure's first window: three months of history for an account never synced. */
export const FIRST_WINDOW_DAYS = 90;

/** Each window starts this far before the last sync, for lines a bank books late. */
export const OVERLAP_DAYS = 7;

/** Who asked: the connection's button refuses what the cron quietly skips. */
export type SyncTrigger = "button" | "cron";

export type SyncResult = "synced" | "failed" | "skipped";

/** A connection's sync state, as its page shows it. */
export type SyncStatus = { lastSyncedAt: number | null; lastError: string | null };

/**
 * The first day a bank account's window reads: its own last sync minus the
 * overlap, or three months back when it never synced. Per bank account, not
 * per connection: an account that keeps failing would otherwise come back
 * with a gap once the others moved on.
 */
export function windowStart(lastSyncedAt: number | null, day: IsoDate, timeZone: string): IsoDate {
	return lastSyncedAt === null
		? addDays(day, -FIRST_WINDOW_DAYS)
		: addDays(today(timeZone, new Date(lastSyncedAt)), -OVERLAP_DAYS);
}

/** The statement as the ledger takes it: a balance that names no day is today's. */
function toParsedStatement(statement: BankStatement, day: IsoDate): ParsedStatement {
	const { balance } = statement;

	return {
		...statement,
		balance: balance === null ? null : { ...balance, date: balance.date ?? day },
	};
}

const codeOf = (error: unknown): ErrorCode =>
	error instanceof AppError ? error.code : "INTERNAL_ERROR";

/**
 * Takes the lease in one statement, so two runs cannot both hold it: free,
 * or older than ten minutes, and the connection not synced within the hour.
 */
async function takeLease(deps: BankConnectionDeps, connectionId: string, now: number) {
	const [taken] = await deps.db
		.update(bankConnections)
		.set({ syncStartedAt: now })
		.where(
			and(
				eq(bankConnections.id, connectionId),
				or(
					isNull(bankConnections.syncStartedAt),
					lt(bankConnections.syncStartedAt, now - LEASE_MS),
				),
				or(
					isNull(bankConnections.lastSyncedAt),
					lt(bankConnections.lastSyncedAt, now - MIN_INTERVAL_MS),
				),
			),
		)
		.returning({ id: bankConnections.id });

	return taken !== undefined;
}

/** Why the lease was refused: a run holds it, or the last one is too recent. */
function refusal(syncStartedAt: number | null, now: number): AppError {
	return syncStartedAt !== null && syncStartedAt >= now - LEASE_MS
		? new AppError("SYNC_IN_PROGRESS", "This bank connection is already syncing.")
		: new AppError("SYNC_TOO_RECENT", "This bank connection synced less than an hour ago.");
}

/**
 * Syncs every linked bank account of the connection whose account is active,
 * one `ingest` each: a failed account rolls back alone and keeps its window.
 * The connection's last sync moves only when every account succeeded; its
 * last error holds the latest failed run's code. Recurring detection runs
 * once, after every account, and never fails the sync.
 */
async function runSync(
	deps: BankConnectionDeps,
	connectionId: string,
	startedAt: number,
): Promise<{ failed: number; created: number; synced: number }> {
	const { connector } = requireBankConnector(deps);
	const day = today(deps.timeZone, new Date(startedAt));
	const linked = await deps.db
		.select({
			bankAccountId: bankAccounts.id,
			providerUid: bankAccounts.providerUid,
			lastSyncedAt: bankAccounts.lastSyncedAt,
			accountId: accounts.id,
		})
		.from(bankAccounts)
		.innerJoin(accounts, eq(accounts.bankAccountId, bankAccounts.id))
		.where(and(eq(bankAccounts.bankConnectionId, connectionId), eq(accounts.active, true)))
		.orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id));
	const errors: ErrorCode[] = [];
	let created = 0;

	// In sequence: every ingest takes the write lock, and a bank reads one
	// account at a time anyway.
	await linked.reduce<Promise<void>>(async (previous, item) => {
		await previous;

		try {
			const statement = await connector.fetchStatement(
				item.providerUid,
				windowStart(item.lastSyncedAt, day, deps.timeZone),
			);
			const result = await ingest(
				deps,
				item.accountId,
				toParsedStatement(statement, day),
				{ connectionId },
				{ origin: "sync" },
			);

			await deps.db
				.update(bankAccounts)
				.set({ lastSyncedAt: startedAt })
				.where(eq(bankAccounts.id, item.bankAccountId));
			created += result.created.length;
			deps.logger.info(
				{
					connectionId,
					accountId: item.accountId,
					created: result.created.length,
					matched: result.groups.matched.length,
					present: result.groups.present.length,
					duplicates: result.groups.duplicates.length,
					rejected: result.rejected.length,
				},
				"bank account synced",
			);
		} catch (error) {
			const code = codeOf(error);

			errors.push(code);
			logFailure(deps, connectionId, error);
			deps.logger.warn(
				{ connectionId, accountId: item.accountId, code },
				"bank account sync failed",
			);
		}
	}, Promise.resolve());

	const [firstError] = errors;

	// Nothing linked yet, nothing synced: stamped, the connection would refuse
	// the sync that follows its first link for an hour.
	if (linked.length === 0) {
		return { failed: 0, created: 0, synced: 0 };
	}

	await deps.db
		.update(bankConnections)
		.set(
			firstError === undefined
				? { lastSyncedAt: startedAt, lastError: null, updatedAt: Date.now() }
				: { lastError: firstError, updatedAt: Date.now() },
		)
		.where(eq(bankConnections.id, connectionId));

	if (linked.length > errors.length) {
		try {
			await detectRecurring(deps);
		} catch (error) {
			// The code only: an unexpected error's message may embed bound amounts.
			deps.logger.error({ connectionId, code: codeOf(error) }, "recurring detection failed");
		}
	}

	return { failed: errors.length, created, synced: linked.length - errors.length };
}

type Connection = { id: string; consentExpiresAt: number | null; syncStartedAt: number | null };

/**
 * One connection's sync, lease taken and released here. The button refuses a
 * held lease with `SYNC_IN_PROGRESS` and a sync within the hour with
 * `SYNC_TOO_RECENT`; the cron skips both, and every connection whose consent
 * has ended.
 */
async function syncOne(
	deps: BankConnectionDeps,
	connection: Connection,
	trigger: SyncTrigger,
): Promise<SyncResult> {
	const startedAt = Date.now();

	// Nothing to read without consent; renewal is Story 10.5's.
	if (connection.consentExpiresAt !== null && connection.consentExpiresAt <= startedAt) {
		deps.logger.info({ connectionId: connection.id, trigger }, "bank sync skipped: consent ended");

		return "skipped";
	}

	if (!(await takeLease(deps, connection.id, startedAt))) {
		const current = await deps.db
			.select({ syncStartedAt: bankConnections.syncStartedAt })
			.from(bankConnections)
			.where(eq(bankConnections.id, connection.id))
			.get();
		const error = refusal(current?.syncStartedAt ?? connection.syncStartedAt, startedAt);

		deps.logger.info(
			{ connectionId: connection.id, trigger, code: error.code },
			"bank sync skipped",
		);

		if (trigger === "button") {
			throw error;
		}

		return "skipped";
	}

	try {
		const outcome = await runSync(deps, connection.id, startedAt);

		deps.logger.info(
			{ connectionId: connection.id, trigger, ...outcome, durationMs: Date.now() - startedAt },
			"bank connection synced",
		);

		return outcome.failed === 0 ? "synced" : "failed";
	} finally {
		// Only this run's lease: a run that outlived it may have lost it to another.
		await deps.db
			.update(bankConnections)
			.set({ syncStartedAt: null })
			.where(
				and(eq(bankConnections.id, connection.id), eq(bankConnections.syncStartedAt, startedAt)),
			);
	}
}

const connectionColumns = {
	id: bankConnections.id,
	consentExpiresAt: bankConnections.consentExpiresAt,
	syncStartedAt: bankConnections.syncStartedAt,
};

/**
 * The connection's « Synchroniser » button: syncs it now and answers its
 * state. `NOT_FOUND` for a connection that is not active.
 */
export async function syncConnection(
	deps: BankConnectionDeps,
	connectionId: string,
	trigger: SyncTrigger = "button",
): Promise<SyncStatus> {
	requireBankConnector(deps);

	const connection = await deps.db
		.select(connectionColumns)
		.from(bankConnections)
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.status, "active")))
		.get();

	if (connection === undefined) {
		throw new AppError("NOT_FOUND", "No bank connection has this id.");
	}

	await syncOne(deps, connection, trigger);

	const status = await deps.db
		.select({ lastSyncedAt: bankConnections.lastSyncedAt, lastError: bankConnections.lastError })
		.from(bankConnections)
		.where(eq(bankConnections.id, connectionId))
		.get();

	return status ?? { lastSyncedAt: null, lastError: null };
}

/**
 * The scheduled sync: every active connection in turn, oldest first. A
 * connection that fails never stops the next one.
 */
export async function syncAll(
	deps: BankConnectionDeps,
): Promise<{ id: string; result: SyncResult }[]> {
	requireBankConnector(deps);

	const connections = await deps.db
		.select(connectionColumns)
		.from(bankConnections)
		.where(eq(bankConnections.status, "active"))
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
	const results: { id: string; result: SyncResult }[] = [];

	await connections.reduce<Promise<void>>(async (previous, connection) => {
		await previous;

		try {
			results.push({ id: connection.id, result: await syncOne(deps, connection, "cron") });
		} catch (error) {
			deps.logger.error({ connectionId: connection.id, code: codeOf(error) }, "bank sync failed");
			results.push({ id: connection.id, result: "failed" });
		}
	}, Promise.resolve());

	return results;
}
