import { hc } from "hono/client";
import { z } from "zod";

import type { AppType } from "@archant/api/app";

import fr from "../locales/fr.json";

// Relative: Vite proxies `/api` in development and preview, and the API will
// serve the interface itself in production (Epic 3), so the browser never
// needs another origin.
export const api = hc<AppType>("/api");

export type ErrorCode = keyof typeof fr.errors;

export type ApiFieldError = { path: string; code: string };

const errorBody = z.object({
	error: z.object({
		code: z.string(),
		fields: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
		params: z.record(z.string(), z.string()).optional(),
	}),
});

function isErrorCode(value: string): value is Exclude<ErrorCode, "fields"> {
	return value !== "fields" && Object.hasOwn(fr.errors, value);
}

/** A failed call, reduced to what the interface translates and shows. */
export class ApiError extends Error {
	readonly code: Exclude<ErrorCode, "fields">;
	readonly fields: ApiFieldError[];
	/** Values the translation names, such as the QIF type a file was refused for. */
	readonly params: Record<string, string>;

	constructor(
		code: Exclude<ErrorCode, "fields">,
		fields: ApiFieldError[] = [],
		params: Record<string, string> = {},
	) {
		super(code);
		this.name = "ApiError";
		this.code = code;
		this.fields = fields;
		this.params = params;
	}
}

/** The code to translate for any failure, including one that never reached the API. */
export function errorCodeOf(error: unknown): Exclude<ErrorCode, "fields"> {
	return error instanceof ApiError ? error.code : "INTERNAL_ERROR";
}

/**
 * Turns a response into its `data`, or throws an `ApiError`. A body that is
 * not the API's envelope, such as the proxy's page when the API is down, is
 * reported as the server being unreachable.
 */
export async function unwrap<T>(
	request: Promise<{ ok: boolean; json: () => Promise<T> }>,
): Promise<T> {
	let response: { ok: boolean; json: () => Promise<T> };

	try {
		response = await request;
	} catch {
		throw new ApiError("NETWORK_ERROR");
	}

	if (response.ok) {
		return response.json();
	}

	const parsed = errorBody.safeParse(await response.json().catch(() => null));

	if (!parsed.success) {
		throw new ApiError("NETWORK_ERROR");
	}

	const { code, fields = [], params = {} } = parsed.data.error;

	throw new ApiError(isErrorCode(code) ? code : "INTERNAL_ERROR", fields, params);
}
