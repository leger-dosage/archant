import type { BankConnector } from "../connectors/bank-connector.ts";
import type { ConnectionAlert } from "../domain/bank-connection-alert.ts";
import type { Env } from "../env.ts";
import type { ErrorCode, FieldError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import type {
	CompleteConnectionInput,
	LinkBankAccountsInput,
	StartConnectionInput,
} from "../schemas/bank-connections.ts";
import type { ServiceDeps } from "./deps.ts";
import type { AnchorBalance } from "./ledger.ts";
import type { AnyColumn } from "drizzle-orm";

import { and, asc, eq, gte, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AccountSubtype, AccountType, BankAccountTarget } from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import type { BankConnectionStatus } from "@archant/data/schema/bank-connections";
import { bankConnections } from "@archant/data/schema/bank-connections";
import type { Account, BankAccount } from "@archant/data/types";

import { BankProviderError } from "../connectors/bank-connector.ts";
import { createBankConnector } from "../connectors/registry.ts";
import { toStoredBankBalance } from "../domain/balances/stored-balance.ts";
import { isLinkCandidate, suggestedTarget } from "../domain/bank-accounts.ts";
import { connectionAlert } from "../domain/bank-connection-alert.ts";
import { addMonths, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { createAccount, linkBankAccount, unlinkBankAccount } from "./ledger.ts";

/** The value an upsert tried to insert into `column`, named from the schema. */
const excluded = (column: AnyColumn) => sql`excluded.${sql.identifier(column.name)}`;

/** Where the bank sends the browser back: a page of the interface, not an API route. */
export const REDIRECT_PATH = "/settings/banks/callback";

/** How long a `state` stays valid: time enough to sign in at the bank, no more. */
export const AUTHORIZATION_TTL_MS = 30 * 60 * 1000;

/** A run that crashed leaves its sync lease behind; after this long, it is free again. */
export const LEASE_MS = 10 * 60 * 1000;

/** What is needed to connect a bank, and which of it is missing. */
export type BankConnectionDeps = ServiceDeps & {
	logger: Logger;
	/** `null` while a variable is missing: every bank route but `setup` then answers 503. */
	bankConnector: BankConnector | null;
	/** `ENCRYPTION_KEY`, 32 bytes. */
	encryptionKey: Uint8Array | null;
	/** The unset variables' names, never their values. */
	bankSetup: readonly string[];
	/** `BETTER_AUTH_URL` + `REDIRECT_PATH`, registered with the provider. */
	redirectUrl: string;
};

export type BankSetup = { available: boolean; missing: string[] };

export type InstitutionRecord = {
	name: string;
	country: string;
	logo: string | null;
	bic: string | null;
};

/** A connection as the API returns it: no session id, no state. */
export type BankConnectionRecord = {
	id: string;
	connector: string;
	institutionName: string;
	country: string;
	status: BankConnectionStatus;
	consentExpiresAt: number | null;
	/** Epoch milliseconds of the last run where every account synced. */
	lastSyncedAt: number | null;
	/** The error code of the latest failed run, `null` once a run succeeds. */
	lastError: string | null;
	/** The banner the connection shows, `null` for none. */
	alert: ConnectionAlert | null;
	createdAt: number;
};

type BankEnv = Pick<
	Env,
	| "ENABLE_BANKING_APPLICATION_ID"
	| "ENABLE_BANKING_PRIVATE_KEY"
	| "ENCRYPTION_KEY"
	| "ENABLE_BANKING_API_URL"
	| "BETTER_AUTH_URL"
>;

/** The bank part of the app's dependencies, from the validated environment. */
export function bankDepsFromEnv(
	env: BankEnv,
): Pick<BankConnectionDeps, "bankConnector" | "encryptionKey" | "bankSetup" | "redirectUrl"> {
	const applicationId = env.ENABLE_BANKING_APPLICATION_ID;
	const privateKey = env.ENABLE_BANKING_PRIVATE_KEY;
	const encryptionKey = env.ENCRYPTION_KEY ?? null;
	const missing = [
		...(applicationId === undefined ? ["ENABLE_BANKING_APPLICATION_ID"] : []),
		...(privateKey === undefined ? ["ENABLE_BANKING_PRIVATE_KEY"] : []),
		...(encryptionKey === null ? ["ENCRYPTION_KEY"] : []),
	];

	return {
		bankConnector:
			applicationId === undefined || privateKey === undefined || encryptionKey === null
				? null
				: createBankConnector("enable-banking", {
						applicationId,
						privateKey,
						apiUrl: env.ENABLE_BANKING_API_URL,
					}),
		encryptionKey,
		bankSetup: missing,
		redirectUrl: new URL(REDIRECT_PATH, env.BETTER_AUTH_URL).toString(),
	};
}

export function bankSetup(deps: Pick<BankConnectionDeps, "bankSetup">): BankSetup {
	return { available: deps.bankSetup.length === 0, missing: [...deps.bankSetup] };
}

/** The connector and key, or `BANK_CONNECTOR_UNAVAILABLE` when either is missing. */
export function requireBankConnector(
	deps: Pick<BankConnectionDeps, "bankConnector" | "encryptionKey">,
): { connector: BankConnector; encryptionKey: Uint8Array } {
	if (deps.bankConnector === null || deps.encryptionKey === null) {
		throw new AppError(
			"BANK_CONNECTOR_UNAVAILABLE",
			"Bank connection is not configured on this server.",
		);
	}

	return { connector: deps.bankConnector, encryptionKey: deps.encryptionKey };
}

const invalidAuthorization = () =>
	new AppError("BANK_AUTHORIZATION_INVALID", "This bank authorisation is unknown or has expired.");

/**
 * Logs a provider failure with what a log may hold (AD-14): the connection
 * id, the provider's HTTP status and error code. Anything else is rethrown
 * as is, for `app.onError`.
 */
export function logFailure(
	deps: Pick<BankConnectionDeps, "logger">,
	connectionId: string | null,
	error: unknown,
) {
	if (error instanceof BankProviderError) {
		deps.logger.warn(
			{ connectionId, code: error.code, ...error.failure },
			"bank provider request failed",
		);
	}
}

function toRecord(row: typeof bankConnections.$inferSelect, now: number): BankConnectionRecord {
	return {
		id: row.id,
		connector: row.connector,
		institutionName: row.institutionName,
		country: row.country,
		status: row.status,
		consentExpiresAt: row.consentExpiresAt,
		lastSyncedAt: row.lastSyncedAt,
		lastError: row.lastError,
		alert: connectionAlert(row, now),
		createdAt: row.createdAt,
	};
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export async function listInstitutions(
	deps: BankConnectionDeps,
	country: string,
): Promise<InstitutionRecord[]> {
	const { connector } = requireBankConnector(deps);

	try {
		const institutions = await connector.listInstitutions(country);

		return institutions
			.map(({ name, country: code, logo, bic }) => ({ name, country: code, logo, bic }))
			.toSorted((left, right) => byName.compare(left.name, right.name));
	} catch (error) {
		logFailure(deps, null, error);
		throw error;
	}
}

/** The bank as the provider lists it now, `undefined` once it no longer does. */
async function findInstitution(
	deps: BankConnectionDeps,
	connector: BankConnector,
	connectionId: string | null,
	country: string,
	name: string,
) {
	try {
		const institutions = await connector.listInstitutions(country);

		return institutions.find((candidate) => candidate.name === name);
	} catch (error) {
		logFailure(deps, connectionId, error);
		throw error;
	}
}

/**
 * Sure's `authorize`: reads the bank again from the provider, so only a
 * listed name goes through, stores a pending row keyed by a fresh `state`,
 * and returns the bank's consent URL. A failure removes the row.
 */
export async function startConnection(
	deps: BankConnectionDeps,
	input: StartConnectionInput,
): Promise<{ url: string }> {
	const { connector } = requireBankConnector(deps);
	const now = Date.now();

	// Abandoned attempts: the user closed the bank's page, or never came back.
	// By `updatedAt`, which the callback's claim bumps: a row claimed at minute
	// 29 is still waiting on the provider's session, and must survive.
	await deps.db
		.delete(bankConnections)
		.where(
			and(
				eq(bankConnections.status, "pending"),
				lt(bankConnections.updatedAt, now - AUTHORIZATION_TTL_MS),
			),
		);

	const institution = await findInstitution(
		deps,
		connector,
		null,
		input.country,
		input.institution,
	);

	if (institution === undefined) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "institution", code: "invalid_value" },
		]);
	}

	const id = randomUUID();
	const state = randomUUID();

	await deps.db.insert(bankConnections).values({
		id,
		connector: connector.id,
		institutionName: institution.name,
		country: institution.country,
		status: "pending",
		authorizationState: state,
		authorizationStartedAt: now,
		createdAt: now,
		updatedAt: now,
	});

	try {
		const { url } = await connector.startAuthorization({
			institution,
			state,
			redirectUrl: deps.redirectUrl,
		});

		deps.logger.info({ connectionId: id }, "bank authorisation started");

		return { url };
	} catch (error) {
		await deps.db.delete(bankConnections).where(eq(bankConnections.id, id));
		logFailure(deps, id, error);
		throw error;
	}
}

