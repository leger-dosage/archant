import type { FieldErrorCode, ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import { fieldErrorCode } from "@/lib/form-errors";

/**
 * A field's error, translated from its code, under the field `id` describes.
 * `messages` replaces a code's shared text where the field needs its own,
 * such as a card's APR, whose bounds are not a loan rate's.
 */
export function FieldMessage({
	id,
	error,
	messages,
}: {
	id: string;
	error: ShownError | undefined;
	messages?: Partial<Record<FieldErrorCode, string>>;
}) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	const code = fieldErrorCode(error);

	return (
		<p id={id} className="text-xs text-destructive">
			{messages?.[code] ?? t(`errors.fields.${code}`)}
		</p>
	);
}
