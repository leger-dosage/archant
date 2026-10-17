import type { ErrorCode } from "./api";

import { t } from "i18next";
import { toast } from "sonner";

import { ApiError, errorCodeOf } from "./api";

/**
 * Shows a failed call as a destructive toast. `UNAUTHORIZED` shows nothing:
 * the query client already sends the visitor to sign-in, which says enough.
 */
export function showErrorToast(code: Exclude<ErrorCode, "fields">): void {
	if (code === "UNAUTHORIZED") {
		return;
	}

	toast.error(t(`errors.${code}`));
}

/**
 * The translated message of any failure, with the values its translation
 * names: the redirect URL to register with Enable Banking, a file's limit.
 */
export function errorMessage(error: unknown): string {
	const code = errorCodeOf(error);
	const params = error instanceof ApiError ? error.params : {};

	if (code === "BANK_REDIRECT_NOT_ALLOWED") {
		return t("errors.BANK_REDIRECT_NOT_ALLOWED", { url: params["url"] ?? "" });
	}

	if (code === "IMPORT_FILE_TOO_LARGE") {
		return t("errors.IMPORT_FILE_TOO_LARGE", { maxSize: params["maxSize"] ?? "" });
	}

	if (code === "IMPORT_TOO_MANY_ROWS") {
		return t("errors.IMPORT_TOO_MANY_ROWS", { max: params["max"] ?? "" });
	}

	return t(`errors.${code}`);
}

/** `showErrorToast` for a caught error, its translation's values included. */
export function showFailureToast(error: unknown): void {
	if (errorCodeOf(error) === "UNAUTHORIZED") {
		return;
	}

	toast.error(errorMessage(error));
}
