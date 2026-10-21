import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The closed set of failures the API reports. The interface translates each
 * code (`errors.<CODE>`), so adding one is a contract change, not a detail.
 */
export const ERROR_STATUSES = {
	NOT_FOUND: 404,
	/** A disconnection of an assistant that holds no consent: never connected, or disconnected already. */
	ASSISTANT_NOT_FOUND: 404,
	/**
	 * An invitation link whose token is unknown, expired, accepted already or
	 * revoked: the four read alike, so the answer says nothing of which.
	 */
	INVITATION_INVALID: 404,
	VALIDATION_ERROR: 400,
	/** No valid session on a guarded route. */
	UNAUTHORIZED: 401,
	/**
	 * Setup once a user exists, a form post with no origin, or a role that
	 * does not allow the request: a viewer's write, or a read kept to administrators.
	 */
	FORBIDDEN: 403,
	/**
	 * A write from an origin other than `BETTER_AUTH_URL`'s, `/api/auth/*`
	 * included: `ARCHANT_URL` names another address than the browser's. Nothing
	 * is written, and neither origin is returned.
	 */
	ORIGIN_MISMATCH: 403,
	/** Setup with a token other than the one the server logged at start. Nothing is written. */
	SETUP_TOKEN_INVALID: 403,
	/**
	 * More setup attempts from one address than the sign-in limit allows, or a
	 * sign-in while too many failed across every address. The body is not read.
	 */
	TOO_MANY_REQUESTS: 429,
	/**
	 * A body over 64 KB on any `/api` route but the two uploads, or over 1.5 MB
	 * on `/api/mcp`. Refused before or while reading it.
	 */
	PAYLOAD_TOO_LARGE: 413,
	/** A file no source can read, or larger than 5 MB, 1 MB from an assistant. Nothing is written. */
	INVALID_IMPORT_FILE: 400,
	/**
	 * « Importer depuis Sure » given a file whose name ends neither in `.ndjson`
	 * nor in `.json`, an empty one, or one whose first line is not a JSON
	 * object with `type` and `data`, as Sure's `valid_ndjson_first_line?`.
	 * Nothing is read further.
	 */
	NDJSON_INVALID: 400,
	/**
	 * A raw-data CSV file that does not read, with the chosen separator, into
	 * headers and at least one data row, as Sure's `csv_valid?`. Nothing is
	 * read further.
	 */
	CSV_INVALID: 400,
	/**
	 * « Importer depuis Quicken (QIF) » given a file without a `!Type:`
	 * header, as Sure's `QifParser.valid?`. Nothing is read further.
	 */
	QIF_INVALID: 400,
	/**
	 * A QIF file naming no `!Account`, uploaded without choosing its account,
	 * as Sure's `qif_account_required`. Nothing is read further.
	 */
	QIF_ACCOUNT_REQUIRED: 400,
	/**
	 * A Sure archive larger than `SURE_IMPORT_MAX_NDJSON_SIZE_MB`, or a CSV
	 * file larger than Sure's `MAX_CSV_SIZE`, 10 MB, refused before it is
	 * read; `params.maxSize` is the limit in megabytes.
	 */
	IMPORT_FILE_TOO_LARGE: 400,
	/**
	 * A Sure archive with more lines carrying a `type` than
	 * `SURE_IMPORT_MAX_ROWS`, or a CSV file with more data rows than Sure's
	 * `max_row_count`, as Sure's `MaxRowCountExceededError`; `params.max` is
	 * the limit. Nothing is written.
	 */
	IMPORT_TOO_MANY_ROWS: 400,
	/**
	 * A Sure archive whose preflight, run again by the import, found an
	 * error, as Sure's `PreflightError`. Nothing is written.
	 */
	SURE_IMPORT_INVALID: 400,
	/**
	 * A CSV import posted while its preview, run again, finds an error or a
	 * value left to map, as Sure's `publishable?` refuses it. Nothing is written.
	 */
	CSV_IMPORT_INVALID: 400,
	/**
	 * The account changed between an import's preview and its confirmation, or
	 * gives other counts than an assistant's `expectedCounts`; `params` holds the
	 * five counts now. Nothing is written.
	 */
	IMPORT_PREVIEW_STALE: 409,
	/**
	 * An application of rules whose count of rows to change differs from the
	 * one its preview gave; `params.changed` is the count now. Nothing is written.
	 */
	RULE_PREVIEW_STALE: 409,
	/**
	 * A bulk edit by filter whose count of selected rows differs from the one
	 * an assistant read and the owner agreed to; `params.count` is the count
	 * now. Nothing is written.
	 */
	BULK_COUNT_STALE: 409,
	/**
	 * A new transfer whose form key already created a transfer with other
	 * accounts, date, amount or fees, as Sure's `StaleIdempotencyKeyError`: a
	 * form sent again after it changed. Nothing is written.
	 */
	TRANSFER_FORM_STALE: 409,
	/** A revert of an import that is not confirmed: a preview, or one reverted already. */
	IMPORT_NOT_REVERTABLE: 409,
	/**
	 * A merge of a transaction no longer flagged as a possible duplicate:
	 * dismissed, or merged, in another tab. Nothing is written.
	 */
	DUPLICATE_RESOLVED: 409,
	/**
	 * A split of a transfer side, a pending, excluded or possibly duplicated
	 * transaction, or a parent or a child of a split, as Sure's `splittable?`.
	 * Nothing is written.
	 */
	NOT_SPLITTABLE: 409,
	/**
	 * A change to the date, the amount or the exclusion of a split's parent or
	 * child, a child deleted alone, or a merge into either: the split is edited
	 * as a whole (AD-20). Also an edit that moves a converted trade's date or
	 * amount away from its transaction's. Nothing is written.
	 */
	TRANSACTION_SPLIT: 409,
	/**
	 * An assistant's deletion naming an account, a date or an amount the
	 * transaction no longer has: the owner agreed to delete the line they were
	 * shown, not the one it became. `params.changed` names the fields that
	 * differ, never their values (AD-14). Nothing is deleted.
	 */
	TRANSACTION_CHANGED: 409,
	/**
	 * A conversion into a trade of a transfer side, a pending, excluded or
	 * possibly duplicated transaction, or a split's parent or child, a
	 * converted one included (AD-20, AD-22). Nothing is written.
	 */
	NOT_CONVERTIBLE: 409,
	/**
	 * A category's amount in a month whose total is not set: Sure's form only
	 * reaches its categories after « Budget ». Nothing is written.
	 */
	BUDGET_NOT_SET_UP: 409,
	/**
	 * A copy into a month already set up: Sure only offers one to a month
	 * that is not, and never overwrites. Nothing is written.
	 */
	BUDGET_ALREADY_SET_UP: 409,
	/**
	 * A change of the signed-in member's own role, or their own removal, as
	 * Sure's `cannot_remove_self`: another administrator does it. Nothing is written.
	 */
	CANNOT_CHANGE_SELF: 409,
	/** A demotion or a removal that would leave no administrator. Nothing is written. */
	LAST_ADMIN: 409,
	/**
	 * A goal event that does not apply from the goal's state, as resuming an
	 * active goal or completing an archived one or a reserve. Nothing is written.
	 */
	GOAL_STATE_INVALID: 409,
	/**
	 * A restore or a reopening of a goal whose whole-balance account another
	 * goal has taken whole since, as Sure's `restore_must_not_recreate_whole_account_conflict`;
	 * `params.accountId` names it, never its name (AD-14). Nothing is written.
	 */
	GOAL_ACCOUNT_TAKEN: 409,
	/**
	 * A trade on an account that takes none, as Sure's API refuses one: a new
	 * trade or a conversion goes to an investment account or a crypto
	 * exchange only (`supportsTrades`), a position's edits to an account that
	 * holds securities (AD-22). Nothing is written.
	 */
	TRADES_NOT_SUPPORTED: 409,
	/**
	 * A bill declared, or a series edited, onto the account, key, amount and
	 * currency of another series with the same dedup scope, as Sure's
	 * `already_exists`. Nothing is written.
	 */
	RECURRING_ALREADY_EXISTS: 409,
	/**
	 * « Marquer comme récurrent » on a transfer whose account, destination,
	 * amount and currency a series already follows, whatever its status, as
	 * Sure's `transfer_already_exists`. Nothing is written.
	 */
	RECURRING_TRANSFER_ALREADY_EXISTS: 409,
	/**
	 * A transaction attached to an occurrence once its whole amount already
	 * pays other occurrences: a payment never exceeds its transaction, as
	 * Sure's `over_allocated`. Nothing is written.
	 */
	PAYMENT_EXCEEDS_TRANSACTION: 409,
	/** A sync of this bank connection is running; its lease frees itself after ten minutes. */
	SYNC_IN_PROGRESS: 409,
	/** This bank connection's consent has ended: nothing is read until it is renewed. */
	CONSENT_EXPIRED: 409,
	/** « Mettre à jour les cours » while price fetching is off: nothing reaches the provider. */
	PRICES_DISABLED: 409,
	/** A price update is running; its lease frees itself after ten minutes. */
	PRICE_UPDATE_IN_PROGRESS: 409,
	/**
	 * « Saisir un cours » on a security its provider prices and that is not
	 * offline: the next fetch would contradict it. Nothing is written.
	 */
	PRICE_FROM_PROVIDER: 409,
	/**
	 * A delete of an account a bank still feeds, Sure's `cannot_delete_linked`:
	 * the account is unlinked first, or its bank disconnected.
	 */
	ACCOUNT_LINKED: 409,
	/** An unlink of an account no bank account feeds, Sure's `not_linked`. Nothing is written. */
	ACCOUNT_NOT_LINKED: 409,
	/**
	 * A default account for new transactions that is not an active, unlinked
	 * depository or credit card, as Sure's `eligible_for_transaction_default?`.
	 * Nothing is written.
	 */
	DEFAULT_ACCOUNT_NOT_ELIGIBLE: 409,
	/**
	 * A change of the Enable Banking credentials while a bank is connected:
	 * its session belongs to the current application, so it is disconnected first.
	 */
	BANK_CREDENTIALS_LOCKED: 409,
	/** A change of credentials the server's `ENABLE_BANKING_*` variables pin. */
	BANK_CREDENTIALS_FROM_ENVIRONMENT: 409,
	/** Enable Banking refused the application ID and private key submitted. Nothing is written. */
	BANK_CREDENTIALS_REFUSED: 400,
	/** An unknown, already used or expired `state` on a bank's callback. Nothing is written. */
	BANK_AUTHORIZATION_INVALID: 400,
	INTERNAL_ERROR: 500,
	/** Enable Banking failed or answered what its schema does not allow. No payload is kept. */
	BANK_PROVIDER_ERROR: 502,
	/**
	 * Enable Banking refused the callback URL, or the application checked
	 * before saving its credentials does not list it; it must be registered
	 * in its control panel, and `params.url` names it, as Sure does.
	 */
	BANK_REDIRECT_NOT_ALLOWED: 502,
	/**
	 * A sync's last state, never an answer: the lines synced but the bank gave
	 * no balance, so the account keeps the one of the sync before.
	 */
	BANK_BALANCE_UNAVAILABLE: 502,
	/**
	 * The price provider failed, timed out or answered what its schema does not
	 * allow. A run's last state: it stops there, and no security counts it.
	 */
	PRICE_PROVIDER_ERROR: 502,
	/**
	 * The provider has no usable price for a security: an unknown symbol, no
	 * close, or a currency other than the security's. A run's last state; five
	 * in a row set the security offline.
	 */
	PRICE_UNAVAILABLE: 502,
	/** The health check could not read the database. */
	SERVICE_UNAVAILABLE: 503,
	/** A bank route while `ENCRYPTION_KEY` is unset or no Enable Banking credentials apply. */
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
