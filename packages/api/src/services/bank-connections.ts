import type { BankConnector } from "../connectors/bank-connector.ts";
import type { Env } from "../env.ts";
import type { Logger } from "../lib/logger.ts";
import type { CompleteConnectionInput, StartConnectionInput } from "../schemas/bank-connections.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { BankConnectionStatus } from "@archant/data/schema/bank-connections";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { BankProviderError } from "../connectors/bank-connector.ts";
import { createBankConnector } from "../connectors/registry.ts";
import { AppError } from "../lib/errors.ts";
import { encrypt } from "./crypto.ts";

/** Where the bank sends the browser back: a page of the interface, not an API route. */
export const REDIRECT_PATH = "/reglages/banques/retour";

/** How long a `state` stays valid: time enough to sign in at the bank, no more. */
export const AUTHORIZATION_TTL_MS = 30 * 60 * 1000;

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
function logFailure(deps: BankConnectionDeps, connectionId: string | null, error: unknown) {
	if (error instanceof BankProviderError) {
		deps.logger.warn(
			{ connectionId, code: error.code, ...error.failure },
			"bank provider request failed",
		);
	}
}

function toRecord(row: typeof bankConnections.$inferSelect): BankConnectionRecord {
	return {
		id: row.id,
		connector: row.connector,
		institutionName: row.institutionName,
		country: row.country,
		status: row.status,
		consentExpiresAt: row.consentExpiresAt,
		createdAt: row.createdAt,
	};
}

const byName = new Intl.Collator("fr", { sensitivity: "base" });

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

	let institutions;

	try {
		institutions = await connector.listInstitutions(input.country);
	} catch (error) {
		logFailure(deps, null, error);
		throw error;
	}

	const institution = institutions.find((candidate) => candidate.name === input.institution);

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
 * Sure's `callback`: claims the pending row by its `state`, once and within
 * 30 minutes, trades the code for a session and stores it encrypted. Any
 * failure after the claim deletes the row: the code is single use at the
 * provider too, so only a fresh attempt can succeed.
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
				eq(bankConnections.status, "pending"),
				gte(bankConnections.createdAt, now - AUTHORIZATION_TTL_MS),
			),
		)
		.returning({ id: bankConnections.id });

	if (claimed === undefined) {
		throw invalidAuthorization();
	}

	let session;

	try {
		session = await connector.completeAuthorization(input.code);
	} catch (error) {
		await deps.db.delete(bankConnections).where(eq(bankConnections.id, claimed.id));
		logFailure(deps, claimed.id, error);
		throw error;
	}

	const [row] = await deps.db
		.update(bankConnections)
		.set({
			status: "active",
			sessionId: encrypt(encryptionKey, session.sessionId),
			consentExpiresAt: session.consentExpiresAt,
			updatedAt: Date.now(),
		})
		.where(eq(bankConnections.id, claimed.id))
		.returning();

	if (row === undefined) {
		throw invalidAuthorization();
	}

	deps.logger.info({ connectionId: row.id }, "bank connected");

	return toRecord(row);
}

/** Every open connection, oldest first. */
export async function listConnections(deps: BankConnectionDeps): Promise<BankConnectionRecord[]> {
	requireBankConnector(deps);

	const rows = await deps.db
		.select()
		.from(bankConnections)
		.where(eq(bankConnections.status, "active"))
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));

	return rows.map(toRecord);
}
