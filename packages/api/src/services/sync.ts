import type { BankBalance, BankConnector, BankStatement } from "../connectors/bank-connector.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";
import type { ErrorCode } from "../lib/errors.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";

import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";

import { isCurrencyCode } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { BankProviderError } from "../connectors/bank-connector.ts";
import { addDays, addMonths, daysBetween, minDate, startOfDay, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import {
	LEASE_MS,
	codeOf,
	logFailure,
	logOtherCurrencies,
	readableSessionId,
} from "./bank-connections.ts";
import { resolveBankConnector } from "./bank-credentials.ts";
import { ingest } from "./ledger/ingest.ts";
import { oldestPendingDate } from "./ledger/snapshots.ts";
import { runRecurring } from "./recurring/pipeline.ts";

/** Two syncs of one connection at least this far apart: banks cap unattended reads per day. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The first window of an account never synced, when its connection names no
 * start date: Sure's `3.months.ago`, the default its setup page offers too.
 */
const FIRST_WINDOW_MONTHS = 3;

/** Each window starts this far before the last sync, for lines a bank books late. */
const OVERLAP_DAYS = 7;

/**
 * Who asked: the connection's button refuses what the cron and the first
 * visit of the day quietly skip.
 */
type SyncTrigger = "button" | "cron" | "auto" | "settings";

export type SyncResult = "synced" | "failed" | "skipped" | "consent_expired";

/** A connection's sync state, as its page shows it. */
export type SyncStatus = { lastSyncedAt: number | null; lastError: string | null };

/**
 * The first day a bank account's window reads: its own last sync minus the
 * overlap or, when it never synced, its connection's start date, three
 * months back without one. Sure's `determine_sync_start_date`: a start date chosen
 * later never re-reads a synced account's past. Per bank account, not per
 * connection: an account that keeps failing would otherwise come back with a
 * gap once the others moved on. Never after its oldest pending entry: a line
 * the window leaves out would count as missed, and a hotel pre-authorisation
 * older than the overlap would go while still pending.
 */
export function windowStart(
	lastSyncedAt: number | null,
	day: IsoDate,
	timeZone: string,
	oldestPending: IsoDate | null,
	syncStartDate: IsoDate | null,
): IsoDate {
	const start =
		lastSyncedAt === null
			? (syncStartDate ?? addMonths(day, -FIRST_WINDOW_MONTHS))
			: addDays(today(timeZone, new Date(lastSyncedAt)), -OVERLAP_DAYS);

	return oldestPending === null ? start : minDate(start, oldestPending);
}

/**
 * The read and its balance, read apart, as the ledger takes them: a balance
 * that names no day is today's.
 */
function toParsedStatement(
	statement: BankStatement,
	balance: BankBalance | null,
	day: IsoDate,
): ParsedStatement {
	return {
		transactions: statement.transactions,
		rejected: statement.rejected,
		balance:
			balance === null
				? null
				: { amount: balance.amount, currency: balance.currency, date: balance.date ?? day },
	};
}

/**
 * Takes the lease in one statement, so two runs cannot both hold it: free,
 * or older than ten minutes, and the connection not synced within the hour
 * unless a consent was renewed since its last sync (AD-18), so the renewal
 * can be checked at once. Taking the lease spends that exception, and counts
 * as the day's attempt. `anyInterval` skips the hour, never the lease: a
 * setting that changes how balances read syncs at once, as Sure's `sync_later`.
 */
async function takeLease(
	deps: BankConnectionDeps,
	connectionId: string,
	now: number,
	anyInterval = false,
) {
	const [taken] = await deps.db
		.update(bankConnections)
		// The renewal's exception is spent by the run it lets through, whatever
		// that run's outcome: a sync that keeps failing must not skip the hour
		// on every press.
		.set({ syncStartedAt: now, syncAttemptedAt: now, authorizedAt: null })
		.where(
			and(
				eq(bankConnections.id, connectionId),
				or(
					isNull(bankConnections.syncStartedAt),
					lt(bankConnections.syncStartedAt, now - LEASE_MS),
				),
				anyInterval
					? undefined
					: or(
							isNull(bankConnections.lastSyncedAt),
							lt(bankConnections.lastSyncedAt, now - MIN_INTERVAL_MS),
							lt(bankConnections.lastSyncedAt, bankConnections.authorizedAt),
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
 * A read that stops after its first page writes the lines read, counts no
 * pending entry missing and keeps its window too, so the next read starts
 * where this one did. The balance is read after a complete read only, and a
 * balance the bank does not give costs the balance alone. The connection's
 * last sync moves only when every account succeeded; its last error holds
 * the first failed account's code, else `BANK_BALANCE_UNAVAILABLE` when a
 * balance was missing. The recurring pipeline runs once, after every
 * account, and never fails the sync.
 */
async function runSync(
	deps: BankConnectionDeps,
	connector: BankConnector,
	connectionId: string,
	startedAt: number,
): Promise<{ failed: number; created: number; synced: number }> {
	const day = today(deps.timeZone, new Date(startedAt));
	const connection = await deps.db
		.select({ syncStartDate: bankConnections.syncStartDate })
		.from(bankConnections)
		.where(eq(bankConnections.id, connectionId))
		.get();
	const linked = await deps.db
		.select({
			bankAccountId: bankAccounts.id,
			providerUid: bankAccounts.providerUid,
			lastSyncedAt: bankAccounts.lastSyncedAt,
			accountId: accounts.id,
			currency: accounts.currency,
		})
		.from(bankAccounts)
		.innerJoin(accounts, eq(accounts.bankAccountId, bankAccounts.id))
		// Sure's `linked_accounts_query`: an account a renewal left out is still
		// read under its last uid, and a refusal fails the run as Sure's syncer
		// does, rather than letting the account stop without a word.
		.where(and(eq(bankAccounts.bankConnectionId, connectionId), eq(accounts.active, true)))
		.orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id));
	const errors: ErrorCode[] = [];
	let created = 0;
	let balanceMissing = false;

	/**
	 * The balance after a complete read, in the account's currency when the
	 * bank lists several; `null`, logged by its code, when the bank fails it.
	 * Anything else is no answer from the bank and fails the account.
	 */
	const readBalance = async (
		uid: string,
		accountId: string,
		currency: string,
	): Promise<BankBalance | null> => {
		try {
			const balance = await connector.fetchBalance(uid, isCurrencyCode(currency) ? currency : null);

			logOtherCurrencies(deps, { connectionId, accountId }, balance);

			return balance;
		} catch (error) {
			if (!(error instanceof BankProviderError)) {
				throw error;
			}

			balanceMissing = true;
			logFailure(deps, connectionId, error);
			deps.logger.warn(
				{ connectionId, accountId, code: codeOf(error) },
				"bank account balance unavailable",
			);

			return null;
		}
	};

	// In sequence: every ingest takes the write lock, and a bank reads one
	// account at a time anyway.
	await linked.reduce<Promise<void>>(async (previous, item) => {
		await previous;

		try {
			const since = windowStart(
				item.lastSyncedAt,
				day,
				deps.timeZone,
				await oldestPendingDate(deps, item.accountId, connectionId),
				connection?.syncStartDate ?? null,
			);
			const statement = await connector.fetchStatement(item.providerUid, since, day);
			const { interrupted } = statement;

			if (statement.from !== since) {
				deps.logger.info(
					{ connectionId, accountId: item.accountId, windowDays: daysBetween(statement.from, day) },
					"bank account window shortened",
				);
			}

			const balance =
				interrupted === null
					? await readBalance(item.providerUid, item.accountId, item.currency)
					: null;
			// Read before `ingest`, so the lines and the anchor commit together.
			const result = await ingest(
				deps,
				item.accountId,
				toParsedStatement(statement, balance, day),
				{ connectionId, missesFrom: interrupted === null ? statement.from : null },
				{ origin: "sync" },
			);

			created += result.created.length;

			if (interrupted !== null) {
				const code = codeOf(interrupted);

				errors.push(code);
				logFailure(deps, connectionId, interrupted);
				deps.logger.warn(
					{
						connectionId,
						accountId: item.accountId,
						code,
						lines: statement.transactions.length,
						created: result.created.length,
					},
					"bank account read interrupted",
				);

				return;
			}

			await deps.db
				.update(bankAccounts)
				.set({ lastSyncedAt: startedAt })
				.where(eq(bankAccounts.id, item.bankAccountId));
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
				? {
						lastSyncedAt: startedAt,
						lastError: balanceMissing ? "BANK_BALANCE_UNAVAILABLE" : null,
						updatedAt: Date.now(),
					}
				: { lastError: firstError, updatedAt: Date.now() },
		)
		.where(eq(bankConnections.id, connectionId));

	if (linked.length > errors.length) {
		try {
			await runRecurring(deps, { backfill: false });
		} catch (error) {
			// The code only: an unexpected error's message may embed bound amounts.
			deps.logger.error({ connectionId, code: codeOf(error) }, "recurring detection failed");
		}
	}

	return { failed: errors.length, created, synced: linked.length - errors.length };
}

type Connection = { id: string; consentExpiresAt: number | null; syncStartedAt: number | null };

/** The connector and the key its connection's session id is decrypted with. */
type Bank = { connector: BankConnector; encryptionKey: Uint8Array };

/** What Sure's `fetch_session_data` may answer for a session, besides a valid one. */
const REFUSED_SESSION = new Set([401, 404]);

/**
 * Sure's `fetch_session_data`, before any account is read: the session as
 * the provider holds it. A valid one updates the stored consent end when it
 * names one that moved, and answers `null`. A 401 or a 404, or a stored session id that no
 * longer decrypts, which only a renewal replaces, ends the consent now, as
 * Sure's `requires_update`: every reader then asks for a reconnection.
 * Any other failure is the run's error, and no account is read.
 */
async function readSession(
	deps: BankConnectionDeps,
	{ connector, encryptionKey }: Bank,
	connectionId: string,
	startedAt: number,
): Promise<"consent_expired" | "failed" | null> {
	const stored = await deps.db
		.select({
			sessionId: bankConnections.sessionId,
			consentExpiresAt: bankConnections.consentExpiresAt,
		})
		.from(bankConnections)
		.where(eq(bankConnections.id, connectionId))
		.get();
	const sessionId =
		stored?.sessionId === null || stored?.sessionId === undefined
			? null
			: readableSessionId(
					deps,
					encryptionKey,
					connectionId,
					stored.sessionId,
					"bank session unreadable",
				);

	if (sessionId !== null) {
		let session: { consentExpiresAt: number | null } | null;

		// The provider call alone: a local write failing below is no provider answer.
		try {
			session = await connector.readSession(sessionId);
		} catch (error) {
			logFailure(deps, connectionId, error);

			if (!(error instanceof BankProviderError && REFUSED_SESSION.has(error.failure.status ?? 0))) {
				const code = codeOf(error);

				await deps.db
					.update(bankConnections)
					.set({ lastError: code, updatedAt: Date.now() })
					.where(eq(bankConnections.id, connectionId));
				deps.logger.warn({ connectionId, code }, "bank session read failed");

				return "failed";
			}

			session = null;
		}

		if (session !== null) {
			const { consentExpiresAt } = session;

			// No end in the answer keeps the stored one, as Sure's `reconcile_session_expiry!`.
			if (consentExpiresAt !== null && consentExpiresAt !== stored?.consentExpiresAt) {
				await deps.db
					.update(bankConnections)
					.set({ consentExpiresAt, updatedAt: Date.now() })
					.where(eq(bankConnections.id, connectionId));
			}

			return null;
		}
	}

	await deps.db
		.update(bankConnections)
		.set({ consentExpiresAt: startedAt, lastError: "CONSENT_EXPIRED", updatedAt: Date.now() })
		.where(eq(bankConnections.id, connectionId));
	deps.logger.info({ connectionId, code: "CONSENT_EXPIRED" }, "bank consent revoked");

	return "consent_expired";
}

/**
 * The run of a connection whose lease was taken at `startedAt`, released
 * here: the session first, then every account.
 */
async function runLeased(
	deps: BankConnectionDeps,
	bank: Bank,
	connectionId: string,
	startedAt: number,
	trigger: SyncTrigger,
): Promise<SyncResult> {
	try {
		const stopped = await readSession(deps, bank, connectionId, startedAt);

		if (stopped !== null) {
			deps.logger.info(
				{ connectionId, trigger, result: stopped, durationMs: Date.now() - startedAt },
				"bank connection not synced",
			);

			return stopped;
		}

		const outcome = await runSync(deps, bank.connector, connectionId, startedAt);

		deps.logger.info(
			{ connectionId, trigger, ...outcome, durationMs: Date.now() - startedAt },
			"bank connection synced",
		);

		return outcome.failed === 0 ? "synced" : "failed";
	} finally {
		// Only this run's lease: a run that outlived it may have lost it to another.
		await deps.db
			.update(bankConnections)
			.set({ syncStartedAt: null })
			.where(
				and(eq(bankConnections.id, connectionId), eq(bankConnections.syncStartedAt, startedAt)),
			);
	}
}

const consentExpired = () =>
	new AppError("CONSENT_EXPIRED", "This bank connection's consent has expired.");

/**
 * One connection's sync, lease taken and released here. The button refuses a
 * held lease with `SYNC_IN_PROGRESS` and a sync within the hour with
 * `SYNC_TOO_RECENT`; the cron skips both. An ended consent reads nothing and
 * writes nothing, and a session the provider refuses ends it: the button
 * answers `CONSENT_EXPIRED`, the cron reports it.
 */
async function syncOne(
	deps: BankConnectionDeps,
	bank: Bank,
	connection: Connection,
	trigger: SyncTrigger,
): Promise<SyncResult> {
	const startedAt = Date.now();

	// Nothing to read without consent, and nothing deleted: a renewal picks
	// the connection up where it stopped.
	if (connection.consentExpiresAt !== null && connection.consentExpiresAt <= startedAt) {
		deps.logger.info(
			{ connectionId: connection.id, trigger, code: "CONSENT_EXPIRED" },
			"bank sync skipped",
		);

		if (trigger === "button") {
			throw consentExpired();
		}

		return "consent_expired";
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

	const result = await runLeased(deps, bank, connection.id, startedAt, trigger);

	if (result === "consent_expired" && trigger === "button") {
		throw consentExpired();
	}

	return result;
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
): Promise<SyncStatus> {
	const bank = await resolveBankConnector(deps);

	const connection = await deps.db
		.select(connectionColumns)
		.from(bankConnections)
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.status, "active")))
		.get();

	if (connection === undefined) {
		throw new AppError("NOT_FOUND", "No bank connection has this id.");
	}

	await syncOne(deps, bank, connection, "button");

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
	// Once for the whole run: every connection syncs under the same credentials.
	const bank = await resolveBankConnector(deps);

	const connections = await deps.db
		.select(connectionColumns)
		.from(bankConnections)
		.where(eq(bankConnections.status, "active"))
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
	const results: { id: string; result: SyncResult }[] = [];

	await connections.reduce<Promise<void>>(async (previous, connection) => {
		await previous;

		try {
			results.push({
				id: connection.id,
				result: await syncOne(deps, bank, connection, "cron"),
			});
		} catch (error) {
			deps.logger.error({ connectionId: connection.id, code: codeOf(error) }, "bank sync failed");
			results.push({ id: connection.id, result: "failed" });
		}
	}, Promise.resolve());

	return results;
}

/** The first visit's leases, and the run that syncs them once the request has answered. */
export type DailySync = {
	/** The connections whose lease this visit took, oldest first. */
	leased: string[];
	/** Syncs them one after another; never rejects, each failure is logged. */
	run: () => Promise<void>;
};

const NOTHING_TO_SYNC: DailySync = { leased: [], run: async () => {} };

/**
 * Sure's `AutoSync`: the first authenticated request of the day, in the
 * app's zone, syncs each active connection with an unexpired consent and no
 * attempt since that day's midnight. Only the selection and the leases are
 * awaited, local writes; the bank is read by `run`, which the caller starts
 * once it has answered. A lease refused, held or within the hour, is skipped
 * without a word, as the cron skips it: a request comes on every page, and
 * the next one after the hour takes it. Nothing is selected while the bank
 * connector is unconfigured.
 */
export async function startDailySync(deps: BankConnectionDeps): Promise<DailySync> {
	// No key, no connector: every request of an install without a bank ends here.
	if (deps.encryptionKey === null) {
		return NOTHING_TO_SYNC;
	}

	const now = Date.now();
	const due = await deps.db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(
			and(
				eq(bankConnections.status, "active"),
				or(isNull(bankConnections.consentExpiresAt), gt(bankConnections.consentExpiresAt, now)),
				or(
					isNull(bankConnections.syncAttemptedAt),
					lt(bankConnections.syncAttemptedAt, startOfDay(deps.timeZone, now)),
				),
			),
		)
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));

	if (due.length === 0) {
		return NOTHING_TO_SYNC;
	}

	let bank: Bank;

	try {
		bank = await resolveBankConnector(deps);
	} catch (error) {
		if (error instanceof AppError && error.code === "BANK_CONNECTOR_UNAVAILABLE") {
			return NOTHING_TO_SYNC;
		}

		throw error;
	}

	return leaseAll(
		deps,
		bank,
		due.map(({ id }) => id),
		now,
		"auto",
	);
}

/**
 * Takes the lease of each connection it can, quietly skipping one held or,
 * but for a setting's sync, synced within the hour, and returns the run that
 * syncs those it took.
 */
async function leaseAll(
	deps: BankConnectionDeps,
	bank: Bank,
	ids: readonly string[],
	now: number,
	trigger: SyncTrigger,
): Promise<DailySync> {
	// In turn: each `takeLease` is one statement, so of two requests racing
	// here only one holds any given connection.
	const leased = await ids.reduce<Promise<string[]>>(async (previous, id) => {
		const taken = await previous;

		return (await takeLease(deps, id, now, trigger === "settings")) ? [...taken, id] : taken;
	}, Promise.resolve([]));

	return {
		leased,
		run: () =>
			// One after another, as `syncAll` runs them.
			leased.reduce<Promise<void>>(async (previous, connectionId) => {
				await previous;

				try {
					await runLeased(deps, bank, connectionId, now, trigger);
				} catch (error) {
					deps.logger.error({ connectionId, code: codeOf(error) }, "bank sync failed");
				}
			}, Promise.resolve()),
	};
}

/**
 * Sure's `sync_later` after a setting that changes how a connection's
 * balances read: its lease taken now, the bank read by `run`, which the
 * caller starts once it has answered, within the hour of the last sync too,
 * as Sure's has no such wait. Skipped without a word, as the daily sync skips
 * it, when the connection is not active, its consent has ended, its lease is
 * held, or no connector is set up.
 */
export async function startConnectionSync(
	deps: BankConnectionDeps,
	connectionId: string,
): Promise<DailySync> {
	if (deps.encryptionKey === null) {
		return NOTHING_TO_SYNC;
	}

	const now = Date.now();
	const connection = await deps.db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(
			and(
				eq(bankConnections.id, connectionId),
				eq(bankConnections.status, "active"),
				or(isNull(bankConnections.consentExpiresAt), gt(bankConnections.consentExpiresAt, now)),
			),
		)
		.get();

	if (connection === undefined) {
		return NOTHING_TO_SYNC;
	}

	let bank: Bank;

	try {
		bank = await resolveBankConnector(deps);
	} catch (error) {
		if (error instanceof AppError && error.code === "BANK_CONNECTOR_UNAVAILABLE") {
			return NOTHING_TO_SYNC;
		}

		throw error;
	}

	return leaseAll(deps, bank, [connection.id], now, "settings");
}
