import type { BankConnector } from "../connectors/bank-connector.ts";
import type { Logger } from "../lib/logger.ts";
import type { SaveBankCredentialsInput } from "../schemas/bank-connections.ts";
import type { ServiceDeps } from "./deps.ts";
import type { KeyObject } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { bankConnections } from "@archant/data/schema/bank-connections";
import { settings } from "@archant/data/schema/settings";

import { BankProviderError } from "../connectors/bank-connector.ts";
import { createBankConnector } from "../connectors/registry.ts";
import { rsaPrivateKey } from "../env.ts";
import { AppError } from "../lib/errors.ts";
import { decrypt, encrypt } from "./crypto.ts";

/** The `settings` row holding the application ID, plain: it names the key and signs nothing. */
export const APPLICATION_ID_SETTING = "enable_banking_application_id";

/** The `settings` row holding the private key, PKCS#8 PEM encrypted with `ENCRYPTION_KEY`. */
export const PRIVATE_KEY_SETTING = "enable_banking_private_key";

/** What an Enable Banking request is signed with. */
export type BankCredentials = { applicationId: string; privateKey: KeyObject };

/**
 * What resolving the connector needs. No connector here: it is built per
 * call from whichever credentials apply then, so a pair saved from the
 * interface takes effect without a restart, on every instance.
 */
export type BankCredentialDeps = ServiceDeps & {
	logger: Logger;
	/** `ENABLE_BANKING_*`, both or neither; when set they win over the stored pair. */
	bankCredentials: BankCredentials | null;
	/** `ENCRYPTION_KEY`, 32 bytes. */
	encryptionKey: Uint8Array | null;
	/** `ENABLE_BANKING_API_URL`. */
	bankApiUrl: string;
	/** `BETTER_AUTH_URL` + `REDIRECT_PATH`, registered with the provider. */
	redirectUrl: string;
};

export type BankCredentialSource = "environment" | "interface";

/** What « Réglages › Banques » needs to know, never the key itself. */
export type BankSetup = {
	available: boolean;
	source: BankCredentialSource | null;
	applicationId: string | null;
	/** The address to register in the Enable Banking control panel. */
	redirectUrl: string;
	/** An active connection holds a session under the current pair, as Sure locks. */
	locked: boolean;
	/** The unset variables' names, never their values: only `ENCRYPTION_KEY` now. */
	missing: string[];
};

const unavailable = () =>
	new AppError("BANK_CONNECTOR_UNAVAILABLE", "Bank connection is not configured on this server.");

const locked = () =>
	new AppError(
		"BANK_CREDENTIALS_LOCKED",
		"Disconnect every bank before changing the Enable Banking credentials.",
	);

/**
 * The stored pair, `null` when none is saved or it no longer reads, as
 * after an `ENCRYPTION_KEY` change: the page then offers the form again.
 * Only the code is logged.
 */
async function storedCredentials(
	deps: Pick<BankCredentialDeps, "db" | "logger">,
	encryptionKey: Uint8Array,
): Promise<BankCredentials | null> {
	const rows = await deps.db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(inArray(settings.key, [APPLICATION_ID_SETTING, PRIVATE_KEY_SETTING]));
	const applicationId = rows.find((row) => row.key === APPLICATION_ID_SETTING)?.value;
	const stored = rows.find((row) => row.key === PRIVATE_KEY_SETTING)?.value;

	if (applicationId === undefined || stored === undefined) {
		return null;
	}

	let privateKey: KeyObject | null;

	try {
		privateKey = rsaPrivateKey(decrypt(encryptionKey, stored));
	} catch {
		privateKey = null;
	}

	if (privateKey === null) {
		deps.logger.warn({ code: "BANK_CREDENTIALS_UNREADABLE" }, "stored bank credentials ignored");

		return null;
	}

	return { applicationId, privateKey };
}

/** The pair that applies now, the environment first, and where it comes from. */
async function currentCredentials(
	deps: BankCredentialDeps,
): Promise<{ credentials: BankCredentials; source: BankCredentialSource } | null> {
	if (deps.bankCredentials !== null) {
		return { credentials: deps.bankCredentials, source: "environment" };
	}

	if (deps.encryptionKey === null) {
		return null;
	}

	const stored = await storedCredentials(deps, deps.encryptionKey);

	return stored === null ? null : { credentials: stored, source: "interface" };
}

const connectorFor = (deps: Pick<BankCredentialDeps, "bankApiUrl">, credentials: BankCredentials) =>
	createBankConnector("enable-banking", { ...credentials, apiUrl: deps.bankApiUrl });