/**
 * Sure's `reauthorize`: a new consent on the same connection, so its bank
 * accounts and the accounts they feed stay as they are. Reads the bank again
 * from the provider and stores a fresh `state` on the active row, which keeps
 * syncing on its old session until the callback succeeds. A failure clears
 * the state and leaves the connection as it was.
 */
export async function renewConnection(
	deps: BankConnectionDeps,
	connectionId: string,
): Promise<{ url: string }> {
	const { connector } = requireBankConnector(deps);
	const connection = await activeConnection(deps, connectionId);
	const institution = await findInstitution(
		deps,
		connector,
		connection.id,
		connection.country,
		connection.institutionName,
	);

	if (institution === undefined) {
		const error = new BankProviderError(
			"BANK_PROVIDER_ERROR",
			"The bank provider no longer lists this bank.",
			{ status: 200, providerCode: null },
		);

		logFailure(deps, connection.id, error);
		throw error;
	}

	const now = Date.now();
	const state = randomUUID();

	await deps.db
		.update(bankConnections)
		.set({ authorizationState: state, authorizationStartedAt: now, updatedAt: now })
		.where(eq(bankConnections.id, connection.id));

	try {
		const { url } = await connector.startAuthorization({
			institution,
			state,
			redirectUrl: deps.redirectUrl,
		});

		deps.logger.info({ connectionId: connection.id }, "bank renewal started");

		return { url };
	} catch (error) {
		// This attempt's state only: a second renewal may have replaced it.
		await deps.db
			.update(bankConnections)
			.set({ authorizationState: null, updatedAt: Date.now() })
			.where(
				and(eq(bankConnections.id, connection.id), eq(bankConnections.authorizationState, state)),
			);
		logFailure(deps, connection.id, error);
		throw error;
	}
}

