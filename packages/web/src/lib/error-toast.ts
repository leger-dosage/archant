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
 * names: the redirect URL to register with Enable Banking.
 */
export function errorMessage(error: unknown): string {
	const code = errorCodeOf(error);

	if (code === "BANK_REDIRECT_NOT_ALLOWED") {
		const url = error instanceof ApiError ? error.params["url"] : undefined;

		return t("errors.BANK_REDIRECT_NOT_ALLOWED", { url: url ?? "" });
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