/**
 * The connector and key for this call, or `BANK_CONNECTOR_UNAVAILABLE`
 * while `ENCRYPTION_KEY` or every credential is missing. Resolved per call,
 * never cached: a cache would have to be invalidated across the instances
 * of a hosted deployment.
 */
export async function resolveBankConnector(
	deps: BankCredentialDeps,
): Promise<{ connector: BankConnector; encryptionKey: Uint8Array }> {
	const { encryptionKey } = deps;

	if (encryptionKey === null) {
		throw unavailable();
	}

	const current = await currentCredentials(deps);

	if (current === null) {
		throw unavailable();
	}

	return { connector: connectorFor(deps, current.credentials), encryptionKey };
}

/** Sure locks on an authenticated session; a pending row is a consent in flight. */
async function isLocked(deps: Pick<ServiceDeps, "db">): Promise<boolean> {
	const row = await deps.db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(eq(bankConnections.status, "active"))
		.limit(1)
		.get();

	return row !== undefined;
}

export async function bankSetup(deps: BankCredentialDeps): Promise<BankSetup> {
	const current = await currentCredentials(deps);
	const missing = deps.encryptionKey === null ? ["ENCRYPTION_KEY"] : [];

	return {
		available: missing.length === 0 && current !== null,
		source: current?.source ?? null,
		applicationId: current?.credentials.applicationId ?? null,
		redirectUrl: deps.redirectUrl,
		locked: await isLocked(deps),
		missing,
	};
}

/** An address as the provider compares it, so `http://host` and `http://host/` agree. */
function normalized(url: string): string {
	try {
		return new URL(url).href;
	} catch {
		return url;
	}
}

/**
 * Asks Enable Banking about the application the pair signs for. A refused
 * signature is `BANK_CREDENTIALS_REFUSED`; an application that does not list
 * the redirect address is `BANK_REDIRECT_NOT_ALLOWED` now, rather than at
 * the first connection's `/auth`.
 */
async function checkApplication(deps: BankCredentialDeps, credentials: BankCredentials) {
	let redirectUrls: string[];

	try {
		({ redirectUrls } = await connectorFor(deps, credentials).describeApplication());
	} catch (error) {
		if (error instanceof BankProviderError) {
			deps.logger.warn({ code: error.code, ...error.failure }, "bank credentials check failed");

			if (error.failure.status === 401 || error.failure.status === 403) {
				throw new AppError(
					"BANK_CREDENTIALS_REFUSED",
					"Enable Banking refused this application ID and private key.",
				);
			}
		}

		throw error;
	}

	const expected = normalized(deps.redirectUrl);

	if (!redirectUrls.some((url) => normalized(url) === expected)) {
		throw new AppError(
			"BANK_REDIRECT_NOT_ALLOWED",
			"Register the redirect URL in the Enable Banking control panel.",
			undefined,
			{ url: deps.redirectUrl },
		);
	}
}

/**
 * Sure's Enable Banking panel: checks the pair with the provider, then
 * stores the application ID and the key, re-exported as PKCS#8 and
 * encrypted, in one transaction. Nothing is written on any failure. The
 * environment's pair, and any active connection, refuse the change.
 */
export async function saveBankCredentials(
	deps: BankCredentialDeps,
	input: SaveBankCredentialsInput,
): Promise<BankSetup> {
	const { encryptionKey } = deps;

	if (encryptionKey === null) {
		throw unavailable();
	}

	if (deps.bankCredentials !== null) {
		throw new AppError(
			"BANK_CREDENTIALS_FROM_ENVIRONMENT",
			"The Enable Banking credentials are set by the server's environment.",
		);
	}

	const privateKey = rsaPrivateKey(input.privateKey);

	if (privateKey === null) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "privateKey", code: "invalid_private_key" },
		]);
	}

	if (await isLocked(deps)) {
		throw locked();
	}

	const credentials = { applicationId: input.applicationId, privateKey };
	await checkApplication(deps, credentials);
	const stored = encrypt(
		encryptionKey,
		privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	);

	await deps.db.transaction(
		async (tx) => {
			// Again under the write lock: a bank connected during the check
			// holds a session the new pair could not use.
			if (await isLocked({ db: tx })) {
				throw locked();
			}

			const updatedAt = Date.now();

			await tx
				.insert(settings)
				.values([
					{ key: APPLICATION_ID_SETTING, value: input.applicationId, updatedAt },
					{ key: PRIVATE_KEY_SETTING, value: stored, updatedAt },
				])
				.onConflictDoUpdate({
					target: settings.key,
					set: { value: sql`excluded.${sql.identifier(settings.value.name)}`, updatedAt },
				});
		},
		{ behavior: "immediate" },
	);

	deps.logger.info({ source: "interface" }, "bank credentials saved");

	return bankSetup(deps);
}