/**
 * Sure's `callback`: claims the row by its `state`, once and within 30
 * minutes of the redirect, trades the code for a session and stores it
 * encrypted. The row is pending for a new connection, active for a renewal,
 * whose bank accounts are refreshed on their `identification_hash`: each
 * keeps its id and the account it feeds, a new one appears unlinked, and one
 * the bank no longer lists stays. A failure after the claim deletes a
 * pending row, since the code is single use at the provider too; an active
 * one keeps its old session, which the bank has not revoked (Sure).
 */
export async function completeConnection(
	deps: BankConnectionDeps,
	input: CompleteConnectionInput,
): Promise<BankConnectionRecord> {
	const { connector, encryptionKey } = requireBankConnector(deps);
	const now = Date.now();

	// One statement, so two posts of the same state cannot both claim it.
	const [claimed] = await deps.db
		.update(bankConnections)
		.set({ authorizationState: null, updatedAt: now })
		.where(
			and(
				eq(bankConnections.authorizationState, input.state),
				inArray(bankConnections.status, ["pending", "active"]),
				gte(bankConnections.authorizationStartedAt, now - AUTHORIZATION_TTL_MS),
			),
		)
		.returning({ id: bankConnections.id, status: bankConnections.status });

	if (claimed === undefined) {
		throw invalidAuthorization();
	}

	let session;

	try {
		session = await connector.completeAuthorization(input.code);
	} catch (error) {
		if (claimed.status === "pending") {
			await deps.db.delete(bankConnections).where(eq(bankConnections.id, claimed.id));
		}

		logFailure(deps, claimed.id, error);
		throw error;
	}

	const row = await deps.db.transaction(async (tx) => {
		const updatedAt = Date.now();
		const [updated] = await tx
			.update(bankConnections)
			.set({
				status: "active",
				sessionId: encrypt(encryptionKey, session.sessionId),
				consentExpiresAt: session.consentExpiresAt,
				authorizedAt: updatedAt,
				updatedAt,
			})
			.where(eq(bankConnections.id, claimed.id))
			.returning();

		if (updated === undefined) {
			throw invalidAuthorization();
		}

		// Sure's `import_accounts_from_session`: the provider lists a
		// session's accounts only here, so they are kept with it.
		if (session.accounts.length > 0) {
			await tx
				.insert(bankAccounts)
				.values(
					session.accounts.map((account) => ({
						id: randomUUID(),
						bankConnectionId: updated.id,
						identificationHash: account.identificationHash,
						providerUid: account.uid,
						name: account.name,
						ibanLast4: account.ibanLast4,
						currency: account.currency,
						cashAccountType: account.cashAccountType,
						createdAt: updatedAt,
						updatedAt,
					})),
				)
				.onConflictDoUpdate({
					target: [bankAccounts.bankConnectionId, bankAccounts.identificationHash],
					set: {
						listed: true,
						providerUid: excluded(bankAccounts.providerUid),
						name: excluded(bankAccounts.name),
						ibanLast4: excluded(bankAccounts.ibanLast4),
						currency: excluded(bankAccounts.currency),
						cashAccountType: excluded(bankAccounts.cashAccountType),
						updatedAt,
					},
				});
		}

		// Sure's importer: an account the new consent leaves out keeps its row
		// and its link, and no sync asks the new session for its old uid.
		await tx
			.update(bankAccounts)
			.set({ listed: false, updatedAt })
			.where(
				and(
					eq(bankAccounts.bankConnectionId, updated.id),
					notInArray(
						bankAccounts.identificationHash,
						session.accounts.map((account) => account.identificationHash),
					),
				),
			);

		return updated;
	});

	deps.logger.info(
		{
			connectionId: row.id,
			accounts: session.accounts.length,
			renewed: claimed.status === "active",
		},
		"bank connected",
	);

	return toRecord(row, Date.now());
}

