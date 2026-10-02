import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

import { zValidator } from "@hono/zod-validator";

import { validationError } from "./zod-error.ts";

/**
 * A route's Zod validator whose failure is the API's `VALIDATION_ERROR`, one
 * `{ path, code }` per invalid field, rather than the validator's own 400.
 */
export function validated<Target extends keyof ValidationTargets, Schema extends ZodType>(
	target: Target,
	schema: Schema,
) {
	return zValidator(target, schema, (result) => {
		if (!result.success) {
			throw validationError(result.error);
		}
	});
}
