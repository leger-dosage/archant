import type { BankConnector } from "../connectors/bank-connector.ts";
import type { Logger } from "../lib/logger.ts";
import type { SaveBankCredentialsInput } from "../schemas/bank-connections.ts";
import type { ServiceDeps } from "./deps.ts";
import type { KeyObject } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import type { BankCountry } from "@archant/data/bank-countries";
import { isBankCountry } from "@archant/data/bank-countries";
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

/**
 * The `settings` row holding the country whose banks are listed, Sure's
 * `country_code`, saved with the pair and read with it.
 */
export const COUNTRY_SETTING = "enable_banking_country";

/** Every row the credentials span, which removing them deletes. */
const CREDENTIAL_SETTINGS = [APPLICATION_ID_SETTING, PRIVATE_KEY_SETTING, COUNTRY_SETTING];

/** What an Enable Banking request is signed with, and the country it lists banks of. */
type BankCredentials = {
	applicationId: string;
	privateKey: KeyObject;
	country: BankCountry;
};

/**
 * What resolving the connector needs. No connector here: it is built per
 * call from whichever credentials apply then, so a pair saved from the
 * interface takes effect without a restart, on every instance.
 */
export type BankCredentialDeps = ServiceDeps & {
	logger: Logger;
	/** `ENABLE_BANKING_*`, the pair both or neither; when set they win over the stored ones. */
	bankCredentials: BankCredentials | null;
	/** `ENCRYPTION_KEY`, 32 bytes. */
	encryptionKey: Uint8Array | null;
	/** `ENABLE_BANKING_API_URL`. */
	bankApiUrl: string;
	/** `BETTER_AUTH_URL` + `REDIRECT_PATH`, registered with the provider. */
	redirectUrl: string;
};

type BankCredentialSource = "environment" | "interface";

/** What « Réglages › Banques » needs to know, never the key itself. */
export type BankSetup = {
	available: boolean;
	source: BankCredentialSource | null;
	applicationId: string | null;
	/** The country whose banks the picker lists, `null` while no credentials apply. */
	country: BankCountry | null;
	/** The address to register in the Enable Banking control panel. */
	redirectUrl: string;
	/** An active connection holds a session under the current pair, as Sure locks. */
	locked: boolean;
	/** The unset variables' names, never their values: only `ENCRYPTION_KEY` now. */
	missing: string[];
};

const unavailable = () =>
	new AppError("BANK_CONNECTOR_UNAVAILABLE", "Bank connection is not configured on this server.");

const fromEnvironment = () =>
	new AppError(
		"BANK_CREDENTIALS_FROM_ENVIRONMENT",
		"The Enable Banking credentials are set by the server's environment.",
	);

const locked = () =>
	new AppError(
		"BANK_CREDENTIALS_LOCKED",
		"Disconnect every bank before changing the Enable Banking credentials.",
	);

/**
 * The stored credentials, `null` when none are saved or they no longer
 * read, as after an `ENCRYPTION_KEY` change: the page then offers the form
 * again. Without a country Sure offers they count as none, as Sure's
 * `credentials_configured?` wants a `country_code`. Only the code is logged.
 */
