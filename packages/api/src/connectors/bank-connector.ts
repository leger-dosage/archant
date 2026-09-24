import type { BankConnectorId } from "@archant/data/schema/bank-connections";

import { AppError } from "../lib/errors.ts";

/** A bank as the provider lists it for one country. */
export type Institution = {
	name: string;
	/** ISO 3166-1 alpha-2. */
	country: string;
	logo: string | null;
	bic: string | null;
	/** The longest consent the bank grants, in seconds; `null` when it says nothing. */
	maximumConsentValidity: number | null;
};

export type AuthorizationRequest = {
	institution: Institution;
	/** Opaque, single use; the provider hands it back on the callback. */
	state: string;
	/** Where the bank sends the browser back, registered with the provider. */
	redirectUrl: string;
};

/** An open session: a bearer credential for the account data until the consent ends. */
export type BankSession = {
	sessionId: string;
	/** Epoch milliseconds. */
	consentExpiresAt: number;
};

/**
 * A bank aggregator behind the connector port (AD-3). Like a file source it
 * never touches the database: the service stores what it returns. Later
 * stories add account listing, statements and revocation.
 */
export type BankConnector = {
	id: BankConnectorId;
	listInstitutions: (country: string) => Promise<Institution[]>;
	/** The URL of the bank's consent page. */
	startAuthorization: (request: AuthorizationRequest) => Promise<{ url: string }>;
	/** Trades the callback's `code` for a session. */
	completeAuthorization: (code: string) => Promise<BankSession>;
};

/** What a log line may say about a provider failure: numbers and a code, never a payload. */
export type ProviderFailure = {
	/** The provider's HTTP status, `null` when no response came back. */
	status: number | null;
	/** The provider's own error code, such as `REDIRECT_URI_NOT_ALLOWED`. */
	providerCode: string | null;
};

/**
 * A sanitised provider failure. The API answers with the `AppError` part;
 * the service logs `failure` with the connection id.
 */
export class BankProviderError extends AppError {
	readonly failure: ProviderFailure;

	constructor(
		code: "BANK_PROVIDER_ERROR" | "BANK_REDIRECT_NOT_ALLOWED",
		message: string,
		failure: ProviderFailure,
		params?: Record<string, string>,
	) {
		super(code, message, undefined, params);
		this.name = "BankProviderError";
		this.failure = failure;
	}
}
