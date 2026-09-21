import type { FieldError } from "./errors.ts";
import type { z } from "zod";

import { AppError } from "./errors.ts";

/**
 * The one mapping from a Zod failure to the `fields` of a `VALIDATION_ERROR`.
 * A built-in issue keeps its Zod code (`too_small`, `invalid_type`); a custom
 * refinement carries its code as its message (`invalid_amount`), which is how
 * the form's resolver sees it too.
 */
export function toFieldErrors(error: z.core.$ZodError): FieldError[] {
	return error.issues.map((issue) => ({
		path: issue.path.map(String).join("."),
		code: issue.code === "custom" ? issue.message : issue.code,
	}));
}

export function validationError(error: z.core.$ZodError): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", toFieldErrors(error));
}
