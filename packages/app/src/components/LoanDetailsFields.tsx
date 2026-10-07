import type { ShownError } from "@/lib/form-errors";

import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { LoanDetailsInput } from "@archant/api/schemas/accounts";
import type { LoanInsuranceType, LoanRateType } from "@archant/data/account-types";
import { LOAN_INSURANCE_TYPES, LOAN_RATE_TYPES } from "@archant/data/account-types";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type Scalar = Exclude<keyof LoanDetailsInput, "rateChanges">;

type LoanDetailsFieldsProps = {
	value: LoanDetailsInput;
	onChange: (value: LoanDetailsInput) => void;
	/** The error on a field of the details, by its key. */
	errorOf: (field: keyof LoanDetailsInput) => ShownError | undefined;
};

// Radix's select has no empty item, so « Aucune » stands for a blank insurance type.
const NO_INSURANCE = "none";

const isRateType = (value: string): value is LoanRateType =>
	LOAN_RATE_TYPES.some((type) => type === value);

const isInsuranceType = (value: string): value is LoanInsuranceType =>
	LOAN_INSURANCE_TYPES.some((type) => type === value);

/**
 * A loan's terms in Sure's order, as the create dialog and the account edit
 * dialog both edit them. The form holds them as one value, so this stays
 * typed without knowing either form. Rate changes show for a variable or
 * adjustable rate only, and stay in the value when hidden, as Sure's
 * `rate_changes=` keeps them.
 * A row emptied and left is skipped on save, as in Sure.
 */
