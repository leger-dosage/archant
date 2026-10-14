import type { FieldErrorCode, ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import { fieldErrorCode } from "@/lib/form-errors";

/**
 * A field's error, translated from its code, under the field `id` describes.
 * `date` fills the translation of a code that names one, such as the oldest
 * entry an opening balance must precede. `messages` replaces a code's
 * shared text where the field needs its own, such as a card's APR, whose
 * bounds are not a loan rate's.
 */
export function FieldMessage({
	id,
	error,
	date,
	messages,
}: {
	id: string;
	error: ShownError | undefined;
	date?: string;
	messages?: Partial<Record<FieldErrorCode, string>>;
}) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	const code = fieldErrorCode(error);

	return (
		<p id={id} className="text-xs text-destructive">
			{messages?.[code] ??
				(code === "not_before_oldest_entry"
					? t("errors.fields.not_before_oldest_entry", { date: date ?? "" })
					: t(`errors.fields.${code}`))}
		</p>
	);
}
