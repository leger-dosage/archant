import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
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

/** An account the bank shares under a session, with nothing that identifies its holder. */
export type BankAccountRef = {
	/** Scoped to the session: the reference every data call takes. */
	uid: string;
	/** Stable across sessions: what a renewed consent's accounts are matched on. */
	identificationHash: string;
	name: string;
	/** The last four characters of the IBAN; the rest never leaves the connector. */
	ibanLast4: string | null;
	currency: CurrencyCode;
	/** ISO 20022 cash account type, such as `CACC`, upper-cased. */
	cashAccountType: string | null;
};

/** An open session: a bearer credential for the account data until the consent ends. */
export type BankSession = {
	sessionId: string;
	/** Epoch milliseconds. */
	consentExpiresAt: number;
	/** The accounts the user shared, which the provider lists only here. */
	accounts: BankAccountRef[];
};

/**
 * A bank's balance as it prints it: signed, never converted to a stored
 * balance (AD-5). `date` is the day it describes, `null` when the bank does
 * not say; the ledger dates it today then, and never later than today.
 */
export type BankBalance = { amount: MinorUnits; currency: CurrencyCode; date: IsoDate | null };

/** A statement as a bank connector reads it: its balance may carry no date. */
export type BankStatement = Omit<ParsedStatement, "balance"> & { balance: BankBalance | null };

/**
 * A bank aggregator behind the connector port (AD-3). Like a file source it
 * never touches the database: the service stores what it returns. Later
 * stories add revocation.
 */
export type BankConnector = {
	id: BankConnectorId;
	listInstitutions: (country: string) => Promise<Institution[]>;
	/** The URL of the bank's consent page. */
	startAuthorization: (request: AuthorizationRequest) => Promise<{ url: string }>;
	/** Trades the callback's `code` for a session. */
	completeAuthorization: (code: string) => Promise<BankSession>;
	/**
	 * The account's current balance (AD-18): the interim booked one, else
	 * the closing booked one; `null` when the bank gives neither.
	 */
	fetchBalance: (uid: string) => Promise<BankBalance | null>;
	/**
	 * The account's booked lines dated `since` or later, every page, then its
	 * balance as `fetchBalance` reads it. A line it cannot read goes to
	 * `rejected`; a pending or cancelled one is left out.
	 */
	fetchStatement: (uid: string, since: IsoDate) => Promise<BankStatement>;
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