/** Every open connection, oldest first. */
export async function listConnections(deps: BankConnectionDeps): Promise<BankConnectionRecord[]> {
	requireBankConnector(deps);

	const rows = await deps.db
		.select()
		.from(bankConnections)
		.where(eq(bankConnections.status, "active"))
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
	const now = Date.now();

	return rows.map((row) => toRecord(row, now));
}

/** A way to feed a bank account into the ledger, as the page offers it. */
export type BankAccountTargetRecord = { type: AccountType; subtype: AccountSubtype | null };

/** An existing account the bank account may feed. */
export type LinkCandidateRecord = {
	id: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
};

/** A bank account as the connection page shows it: no uid, no hash, never the full IBAN. */
export type BankAccountRecord = {
	id: string;
	name: string;
	ibanLast4: string | null;
	currency: string;
	/** What the bank's type suggests creating; `null` suggests skipping it. */
	suggestion: BankAccountTargetRecord | null;
	/** The account it feeds, `null` while it feeds none. */
	account: { id: string; name: string } | null;
	/** Existing accounts it may feed, by name; empty once linked. */
	candidates: LinkCandidateRecord[];
};

async function activeConnection(deps: BankConnectionDeps, connectionId: string) {
	const row = await deps.db
		.select({
			id: bankConnections.id,
			country: bankConnections.country,
			institutionName: bankConnections.institutionName,
			sessionId: bankConnections.sessionId,
		})
		.from(bankConnections)
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.status, "active")))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No bank connection has this id.");
	}

	return row;
}

function candidatesFor(bankAccount: BankAccount, all: readonly Account[]): LinkCandidateRecord[] {
	return all
		.filter((account) => isLinkCandidate(account, bankAccount))
		.map(({ id, name, type, subtype }) => ({ id, name, type, subtype }))
		.toSorted((left, right) => byName.compare(left.name, right.name));
}

function targetRecord(target: BankAccountTarget | null): BankAccountTargetRecord | null {
	return target === null ? null : { type: target.type, subtype: target.subtype };
}

/**
 * Sure's `setup_accounts`: every bank account of a connection, the account
 * it feeds or, until it feeds one, the choices the page offers for it.
 */
export async function listBankAccounts(
	deps: BankConnectionDeps,
	connectionId: string,
): Promise<BankAccountRecord[]> {
	requireBankConnector(deps);
	await activeConnection(deps, connectionId);

	const rows = await deps.db
		.select()
		.from(bankAccounts)
		.where(eq(bankAccounts.bankConnectionId, connectionId))
		.orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.name), asc(bankAccounts.id));
	const all = await deps.db.select().from(accounts);
	const linked = new Map(
		all.flatMap((account) =>
			account.bankAccountId === null ? [] : [[account.bankAccountId, account] as const],
		),
	);

	return rows.map((row): BankAccountRecord => {
		const account = linked.get(row.id);

		return {
			id: row.id,
			name: row.name,
			ibanLast4: row.ibanLast4,
			currency: row.currency,
			suggestion: targetRecord(suggestedTarget(row.cashAccountType)),
			account: account === undefined ? null : { id: account.id, name: account.name },
			candidates: account === undefined ? candidatesFor(row, all) : [],
		};
	});
}

