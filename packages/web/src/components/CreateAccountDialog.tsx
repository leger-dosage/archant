import type { FieldError, Resolver } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CreateAccountInput } from "@archant/api/schemas/accounts";
import { createAccountSchema } from "@archant/api/schemas/accounts";
import { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { DateField } from "@/components/DateField";
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
import { useCreateAccount } from "@/hooks/useAccounts";
import { ACCOUNT_KINDS, kindOf } from "@/lib/account-kinds";
import { ApiError } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const TOP_FIELD_NAMES = [
	"name",
	"type",
	"subtype",
	"currency",
	"openingBalance",
	"openingDate",
] as const;

const FIELD_NAMES = [
	...TOP_FIELD_NAMES,
	"details.originalAmount",
	"details.interestRate",
	"details.endDate",
] as const;

const defaults = (): CreateAccountInput => ({
	name: "",
	type: "depository",
	subtype: "checking",
	currency: DEFAULT_CURRENCY,
	openingBalance: "",
	openingDate: toIsoDate(),
	details: { originalAmount: "", interestRate: "", endDate: "" },
});

const schemaResolver = zodResolver(createAccountSchema, undefined, { raw: true });

// The loan fields stay in the form's values when another type is picked, so
// switching back keeps what was typed; the API refuses details on any other
// type, so they are dropped before validation, and so before sending.
const resolver: Resolver<CreateAccountInput> = async (values, context, options) =>
	schemaResolver(
		values.type === "loan" ? values : { ...values, details: undefined },
		context,
		options,
	);

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

type CreateAccountDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
	const { t } = useTranslation();
	const createAccount = useCreateAccount();
	const form = useForm<CreateAccountInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the chosen currency.
		resolver,
		defaultValues: defaults(),
	});
	const { errors, isSubmitting } = form.formState;
	const currency = useController({ control: form.control, name: "currency" });
	const openingDate = useController({ control: form.control, name: "openingDate" });
	const endDate = useController({ control: form.control, name: "details.endDate" });
	const type = form.watch("type");
	const kind = kindOf(type, form.watch("subtype"));

	const close = (next: boolean) => {
		if (!next) {
			form.reset(defaults());
		}
		onOpenChange(next);
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			const account = await createAccount.mutateAsync(values);
			toast.success(t("accounts.form.created", { name: account.name }));
			close(false);
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

	const describedBy = (name: (typeof TOP_FIELD_NAMES)[number]) =>
		errors[name] === undefined ? {} : { "aria-describedby": `${name}-error` };

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("accounts.form.title")}</DialogTitle>
					<DialogDescription>{t("accounts.form.description")}</DialogDescription>
				</DialogHeader>
				<form
					id="create-account"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="name">{t("accounts.form.name")}</Label>
						<Input
							id="name"
							autoComplete="off"
							aria-invalid={errors.name !== undefined}
							{...describedBy("name")}
							{...form.register("name")}
						/>
						<FieldMessage id="name-error" error={errors.name} />
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="kind">{t("accounts.form.type")}</Label>
						<Select
							value={kind}
							onValueChange={(value) => {
								const next = ACCOUNT_KINDS.find((candidate) => candidate.id === value);

								if (next !== undefined) {
									// Revalidated so an error shown for the previous type clears.
									form.setValue("type", next.type, { shouldValidate: true });
									form.setValue("subtype", next.subtype, { shouldValidate: true });
								}
							}}
						>
							<SelectTrigger
								id="kind"
								className="w-full"
								aria-invalid={errors.subtype !== undefined || errors.type !== undefined}
								{...(errors.subtype === undefined && errors.type === undefined
									? {}
									: { "aria-describedby": "subtype-error" })}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ACCOUNT_KINDS.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{t(`accounts.subtypes.${option.id}`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<FieldMessage id="subtype-error" error={errors.subtype ?? errors.type} />
					</div>

					<div className="grid grid-cols-[7rem_1fr] gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="currency">{t("accounts.form.currency")}</Label>
							<Select
								value={currency.field.value}
								onValueChange={(value) => {
									if (isCurrencyCode(value)) {
										currency.field.onChange(value);
									}
								}}
							>
								<SelectTrigger
									id="currency"
									className="w-full"
									aria-invalid={errors.currency !== undefined}
									{...describedBy("currency")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="max-h-72">
									{CURRENCY_CODES.map((code) => (
										<SelectItem key={code} value={code}>
											{code}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldMessage id="currency-error" error={errors.currency} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="openingBalance">
								{t(
									type === "loan"
										? "accounts.form.outstandingBalance"
										: "accounts.form.openingBalance",
								)}
							</Label>
							<Input
								id="openingBalance"
								inputMode="decimal"
								autoComplete="off"
								className="text-right tabular-nums"
								aria-invalid={errors.openingBalance !== undefined}
								{...describedBy("openingBalance")}
								{...form.register("openingBalance")}
							/>
							<FieldMessage id="openingBalance-error" error={errors.openingBalance} />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="openingDate">{t("accounts.form.openingDate")}</Label>
						<DateField
							id="openingDate"
							value={openingDate.field.value}
							onChange={openingDate.field.onChange}
							onBlur={openingDate.field.onBlur}
							invalid={errors.openingDate !== undefined}
							{...(errors.openingDate === undefined ? {} : { describedBy: "openingDate-error" })}
						/>
						<FieldMessage id="openingDate-error" error={errors.openingDate} />
					</div>

					{type === "loan" && (
						<LoanDetailsFields
							originalAmount={form.register("details.originalAmount")}
							interestRate={form.register("details.interestRate")}
							endDate={endDate.field}
							errors={errors.details}
						/>
					)}
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => close(false)}>
						{t("accounts.form.cancel")}
					</Button>
					<Button type="submit" form="create-account" disabled={isSubmitting}>
						{t("accounts.form.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
