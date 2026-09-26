import type { ApiFieldError } from "./api.ts";
import type { FieldError, FieldValues, Path, UseFormSetError } from "react-hook-form";

import fr from "../locales/fr.json";

export type FieldErrorCode = keyof typeof fr.errors.fields;

function isFieldErrorCode(value: string): value is FieldErrorCode {
	return Object.hasOwn(fr.errors.fields, value);
}

/**
 * Puts the API's field errors on the form's fields. Returns the errors it
 * could not place, whose path names no field of this form, so the caller can
 * fall back to a toast rather than fail silently.
 */
export function applyFieldErrors<T extends FieldValues>(
	fields: readonly ApiFieldError[],
	fieldNames: readonly Path<T>[],
	setError: UseFormSetError<T>,
): ApiFieldError[] {
	const unplaced: ApiFieldError[] = [];

	for (const field of fields) {
		const name = fieldNames.find((candidate) => candidate === field.path);

		if (name === undefined) {
			unplaced.push(field);
		} else {
			setError(name, { type: field.code, message: field.code });
		}
	}

	return unplaced;
}

/**
 * The code to translate for an error on a field. The resolver reports a
 * built-in Zod issue by its code in `type`, and a custom one with the code in
 * `message`, exactly as the API's mapper does, so both land on the same key.
 */
export function fieldErrorCode(error: Pick<FieldError, "type" | "message">): FieldErrorCode {
	const code = error.type === "custom" ? error.message : String(error.type);

	return code !== undefined && isFieldErrorCode(code) ? code : "unknown";
}
