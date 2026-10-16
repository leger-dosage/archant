import type { AccountDetailData } from "@/hooks/useAccount";
import type { RefObject } from "react";
import type { UseFormReturn } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AccountSettingsFormInput } from "@archant/api/schemas/accounts";
import { accountSettingsFormSchema } from "@archant/api/schemas/accounts";
import {
	creditCardDetailsOf,
	cryptoDetailsOf,
	loanDetailsOf,
	propertyDetailsOf,
	vehicleDetailsOf,
} from "@archant/data/account-types";

import {
	ADDITIONAL_DETAIL_NAMES,
	AccountAdditionalDetails,
	ExcludedFromReportsSwitch,
} from "@/components/AccountAdditionalDetails";
import { AccountSubtypeSelect } from "@/components/AccountSubtypeSelect";
import { CreditCardDetailsFields } from "@/components/CreditCardDetailsFields";
import { CryptoDetailsFields } from "@/components/CryptoDetailsFields";
import { FieldMessage } from "@/components/FieldMessage";
import { LoanDetailsFields } from "@/components/LoanDetailsFields";
import { OtherAssetNotice } from "@/components/OtherAssetNotice";
import { PropertyDetailsFields } from "@/components/PropertyDetailsFields";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { VehicleDetailsFields } from "@/components/VehicleDetailsFields";
import { useUpdateAccount } from "@/hooks/useAccounts";
import { ACCOUNT_KINDS } from "@/lib/account-kinds";
import { ApiError } from "@/lib/api";
import {
	CRYPTO_FIELD_NAMES,
	PROPERTY_FIELD_NAMES,
	VEHICLE_FIELD_NAMES,
	completeCryptoInput,
	completePropertyInput,
	completeVehicleInput,
	cryptoDetailsToInput,
	propertyDetailsToInput,
	vehicleDetailsToInput,
} from "@/lib/asset-details";
import {
	CREDIT_CARD_FIELD_NAMES,
	completeCreditCardInput,
	creditCardDetailsToInput,
} from "@/lib/credit-card-details";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";
import { LOAN_FIELD_NAMES, completeLoanInput, loanDetailsToInput } from "@/lib/loan-details";

const FIELD_NAMES = [
	"name",
	"subtype",
	"excludedFromReports",
	"treatBalanceAsAvailableCredit",
	...ADDITIONAL_DETAIL_NAMES,
	...LOAN_FIELD_NAMES,
	...CREDIT_CARD_FIELD_NAMES,
	...PROPERTY_FIELD_NAMES,
	...VEHICLE_FIELD_NAMES,
	...CRYPTO_FIELD_NAMES,
] as const;

/** Rendered for a loan only, so no other account's form ever holds a loan's `details`. */
function LoanFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const details = useController({ control: form.control, name: "details" });

	return (
		<LoanDetailsFields
			value={completeLoanInput(details.field.value)}
			onChange={details.field.onChange}
			errorOf={(field) => errorAt(form.formState.errors, `details.${field}`)}
		/>
	);
}

/** Rendered for a credit card only, so no other account's form ever holds a card's `details`. */
function CreditCardFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const details = useController({ control: form.control, name: "details" });

	return (
		<CreditCardDetailsFields
			value={completeCreditCardInput(details.field.value)}
			onChange={details.field.onChange}
			errorOf={(field) => errorAt(form.formState.errors, `details.${field}`)}
		/>
	);
}

/** Rendered for a property only, so no other account's form ever holds a property's `details`. */
function PropertyFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const details = useController({ control: form.control, name: "details" });

	return (
		<PropertyDetailsFields
			value={completePropertyInput(details.field.value)}
			onChange={details.field.onChange}
			errorOf={(field) => errorAt(form.formState.errors, `details.${field}`)}
		/>
	);
}

/** Rendered for a vehicle only, so no other account's form ever holds a vehicle's `details`. */
function VehicleFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const details = useController({ control: form.control, name: "details" });

	return (
		<VehicleDetailsFields
			value={completeVehicleInput(details.field.value)}
			onChange={details.field.onChange}
			errorOf={(field) => errorAt(form.formState.errors, `details.${field}`)}
		/>
	);
}

