import type { AccountDetailData } from "@/hooks/useAccount";
import type { FieldError, UseFormReturn } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AccountSettingsFormInput } from "@archant/api/schemas/accounts";
import { accountSettingsFormSchema } from "@archant/api/schemas/accounts";

import { LoanDetailsFields } from "@/components/LoanDetailsFields";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUpdateAccount } from "@/hooks/useAccounts";
import { ACCOUNT_KINDS, kindOf } from "@/lib/account-kinds";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { loanDetailsToInput } from "@/lib/loan-details";

const FIELD_NAMES = [
	"name",
	"subtype",
	"excludedFromReports",
	"details.originalAmount",
	"details.interestRate",
	"details.endDate",
] as const;

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

/** Rendered for a loan only, so no other account's form ever holds `details`. */
function LoanFields({ form }: { form: UseFormReturn<AccountSettingsFormInput> }) {
	const endDate = useController({ control: form.control, name: "details.endDate" });

	return (
		<LoanDetailsFields
			originalAmount={form.register("details.originalAmount")}
			interestRate={form.register("details.interestRate")}
			endDate={endDate.field}
			errors={form.formState.errors.details}
		/>
	);
}

type EditAccountDialogProps = {
	account: AccountDetailData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * What Sure's account edit form changes: the name, the subtype within its
 * type, a loan's details and the exclusion switch. Type, currency and the
 * opening balance stay as the account was created.
 */
export function EditAccountDialog({ account, open, onOpenChange }: EditAccountDialogProps) {
	const { t } = useTranslation();
	const updateAccount = useUpdateAccount(account.id);
	const isLoan = account.type === "loan";
	const values: AccountSettingsFormInput = {
		name: account.name,
		subtype: account.subtype,
		excludedFromReports: account.excludedFromReports,
		...(isLoan ? { details: loanDetailsToInput(account.details, account.currency) } : {}),
	};
	const resolver = useMemo(
		// `raw` sends the name as typed; the API trims it with the same schema.
		() => zodResolver(accountSettingsFormSchema(account.currency), undefined, { raw: true }),
		[account.currency],
	);
	const form = useForm<AccountSettingsFormInput>({
		resolver,
		// Follows the saved account, so the form never shows a stale name.
		values,
	});
	const { errors, isSubmitting } = form.formState;
	const subtype = useController({ control: form.control, name: "subtype" });
	const excluded = useController({ control: form.control, name: "excludedFromReports" });
	// A credit card and a vehicle have no subtype, so they have nothing to choose.
	const kinds = ACCOUNT_KINDS.filter((kind) => kind.type === account.type);

	// Closing without saving drops what was typed: the next opening shows the account as saved.
	const close = (next: boolean) => {
		if (!next) {
			form.reset(values);
		}
		onOpenChange(next);
	};

	const submit = form.handleSubmit(async ({ details, ...input }) => {
		try {
			// The API replaces the details whole, so all three always go.
			const saved = await updateAccount.mutateAsync(
				isLoan
					? {
							...input,
							details: {
								originalAmount: details?.originalAmount ?? "",
								interestRate: details?.interestRate ?? "",
								endDate: details?.endDate ?? "",
							},
						}
					: input,
			);
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
			<DialogContent showCloseButton={false}>
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
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="account-subtype">{t("accountActions.form.subtype")}</Label>
							<Select
								value={kindOf(account.type, subtype.field.value)}
								onValueChange={(value) => {
									const next = kinds.find((kind) => kind.id === value);

									if (next !== undefined) {
										subtype.field.onChange(next.subtype);
									}
								}}
							>
								<SelectTrigger
									id="account-subtype"
									className="w-full"
									aria-invalid={errors.subtype !== undefined}
									{...(errors.subtype === undefined
										? {}
										: { "aria-describedby": "account-subtype-error" })}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{kinds.map((kind) => (
										<SelectItem key={kind.id} value={kind.id}>
											{t(`accounts.subtypes.${kind.id}`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldMessage id="account-subtype-error" error={errors.subtype} />
						</div>
					)}

					{isLoan && <LoanFields form={form} />}

					<div className="flex items-start gap-3">
						<Switch
							id="account-excluded"
							checked={excluded.field.value}
							onCheckedChange={excluded.field.onChange}
							onBlur={excluded.field.onBlur}
							aria-describedby="account-excluded-hint"
							className="mt-0.5"
						/>
						<div className="flex flex-col gap-1">
							<Label htmlFor="account-excluded">
								{t("accountActions.form.excludedFromReports")}
							</Label>
							<p id="account-excluded-hint" className="text-xs text-muted-foreground">
								{t("accountActions.form.excludedFromReportsHint")}
							</p>
						</div>
					</div>
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
