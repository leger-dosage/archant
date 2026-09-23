import type { AccountDetailData } from "@/hooks/useAccount";
import type { FieldError, UseFormReturn } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AccountSettingsFormInput } from "@archant/api/schemas/accounts";
import { accountSettingsFormSchema } from "@archant/api/schemas/accounts";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoanDetailsFields } from "@/components/LoanDetailsFields";
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
import { Switch } from "@/components/ui/switch";
import { useDeleteAccount, useUpdateAccount } from "@/hooks/useAccounts";
import { useAccountTransactions } from "@/hooks/useTransactions";
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

const countFormat = new Intl.NumberFormat("fr-FR");

function toastError(error: unknown) {
	const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";

	showErrorToast(code);
}

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

function SettingsForm({ account }: { account: AccountDetailData }) {
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
			toast.success(t("accountSettings.saved", { name: saved.name }));
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				toastError(apiError);
			}
		}
	});

	return (
		<form
			noValidate
			aria-labelledby="account-settings-title"
			className="flex max-w-md flex-col gap-4"
			onSubmit={(event) => void submit(event)}
		>
			<h2 id="account-settings-title" className="text-lg font-semibold">
				{t("accountSettings.title")}
			</h2>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="account-name">{t("accountSettings.name")}</Label>
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
					<Label htmlFor="account-subtype">{t("accountSettings.subtype")}</Label>
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
					<Label htmlFor="account-excluded">{t("accountSettings.excludedFromReports")}</Label>
					<p id="account-excluded-hint" className="text-xs text-muted-foreground">
						{t("accountSettings.excludedFromReportsHint")}
					</p>
				</div>
			</div>

			<Button type="submit" className="self-start" disabled={isSubmitting}>
				{t("accountSettings.save")}
			</Button>
		</form>
	);
}

function ActivationSection({ account }: { account: AccountDetailData }) {
	const { t } = useTranslation();
	const updateAccount = useUpdateAccount(account.id);
	const key = account.active ? "deactivate" : "reactivate";

	// No confirmation: deactivating loses nothing and is undone in one click.
	const toggle = async () => {
		try {
			const saved = await updateAccount.mutateAsync({ active: !account.active });
			toast.success(
				t(
					saved.active
						? "accountSettings.activation.reactivated"
						: "accountSettings.activation.deactivated",
					{ name: saved.name },
				),
			);
		} catch (error) {
			toastError(error);
		}
	};

	return (
		<section aria-labelledby="account-activation-title" className="flex max-w-md flex-col gap-2">
			<h2 id="account-activation-title" className="text-lg font-semibold">
				{t(`accountSettings.activation.${key}Title`)}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t(`accountSettings.activation.${key}Description`)}
			</p>
			<Button
				variant="outline"
				className="self-start"
				disabled={updateAccount.isPending}
				onClick={() => void toggle()}
			>
				{t(`accountSettings.activation.${key}`)}
			</Button>
		</section>
	);
}

function DeleteSection({ account }: { account: AccountDetailData }) {
	const { t } = useTranslation();
	const [confirming, setConfirming] = useState(false);
	const deleteAccount = useDeleteAccount(account.id);
	// The same first page the Opérations tab reads: its total is the count.
	const transactions = useAccountTransactions(account.id, 1);
	const count = transactions.isPlaceholderData ? undefined : transactions.data?.total;
	const title =
		count === 0
			? t("accountSettings.delete.titleEmpty", { name: account.name })
			: t("accountSettings.delete.title", {
					name: account.name,
					count: count ?? 0,
					formatted: countFormat.format(count ?? 0),
				});

	// The hook leaves for `/comptes` itself, which closes the dialog with the page.
	const remove = async () => {
		try {
			await deleteAccount.mutateAsync();
			toast.success(t("accountSettings.delete.deleted", { name: account.name }));
		} catch (error) {
			toastError(error);
		}
	};

	return (
		<section aria-labelledby="account-delete-title" className="flex max-w-md flex-col gap-2">
			<h2 id="account-delete-title" className="text-lg font-semibold">
				{t("accountSettings.delete.sectionTitle")}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t("accountSettings.delete.sectionDescription")}
			</p>
			<Button
				variant="destructive"
				className="self-start"
				// The dialog states the count, so it waits for it.
				disabled={count === undefined}
				onClick={() => setConfirming(true)}
			>
				{t("accountSettings.delete.action")}
			</Button>

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={title}
				description={t("accountSettings.delete.description")}
				confirmLabel={t("accountSettings.delete.action")}
				destructive
				pending={deleteAccount.isPending}
				onConfirm={() => void remove()}
			/>
		</section>
	);
}

/** The account's Paramètres tab: its settings, then deactivation, then deletion. */
export function AccountSettings({ account }: { account: AccountDetailData }) {
	return (
		<div className="flex flex-col gap-8">
			<SettingsForm account={account} />
			<ActivationSection account={account} />
			<DeleteSection account={account} />
		</div>
	);
}