async function storedCredentials(
	deps: Pick<BankCredentialDeps, "db" | "logger">,
	encryptionKey: Uint8Array,
): Promise<BankCredentials | null> {
	const rows = await deps.db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(inArray(settings.key, CREDENTIAL_SETTINGS));
	const applicationId = rows.find((row) => row.key === APPLICATION_ID_SETTING)?.value;
	const stored = rows.find((row) => row.key === PRIVATE_KEY_SETTING)?.value;
	const country = rows.find((row) => row.key === COUNTRY_SETTING)?.value;

	if (applicationId === undefined || stored === undefined || !isBankCountry(country)) {
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

	return { applicationId, privateKey, country };
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

const connectorFor = (
	deps: Pick<BankCredentialDeps, "bankApiUrl">,
	{ applicationId, privateKey }: Pick<BankCredentials, "applicationId" | "privateKey">,
) => createBankConnector("enable-banking", { applicationId, privateKey, apiUrl: deps.bankApiUrl });

/**
 * The connector, key and country for this call, or
 * `BANK_CONNECTOR_UNAVAILABLE` while `ENCRYPTION_KEY` or every credential is
 * missing. Resolved per call, never cached: a cache would have to be
 * invalidated across the instances of a hosted deployment.
 */
export async function resolveBankConnector(
	deps: BankCredentialDeps,
): Promise<{ connector: BankConnector; encryptionKey: Uint8Array; country: BankCountry }> {
	const { encryptionKey } = deps;

	if (encryptionKey === null) {
		throw unavailable();
	}

	const current = await currentCredentials(deps);

	if (current === null) {
		throw unavailable();
	}

	return {
		connector: connectorFor(deps, current.credentials),
		encryptionKey,
		country: current.credentials.country,
	};
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
		country: current?.credentials.country ?? null,
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
async function checkApplication(
	deps: BankCredentialDeps,
	credentials: Pick<BankCredentials, "applicationId" | "privateKey">,
) {
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

const settingRow = (key: string, value: string, updatedAt: number) => ({ key, value, updatedAt });

/**
 * Sure's `update` without a new pair: the country alone, over the stored
 * credentials. Allowed while a bank is active, since Sure's country select
 * is never disabled and each connection keeps the country it was made in.
 */
async function saveCountry(
	deps: BankCredentialDeps,
	encryptionKey: Uint8Array,
	country: BankCountry,
): Promise<BankSetup> {
	// Read as they apply: a key that no longer decrypts is no credentials,
	// and a country alone would make none.
	if ((await storedCredentials(deps, encryptionKey)) === null) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "applicationId", code: "too_small" },
			{ path: "privateKey", code: "too_small" },
		]);
	}

	const updatedAt = Date.now();

	await deps.db
		.insert(settings)
		.values(settingRow(COUNTRY_SETTING, country, updatedAt))
		.onConflictDoUpdate({ target: settings.key, set: { value: country, updatedAt } });

	deps.logger.info({ source: "interface" }, "bank country saved");

	return bankSetup(deps);
}

/**
 * Sure's Enable Banking panel: with a pair, checks it with the provider,
 * then stores the country, the application ID and the key, re-exported as
 * PKCS#8 and encrypted, in one transaction; without one, the country alone.
 * Nothing is written on any failure. The environment's credentials refuse
 * both; an active connection refuses a new pair.
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
		throw fromEnvironment();
	}

	if (input.applicationId === undefined || input.privateKey === undefined) {
		return saveCountry(deps, encryptionKey, input.country);
	}

	const { applicationId, country } = input;
	const privateKey = rsaPrivateKey(input.privateKey);

	if (privateKey === null) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "privateKey", code: "invalid_private_key" },
		]);
	}

	if (await isLocked(deps)) {
		throw locked();
	}

	await checkApplication(deps, { applicationId, privateKey });
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
					settingRow(APPLICATION_ID_SETTING, applicationId, updatedAt),
					settingRow(PRIVATE_KEY_SETTING, stored, updatedAt),
					settingRow(COUNTRY_SETTING, country, updatedAt),
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

/**
 * Refuses removing credentials the environment pins: only the server's
 * owner can take them away, by unsetting the variables.
 */
export function assertRemovable(deps: BankCredentialDeps) {
	if (deps.bankCredentials !== null) {
		throw fromEnvironment();
	}
}

/**
 * Deletes the stored rows, whichever of them exist, unless a bank is active:
 * one the callback activated after its caller disconnected the others holds
 * a session the credentials must stay to revoke. Meant to run under the
 * caller's write lock.
 */
export async function deleteStoredCredentials(deps: Pick<ServiceDeps, "db">) {
	if (await isLocked(deps)) {
		throw locked();
	}

	await deps.db.delete(settings).where(inArray(settings.key, CREDENTIAL_SETTINGS));
}
