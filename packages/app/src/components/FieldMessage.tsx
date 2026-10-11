import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import { fieldErrorCode } from "@/lib/form-errors";

/**
 * A field's error, translated from its code, under the field `id` describes.
 * `date` fills the translation of a code that names one, such as the oldest
 * entry an opening balance must precede.
 */
export function FieldMessage({
	id,
	error,
	date,
}: {
	id: string;
	error: ShownError | undefined;
	date?: string;
}) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	const code = fieldErrorCode(error);

	return (
		<p id={id} className="text-xs text-destructive">
			{code === "not_before_oldest_entry"
				? t("errors.fields.not_before_oldest_entry", { date: date ?? "" })
				: t(`errors.fields.${code}`)}
		</p>
	);
}