/** Rendered for a crypto account only, so no other account's form ever holds its `details`. */
function CryptoFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const details = useController({ control: form.control, name: "details" });

	return (
		<CryptoDetailsFields
			value={completeCryptoInput(details.field.value)}
			onChange={details.field.onChange}
			error={errorAt(form.formState.errors, "details.taxTreatment")}
		/>
	);
}

/**
 * Sure's « Le solde correspond au crédit disponible », rendered for a card a
 * bank feeds only: the setting is its bank account's.
 */
function AvailableCreditToggle({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const { t } = useTranslation();
	const toggle = useController({ control: form.control, name: "treatBalanceAsAvailableCredit" });

	return (
		<div className="flex items-start gap-3">
			<Switch
				id="account-available-credit"
				checked={toggle.field.value ?? false}
				onCheckedChange={toggle.field.onChange}
				onBlur={toggle.field.onBlur}
				aria-describedby="account-available-credit-hint"
				className="mt-0.5"
			/>
			<div className="flex flex-col gap-1">
				<Label htmlFor="account-available-credit">
					{t("accountActions.form.treatBalanceAsAvailableCredit")}
				</Label>
				<p id="account-available-credit-hint" className="text-xs text-muted-foreground">
					{t("accountActions.form.treatBalanceAsAvailableCreditHint")}
				</p>
			</div>
		</div>
	);
}

type EditAccountDialogProps = {
	account: AccountDetailData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Where focus goes once the dialog has closed, when it was opened from a
	 * menu item: Radix returns it to whatever held focus as the dialog
	 * opened, and the menu, closing at the same moment, may still hold it
	 * with an item about to unmount, which leaves focus on the page's body.
	 */
	returnFocusTo?: RefObject<HTMLElement | null> | undefined;
};

/**
 * What Sure's account edit form changes: the name, the subtype within its
 * type, a loan's, a card's, a property's, a vehicle's or a crypto account's details, a linked
 * card's toggle, and « Détails supplémentaires »: the institution, the notes
 * and the exclusion switch. Type, currency and the opening balance stay as the
 * account was created.
 */
export function EditAccountDialog({
	account,
	open,
	onOpenChange,
	returnFocusTo,
}: EditAccountDialogProps) {
	const { t } = useTranslation();
	const updateAccount = useUpdateAccount(account.id);
	const isLoan = account.type === "loan";
	const isCard = account.type === "credit_card";
	const isProperty = account.type === "property";
	const isVehicle = account.type === "vehicle";
	const isCrypto = account.type === "crypto";
	const linkedCard = isCard && account.bankConnection !== null;
	const values: AccountSettingsFormInput = {
		name: account.name,
		subtype: account.subtype,
		excludedFromReports: account.excludedFromReports,
		// The stored values, never the bank's fallback, as Rails' `text_field`.
		institutionName: account.additionalDetails.institutionName ?? "",
		institutionDomain: account.additionalDetails.institutionDomain ?? "",
		notes: account.additionalDetails.notes ?? "",
		...(isLoan
			? {
					details: loanDetailsToInput(
						loanDetailsOf(account),
						account.currency,
						account.openingDate,
					),
				}
			: {}),
		...(isCard
			? { details: creditCardDetailsToInput(creditCardDetailsOf(account), account.currency) }
			: {}),
		...(isProperty ? { details: propertyDetailsToInput(propertyDetailsOf(account)) } : {}),
		...(isVehicle ? { details: vehicleDetailsToInput(vehicleDetailsOf(account)) } : {}),
		...(isCrypto ? { details: cryptoDetailsToInput(cryptoDetailsOf(account)) } : {}),
		...(linkedCard
			? { treatBalanceAsAvailableCredit: account.treatBalanceAsAvailableCredit ?? false }
			: {}),
	};
	const resolver = useMemo(
		// `raw` sends the name as typed; the API trims it with the same schema.
		() =>
			zodResolver(
				accountSettingsFormSchema({
					type: account.type,
					currency: account.currency,
					openingDate: account.openingDate,
				}),
				undefined,
				{ raw: true },
			),
		[account.type, account.currency, account.openingDate],
	);
	const form = useForm<AccountSettingsFormInput>({
		resolver,
		// Follows the saved account, so the form never shows a stale name.
		values,
	});
	const { errors, isSubmitting } = form.formState;
	const subtype = useController({ control: form.control, name: "subtype" });
	const excluded = useController({ control: form.control, name: "excludedFromReports" });
	// A credit card, a vehicle, an other asset and an other liability have no
	// subtype, so they have nothing to choose.
	const kinds = ACCOUNT_KINDS.filter((kind) => kind.type === account.type);

	// Closing without saving drops what was typed: the next opening shows the account as saved.
	const close = (next: boolean) => {
		if (!next) {
			form.reset(values);
		}
		onOpenChange(next);
	};

	const submit = form.handleSubmit(async ({ details, treatBalanceAsAvailableCredit, ...input }) => {
		try {
			// The API replaces the details whole, so every field always goes.
			const saved = await updateAccount.mutateAsync({
				...input,
				...(isLoan ? { details: completeLoanInput(details) } : {}),
				...(isCard ? { details: completeCreditCardInput(details) } : {}),
				...(isProperty ? { details: completePropertyInput(details) } : {}),
				...(isVehicle ? { details: completeVehicleInput(details) } : {}),
				...(isCrypto ? { details: completeCryptoInput(details) } : {}),
				...(linkedCard ? { treatBalanceAsAvailableCredit } : {}),
			});
			toast.success(t("accountActions.form.saved", { name: saved.name }));
			onOpenChange(false);
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}
		}
	});

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				showCloseButton={false}
				className="max-h-[90vh] overflow-y-auto"
				onCloseAutoFocus={(event) => {
					const target = returnFocusTo?.current;

					if (target?.isConnected === true) {
						event.preventDefault();
						target.focus();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("accountActions.form.title")}</DialogTitle>
					<DialogDescription>{t("accountActions.form.description")}</DialogDescription>
				</DialogHeader>
				<form
					id="edit-account"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					{account.type === "other_asset" && <OtherAssetNotice />}

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="account-name">{t("accountActions.form.name")}</Label>
						<Input
							id="account-name"
							autoComplete="off"
							aria-invalid={errors.name !== undefined}
							{...(errors.name === undefined ? {} : { "aria-describedby": "account-name-error" })}
							{...form.register("name")}
						/>
						<FieldMessage id="account-name-error" error={errors.name} />
					</div>

					{kinds.length > 1 && (
						<AccountSubtypeSelect
							id="account-subtype"
							type={account.type}
							value={subtype.field.value}
							onChange={subtype.field.onChange}
							error={errors.subtype}
							label={t("accountActions.form.subtype")}
						/>
					)}

					{isLoan && <LoanFields form={form} />}

					{isCard && <CreditCardFields form={form} />}

					{isProperty && <PropertyFields form={form} />}

					{isVehicle && <VehicleFields form={form} />}

					{isCrypto && <CryptoFields form={form} />}

					{linkedCard && <AvailableCreditToggle form={form} />}

					<AccountAdditionalDetails
						idPrefix="account-"
						register={(name) => form.register(name)}
						errorOf={(name) => errors[name]}
						bankName={account.bankConnection?.institutionName}
					>
						{/* Last in the disclosure, as in Sure's form. */}
						<ExcludedFromReportsSwitch
							id="account-excluded"
							checked={excluded.field.value}
							onCheckedChange={excluded.field.onChange}
							onBlur={excluded.field.onBlur}
						/>
					</AccountAdditionalDetails>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => close(false)}>
						{t("accountActions.form.cancel")}
					</Button>
					<Button type="submit" form="edit-account" disabled={isSubmitting}>
						{t("accountActions.form.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
