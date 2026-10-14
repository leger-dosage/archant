import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { CreditCardDetailsInput } from "@archant/api/schemas/accounts";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = keyof CreditCardDetailsInput;

type CreditCardDetailsFieldsProps = {
	value: CreditCardDetailsInput;
	onChange: (value: CreditCardDetailsInput) => void;
	/** The error on a field of the details, by its key. */
	errorOf: (field: Field) => ShownError | undefined;
};

const errorId = (field: Field) => `card-${field}-error`;

/**
 * A credit card's details in Sure's order and rows (`credit_cards/_form`), as
 * the create dialog and the account edit dialog both edit them, every one
 * optional. The form holds them as one value, so this stays typed without
 * knowing either form.
 */
export function CreditCardDetailsFields({
	value,
	onChange,
	errorOf,
}: CreditCardDetailsFieldsProps) {
	const { t } = useTranslation();
	const set = (patch: Partial<CreditCardDetailsInput>) => onChange({ ...value, ...patch });
	const input = (field: Exclude<Field, "expirationDate">, placeholder: string) => {
		const error = errorOf(field);

		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`card-${field}`}>{t(`creditCardDetails.${field}`)}</Label>
				<Input
					id={`card-${field}`}
					autoComplete="off"
					inputMode="decimal"
					placeholder={placeholder}
					className="text-right tabular-nums"
					value={value[field] ?? ""}
					aria-invalid={error !== undefined}
					{...(error === undefined ? {} : { "aria-describedby": errorId(field) })}
					onChange={(event) => set({ [field]: event.target.value })}
				/>
				<FieldMessage
					id={errorId(field)}
					error={error}
					{...(field === "apr"
						? { messages: { invalid_rate: t("creditCardDetails.invalidApr") } }
						: {})}
				/>
			</div>
		);
	};
	const expirationError = errorOf("expirationDate");

	return (
		<>
			{input("availableCredit", t("creditCardDetails.availableCreditPlaceholder"))}

			<div className="grid grid-cols-2 gap-3">
				{input("minimumPayment", t("creditCardDetails.minimumPaymentPlaceholder"))}
				{input("apr", t("creditCardDetails.aprPlaceholder"))}
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="card-expirationDate">{t("creditCardDetails.expirationDate")}</Label>
					<DateField
						id="card-expirationDate"
						value={value.expirationDate ?? ""}
						onChange={(expirationDate) => set({ expirationDate })}
						invalid={expirationError !== undefined}
						{...(expirationError === undefined ? {} : { describedBy: errorId("expirationDate") })}
					/>
					<FieldMessage
						id={errorId("expirationDate")}
						error={expirationError}
						messages={{ invalid_date: t("errors.fields.invalid_format") }}
					/>
				</div>
				{input("annualFee", t("creditCardDetails.annualFeePlaceholder"))}
			</div>
		</>
	);
}
