import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The closed set of failures the API reports. The interface translates each
 * code (`errors.<CODE>`), so adding one is a contract change, not a detail.
 */
export const ERROR_STATUSES = {
	NOT_FOUND: 404,
	VALIDATION_ERROR: 400,
	/** No valid session on a guarded route. */
	UNAUTHORIZED: 401,
	/** Setup once a user exists, or a form post from a foreign origin. */
	FORBIDDEN: 403,
	/** A file no source can read, or larger than 5 MB. Nothing is written. */
	INVALID_IMPORT_FILE: 400,
	/** The account changed between an import's preview and its confirmation. */
	IMPORT_PREVIEW_STALE: 409,
	/** A revert of an import that is not confirmed: a preview, or one reverted already. */
	IMPORT_NOT_REVERTABLE: 409,
	/**
	 * A merge of a transaction no longer flagged as a possible duplicate:
	 * dismissed, or merged, in another tab. Nothing is written.
	 */
	DUPLICATE_RESOLVED: 409,
	/** A sync of this bank connection is running; its lease frees itself after ten minutes. */
	SYNC_IN_PROGRESS: 409,
	/** This bank connection synced less than an hour ago: banks cap how often they may be read. */
	SYNC_TOO_RECENT: 409,
	/** This bank connection's consent has ended: nothing is read until it is renewed. */
	CONSENT_EXPIRED: 409,
	/**
	 * A delete of an account a bank still feeds: the next sync would offer its
	 * bank account for linking again, so the bank is disconnected first, as Sure.
	 */
	ACCOUNT_LINKED: 409,
	/** An unknown, already used or expired `state` on a bank's callback. Nothing is written. */
	BANK_AUTHORIZATION_INVALID: 400,
	INTERNAL_ERROR: 500,
	/** Enable Banking failed or answered what its schema does not allow. No payload is kept. */
	BANK_PROVIDER_ERROR: 502,
	/**
	 * Enable Banking refused the callback URL, which must be registered in its
	 * control panel; `params.url` names it, as Sure does.
	 */
	BANK_REDIRECT_NOT_ALLOWED: 502,
	/**
	 * A sync's last state, never an answer: the lines synced but the bank gave
	 * no balance, so the account keeps the one of the sync before.
	 */
	BANK_BALANCE_UNAVAILABLE: 502,
	/** The health check could not read the database. */
	SERVICE_UNAVAILABLE: 503,
	/** A bank route while an Enable Banking variable or `ENCRYPTION_KEY` is unset. */
	BANK_CONNECTOR_UNAVAILABLE: 503,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUSES;

/** One invalid field: its dotted path and a snake_case code the form translates. */
export type FieldError = { path: string; code: string };

/**
 * Values the interface puts into its translation of the code, such as the
 * QIF type a file was refused for. Never an amount, a label or an account
 * number (AD-14): they travel to logs and error reports with the rest.
 */
export type ErrorParams = Record<string, string>;

export type ErrorBody = {
	error: { code: ErrorCode; message: string; fields?: FieldError[]; params?: ErrorParams };
};

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly status: (typeof ERROR_STATUSES)[ErrorCode];
	readonly fields: FieldError[] | undefined;
	readonly params: ErrorParams | undefined;

	constructor(code: ErrorCode, message: string, fields?: FieldError[], params?: ErrorParams) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.status = ERROR_STATUSES[code];
		this.fields = fields;
		this.params = params;
	}

	toJSON(): ErrorBody {
		return {
			error: {
				code: this.code,
				message: this.message,
				...(this.fields === undefined ? {} : { fields: this.fields }),
				...(this.params === undefined ? {} : { params: this.params }),
			},
		};
	}
}
