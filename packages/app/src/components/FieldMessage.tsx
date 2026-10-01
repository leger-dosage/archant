import { useTranslation } from "react-i18next";

import { fieldErrorCode } from "@/lib/form-errors";

/** A field's error, translated from its code, under the field `id` describes. */
export function FieldMessage({
	id,
	error,
}: {
	id: string;
	error: { type: string; message?: string } | undefined;
}) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	return (
		<p id={id} className="text-xs text-destructive">
			{t(`errors.fields.${fieldErrorCode(error)}`)}
		</p>
	);
}