const invalidLink = (path: string): FieldError => ({ path, code: "invalid_value" });

/** A stored bank account's currency, which the connector checked on the way in. */
function currencyOf(bankAccount: BankAccount): CurrencyCode {
	if (!isCurrencyCode(bankAccount.currency)) {
		throw new Error("A bank account holds a currency the connector should have refused.");
	}

	return bankAccount.currency;
}

/**
 * Sure's `complete_account_setup` and `link_existing_account` in one post:
 * checks every link against what `listBankAccounts` offers, reads each
 * chosen bank account's balance, then creates or links them all in one
 * transaction. A refused link or a provider failure writes nothing.
 */
export async function linkBankAccounts(
	deps: BankConnectionDeps,
	connectionId: string,
	input: LinkBankAccountsInput,
): Promise<BankAccountRecord[]> {
	const { connector } = requireBankConnector(deps);
	await activeConnection(deps, connectionId);

	const ids = input.links.map((link) => link.bankAccountId);
	const rows = await deps.db
		.select()
		.from(bankAccounts)
		.where(and(eq(bankAccounts.bankConnectionId, connectionId), inArray(bankAccounts.id, ids)));
	const byId = new Map(rows.map((row) => [row.id, row]));
	const all = await deps.db.select().from(accounts);
	const taken = new Set(all.map((account) => account.bankAccountId));
	const errors: FieldError[] = [];
	const seenBankAccounts = new Set<string>();
	const seenAccounts = new Set<string>();
	const planned: { link: LinkBankAccountsInput["links"][number]; bankAccount: BankAccount }[] = [];

	for (const [index, link] of input.links.entries()) {
		const bankAccount = byId.get(link.bankAccountId);

		if (
			bankAccount === undefined ||
			taken.has(bankAccount.id) ||
			seenBankAccounts.has(bankAccount.id)
		) {
			errors.push(invalidLink(`links.${index}.bankAccountId`));
			continue;
		}

		seenBankAccounts.add(bankAccount.id);

		if (link.action === "link") {
			const target = all.find((account) => account.id === link.accountId);

			if (
				target === undefined ||
				seenAccounts.has(target.id) ||
				!isLinkCandidate(target, bankAccount)
			) {
				errors.push(invalidLink(`links.${index}.accountId`));
				continue;
			}

			seenAccounts.add(target.id);
		}

		planned.push({ link, bankAccount });
	}

	if (errors.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", errors);
	}

	// Every balance before any write: one failure leaves the connection as it was.
	let balances: (AnchorBalance | null)[];

	try {
		balances = await Promise.all(
			planned.map(async ({ bankAccount }) => {
				const balance = await connector.fetchBalance(bankAccount.providerUid);

				// No conversion (FR56 wants the bank's own figure): a balance in
				// another currency is as good as none.
				return balance !== null && balance.currency === bankAccount.currency
					? { amount: balance.amount, date: balance.date }
					: null;
			}),
		);
	} catch (error) {
		logFailure(deps, connectionId, error);
		throw error;
	}

	const openingDate = addMonths(today(deps.timeZone), -24);

	await deps.db.transaction(async (tx) => {
		const inner: ServiceDeps = { ...deps, db: tx };
		const write = async ({ link, bankAccount }: (typeof planned)[number], index: number) => {
			const balance = balances[index] ?? null;
			const accountId =
				link.action === "link"
					? link.accountId
					: (
							await createAccount(
								inner,
								{
									name: bankAccount.name,
									type: link.type,
									subtype: link.subtype,
									currency: currencyOf(bankAccount),
									// Sure's `OpeningBalanceManager.default_date`: two years back,
									// at the bank's balance, which the backward computation then
									// ignores.
									openingBalance:
										balance === null
											? toMinorUnits(0)
											: toStoredBankBalance({ type: link.type }, balance.amount),
									openingDate,
								},
								{ origin: "sync" },
							)
						).id;

			await linkBankAccount(
				inner,
				accountId,
				{ bankAccountId: bankAccount.id, balance },
				{ origin: "sync" },
			);
			// A new link starts a new window: the account it now feeds gets the
			// first sync's three months, not seven days from an earlier link.
			await tx
				.update(bankAccounts)
				.set({ lastSyncedAt: null, updatedAt: Date.now() })
				.where(eq(bankAccounts.id, bankAccount.id));
		};

		// In sequence: each ledger call opens a savepoint on this one connection.
		await planned.reduce<Promise<void>>(
			(previous, item, index) => previous.then(() => write(item, index)),
			Promise.resolve(),
		);
	});

	deps.logger.info({ connectionId, linked: planned.length }, "bank accounts linked");

	return listBankAccounts(deps, connectionId);
}