export function LoanDetailsFields({ value, onChange, errorOf }: LoanDetailsFieldsProps) {
	const { t } = useTranslation();
	const errors = {
		originalAmount: errorOf("originalAmount"),
		downPayment: errorOf("downPayment"),
		startDate: errorOf("startDate"),
		termMonths: errorOf("termMonths"),
		rateType: errorOf("rateType"),
		interestRate: errorOf("interestRate"),
		insuranceRate: errorOf("insuranceRate"),
		insuranceRateType: errorOf("insuranceRateType"),
		rateChanges: errorOf("rateChanges"),
	};
	const set = (patch: Partial<LoanDetailsInput>) => onChange({ ...value, ...patch });
	const described = (field: Scalar, hint?: string) => {
		const ids = [hint, errors[field] === undefined ? undefined : `loan-${field}-error`].filter(
			(id) => id !== undefined,
		);

		return ids.length === 0 ? {} : { "aria-describedby": ids.join(" ") };
	};
	const text = (field: Scalar) => ({
		id: `loan-${field}`,
		autoComplete: "off",
		value: value[field] ?? "",
		"aria-invalid": errors[field] !== undefined,
	});
	const [changesOpen, setChangesOpen] = useState(false);
	const rateChanges = value.rateChanges ?? [];
	// A date field keeps the text being typed, so a row keeps its key when one above it is removed.
	const [rowKeys, setRowKeys] = useState(() => rateChanges.map((_, index) => index));
	const followsChanges = value.rateType === "variable" || value.rateType === "adjustable";

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="loan-originalAmount">{t("loanDetails.originalAmount")}</Label>
				<Input
					{...text("originalAmount")}
					inputMode="decimal"
					className="text-right tabular-nums"
					{...described("originalAmount")}
					onChange={(event) => set({ originalAmount: event.target.value })}
				/>
				<FieldMessage id="loan-originalAmount-error" error={errors.originalAmount} />
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-interestRate">{t("loanDetails.interestRate")}</Label>
					<Input
						{...text("interestRate")}
						inputMode="decimal"
						placeholder={t("loanDetails.interestRatePlaceholder")}
						className="text-right tabular-nums"
						{...described("interestRate")}
						onChange={(event) => set({ interestRate: event.target.value })}
					/>
					<FieldMessage id="loan-interestRate-error" error={errors.interestRate} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-rateType">{t("loanDetails.rateType")}</Label>
					<Select
						value={value.rateType || "fixed"}
						onValueChange={(rateType) => {
							if (isRateType(rateType)) {
								set({ rateType });
							}
						}}
					>
						<SelectTrigger
							id="loan-rateType"
							className="w-full"
							aria-invalid={errors.rateType !== undefined}
							{...described("rateType")}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{LOAN_RATE_TYPES.map((type) => (
								<SelectItem key={type} value={type}>
									{t(`loanDetails.rateTypes.${type}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<FieldMessage id="loan-rateType-error" error={errors.rateType} />
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="loan-downPayment">{t("loanDetails.downPayment")}</Label>
				<Input
					{...text("downPayment")}
					inputMode="decimal"
					className="text-right tabular-nums"
					{...described("downPayment")}
					onChange={(event) => set({ downPayment: event.target.value })}
				/>
				<FieldMessage id="loan-downPayment-error" error={errors.downPayment} />
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="loan-startDate">{t("loanDetails.startDate")}</Label>
				<DateField
					id="loan-startDate"
					value={value.startDate ?? ""}
					onChange={(startDate) => set({ startDate })}
					invalid={errors.startDate !== undefined}
					describedBy={
						errors.startDate === undefined
							? "loan-startDate-hint"
							: "loan-startDate-hint loan-startDate-error"
					}
				/>
				<p id="loan-startDate-hint" className="text-xs text-muted-foreground">
					{t("loanDetails.startDateHint")}
				</p>
				<FieldMessage id="loan-startDate-error" error={errors.startDate} />
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="loan-termMonths">{t("loanDetails.termMonths")}</Label>
				<Input
					{...text("termMonths")}
					inputMode="numeric"
					placeholder={t("loanDetails.termMonthsPlaceholder")}
					className="text-right tabular-nums"
					{...described("termMonths")}
					onChange={(event) => set({ termMonths: event.target.value })}
				/>
				<FieldMessage id="loan-termMonths-error" error={errors.termMonths} />
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-insuranceRate">{t("loanDetails.insuranceRate")}</Label>
					<Input
						{...text("insuranceRate")}
						inputMode="decimal"
						placeholder={t("loanDetails.insuranceRatePlaceholder")}
						className="text-right tabular-nums"
						{...described("insuranceRate", "loan-insurance-hint")}
						onChange={(event) => set({ insuranceRate: event.target.value })}
					/>
					<FieldMessage id="loan-insuranceRate-error" error={errors.insuranceRate} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="loan-insuranceRateType">{t("loanDetails.insuranceRateType")}</Label>
					<Select
						value={
							value.insuranceRateType === "" || value.insuranceRateType === undefined
								? NO_INSURANCE
								: value.insuranceRateType
						}
						onValueChange={(type) => set({ insuranceRateType: isInsuranceType(type) ? type : "" })}
					>
						<SelectTrigger
							id="loan-insuranceRateType"
							className="w-full"
							aria-invalid={errors.insuranceRateType !== undefined}
							{...described("insuranceRateType", "loan-insurance-hint")}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_INSURANCE}>
								{t("loanDetails.insuranceRateTypes.none")}
							</SelectItem>
							{LOAN_INSURANCE_TYPES.map((type) => (
								<SelectItem key={type} value={type}>
									{t(`loanDetails.insuranceRateTypes.${type}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<FieldMessage id="loan-insuranceRateType-error" error={errors.insuranceRateType} />
				</div>
			</div>
			<p id="loan-insurance-hint" className="text-xs text-muted-foreground">
				{t("loanDetails.insuranceHint")}
			</p>

			{followsChanges && (
				// Sure's disclosure, closed until asked for, and opened when one of its rows is refused.
				<details
					className="group"
					open={changesOpen || errors.rateChanges !== undefined}
					onToggle={(event) => setChangesOpen(event.currentTarget.open)}
				>
					<summary className="flex cursor-pointer items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon
							aria-hidden="true"
							className="size-4 transition-transform group-open:rotate-90"
						/>
						{t("loanDetails.rateChanges")}
					</summary>
					<fieldset
						className="mt-2 flex flex-col gap-3 border-l pl-4"
						aria-label={t("loanDetails.rateChanges")}
						aria-describedby={
							errors.rateChanges === undefined
								? "loan-rateChanges-hint"
								: "loan-rateChanges-hint loan-rateChanges-error"
						}
					>
						<p id="loan-rateChanges-hint" className="text-xs text-muted-foreground">
							{t("loanDetails.rateChangesHint")}
						</p>
						{rateChanges.length === 0 && (
							<p className="text-sm text-muted-foreground">{t("loanDetails.rateChangesEmpty")}</p>
						)}
						{rateChanges.map((change, index) => {
							const of = t("loanDetails.ofRateChange", { index: index + 1 });
							const update = (patch: Partial<typeof change>) =>
								set({
									rateChanges: rateChanges.map((row, at) =>
										at === index ? { ...row, ...patch } : row,
									),
								});

							return (
								<div
									key={rowKeys[index] ?? `new-${index}`}
									className="grid grid-cols-[1fr_7rem_auto] items-end gap-3"
								>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`loan-rateChange-${index}-date`}>
											{t("loanDetails.rateChangeDate")}
											<span className="sr-only"> {of}</span>
										</Label>
										<DateField
											id={`loan-rateChange-${index}-date`}
											value={change.effectiveDate}
											onChange={(effectiveDate) => update({ effectiveDate })}
											invalid={errors.rateChanges !== undefined}
											{...(errors.rateChanges === undefined
												? {}
												: { describedBy: "loan-rateChanges-error" })}
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`loan-rateChange-${index}-rate`}>
											{t("loanDetails.rateChangeRate")}
											<span className="sr-only"> {of}</span>
										</Label>
										<Input
											id={`loan-rateChange-${index}-rate`}
											autoComplete="off"
											inputMode="decimal"
											className="text-right tabular-nums"
											value={change.rate}
											aria-invalid={errors.rateChanges !== undefined}
											{...(errors.rateChanges === undefined
												? {}
												: { "aria-describedby": "loan-rateChanges-error" })}
											onChange={(event) => update({ rate: event.target.value })}
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										onClick={() => {
											setRowKeys((keys) => keys.filter((_, at) => at !== index));
											set({ rateChanges: rateChanges.filter((_, at) => at !== index) });
										}}
									>
										{t("loanDetails.removeRateChange")}
										<span className="sr-only"> {of}</span>
									</Button>
								</div>
							);
						})}
						<FieldMessage id="loan-rateChanges-error" error={errors.rateChanges} />
						<Button
							type="button"
							variant="outline"
							className="border-dashed"
							onClick={() => {
								setRowKeys((keys) => [...keys, Math.max(-1, ...keys) + 1]);
								set({ rateChanges: [...rateChanges, { effectiveDate: "", rate: "" }] });
							}}
						>
							<PlusIcon aria-hidden="true" />
							{t("loanDetails.addRateChange")}
						</Button>
					</fieldset>
				</details>
			)}
		</>
	);
}
