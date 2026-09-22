import type { ErrorCode } from "./api";

import { t } from "i18next";
import { toast } from "sonner";

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
