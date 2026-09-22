import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The closed set of failures the API reports. The interface translates each
 * code (`errors.<CODE>`), so adding one is a contract change, not a detail.
 */
export const ERROR_STATUSES = {
	NOT_FOUND: 404,
	VALIDATION_ERROR: 400,
	/** A file no source can read, or larger than 5 MB. Nothing is written. */
	INVALID_IMPORT_FILE: 400,
	/** The account changed between an import's preview and its confirmation. */
	IMPORT_PREVIEW_STALE: 409,
	INTERNAL_ERROR: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUSES;

/** One invalid field: its dotted path and a snake_case code the form translates. */
export type FieldError = { path: string; code: string };

export type ErrorBody = {
	error: { code: ErrorCode; message: string; fields?: FieldError[] };
};

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly status: (typeof ERROR_STATUSES)[ErrorCode];
	readonly fields: FieldError[] | undefined;

	constructor(code: ErrorCode, message: string, fields?: FieldError[]) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.status = ERROR_STATUSES[code];
		this.fields = fields;
	}

	toJSON(): ErrorBody {
		return {
			error: {
				code: this.code,
				message: this.message,
				...(this.fields === undefined ? {} : { fields: this.fields }),
			},
		};
	}
}
