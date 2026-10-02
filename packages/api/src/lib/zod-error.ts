import type { FieldError } from "./errors.ts";
import type { z } from "zod";

import { AppError } from "./errors.ts";

/**
 * The one mapping from a Zod failure to the `fields` of a `VALIDATION_ERROR`.
 * A built-in issue keeps its Zod code (`too_small`, `invalid_type`); a custom
 * refinement carries its code as its message (`invalid_amount`), which is how
 * the form's resolver sees it too. A key a strict object does not take is
 * named in its own path, so the caller sees which one to drop.
 */
export function toFieldErrors(error: z.core.$ZodError): FieldError[] {
	return error.issues.flatMap((issue) => {
		const path = issue.path.map(String);

		if (issue.code === "unrecognized_keys") {
			return issue.keys.map((key) => ({ path: [...path, key].join("."), code: issue.code }));
		}

		return [{ path: path.join("."), code: issue.code === "custom" ? issue.message : issue.code }];
	});
}

export function validationError(error: z.core.$ZodError): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", toFieldErrors(error));
}
