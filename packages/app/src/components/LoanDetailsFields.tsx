import type { FieldError, UseFormRegisterReturn } from "react-hook-form";

import { useTranslation } from "react-i18next";

import { DateField } from "@/components/DateField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldErrorCode } from "@/lib/form-errors";

type LoanDetailsFieldsProps = {
	originalAmount: UseFormRegisterReturn;
	interestRate: UseFormRegisterReturn;
	endDate: { value: string | undefined; onChange: (value: string) => void; onBlur: () => void };
	errors:
		| { originalAmount?: FieldError; interestRate?: FieldError; endDate?: FieldError }
		| undefined;
};

function FieldMessage({ id, error }: { id: string; error: FieldError | undefined }) {
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

/**
 * A loan's optional amount borrowed, rate and end date, as the create dialog
 * and the account edit dialog both edit them. Each form wires its own fields in, so
 * this stays typed without knowing the form.
 */
export function LoanDetailsFields({
	originalAmount,
	interestRate,
	endDate,
	errors,
}: LoanDetailsFieldsProps) {
	const { t } = useTranslation();
	const described = (field: "originalAmount" | "interestRate" | "endDate") =>
		errors?.[field] === undefined ? {} : { "aria-describedby": `loan-${field}-error` };

	return (
		<>
			<div className="grid grid-cols-[1fr_7rem] gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-originalAmount">{t("loanDetails.originalAmount")}</Label>
					<Input
						id="loan-originalAmount"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors?.originalAmount !== undefined}
						{...described("originalAmount")}
						{...originalAmount}
					/>
					<FieldMessage id="loan-originalAmount-error" error={errors?.originalAmount} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-interestRate">{t("loanDetails.interestRate")}</Label>
					<Input
						id="loan-interestRate"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors?.interestRate !== undefined}
						{...described("interestRate")}
						{...interestRate}
					/>
					<FieldMessage id="loan-interestRate-error" error={errors?.interestRate} />
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="loan-endDate">{t("loanDetails.endDate")}</Label>
				<DateField
					id="loan-endDate"
					value={endDate.value ?? ""}
					onChange={endDate.onChange}
					onBlur={endDate.onBlur}
					invalid={errors?.endDate !== undefined}
					{...(errors?.endDate === undefined ? {} : { describedBy: "loan-endDate-error" })}
				/>
				<FieldMessage id="loan-endDate-error" error={errors?.endDate} />
			</div>
		</>
	);
}