export const codeOf = (error: unknown): ErrorCode =>
	error instanceof AppError ? error.code : "INTERNAL_ERROR";

/**
 * Sure's `revoke_session`, best effort: the provider may be down, or the
 * session unreadable after an `ENCRYPTION_KEY` change, and neither may keep
 * the user from disconnecting. Each is logged by its code, never with the
 * session.
 */
async function revokeSession(
	deps: BankConnectionDeps,
	connector: BankConnector,
	encryptionKey: Uint8Array,
	connection: { id: string; sessionId: string | null },
) {
	if (connection.sessionId === null) {
		return;
	}

	let sessionId: string;

	try {
		sessionId = decrypt(encryptionKey, connection.sessionId);
	} catch {
		deps.logger.warn(
			{ connectionId: connection.id, code: "SESSION_UNREADABLE" },
			"bank session not revoked",
		);

		return;
	}

	try {
		await connector.revokeAuthorization(sessionId);
	} catch (error) {
		logFailure(deps, connection.id, error);
		deps.logger.warn(
			{ connectionId: connection.id, code: codeOf(error) },
			"bank session not revoked",
		);
	}
}

/**
 * Sure's `destroy` on a connection: revokes its session at the provider,
 * turns every account it feeds into a manual one with its history unchanged
 * (AD-8), then deletes the connection, its bank accounts with it. Synced
 * lines keep their keys, their connection cleared, so connecting the same
 * bank again recognises every one of them. Takes the sync lease, ignoring
 * the hour between two syncs: a running sync answers `SYNC_IN_PROGRESS`.
 */
export async function disconnectConnection(
	deps: BankConnectionDeps,
	connectionId: string,
): Promise<{ id: string; accounts: number }> {
	const { connector, encryptionKey } = requireBankConnector(deps);
	const connection = await activeConnection(deps, connectionId);
	const now = Date.now();
	const [leased] = await deps.db
		.update(bankConnections)
		.set({ syncStartedAt: now })
		.where(
			and(
				eq(bankConnections.id, connection.id),
				or(
					isNull(bankConnections.syncStartedAt),
					lt(bankConnections.syncStartedAt, now - LEASE_MS),
				),
			),
		)
		.returning({ id: bankConnections.id });

	if (leased === undefined) {
		throw new AppError("SYNC_IN_PROGRESS", "This bank connection is already syncing.");
	}

	try {
		await revokeSession(deps, connector, encryptionKey, connection);

		// One transaction, the write lock taken up front: an account linked
		// meanwhile is unlinked too, rather than losing its link through the
		// foreign key with its bank balance left behind. A failed unlink leaves
		// the connection and every link.
		const linked = await deps.db.transaction(
			async (tx) => {
				const inner: ServiceDeps = { ...deps, db: tx };
				const rows = await tx
					.select({ id: accounts.id })
					.from(accounts)
					.innerJoin(bankAccounts, eq(bankAccounts.id, accounts.bankAccountId))
					.where(eq(bankAccounts.bankConnectionId, connection.id))
					.orderBy(asc(accounts.id));

				// In sequence: each ledger call opens a savepoint on this one connection.
				await rows.reduce<Promise<void>>(
					(previous, account) =>
						previous.then(() => unlinkBankAccount(inner, account.id, { origin: "sync" })),
					Promise.resolve(),
				);
				await tx.delete(bankConnections).where(eq(bankConnections.id, connection.id));

				return rows;
			},
			{ behavior: "immediate" },
		);

		deps.logger.info({ connectionId: connection.id, accounts: linked.length }, "bank disconnected");

		return { id: connection.id, accounts: linked.length };
	} catch (error) {
		await deps.db
			.update(bankConnections)
			.set({ syncStartedAt: null })
			.where(and(eq(bankConnections.id, connection.id), eq(bankConnections.syncStartedAt, now)));
		throw error;
	}
}
