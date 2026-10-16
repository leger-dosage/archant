import type { CreationStep, PropertyStep } from "@/lib/account-creation";
import type { FieldErrors } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CreateAccountInput } from "@archant/api/schemas/accounts";
import { createAccountFormSchema } from "@archant/api/schemas/accounts";
import type { AccountType } from "@archant/data/account-types";
import { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import {
	ADDITIONAL_DETAIL_NAMES,
	AccountAdditionalDetails,
	ExcludedFromReportsSwitch,
} from "@/components/AccountAdditionalDetails";
import {
	AccountTypeChoices,
	ChoicesFooter,
	FIRST_CHOICE,
	MethodChoices,
	moveBetweenChoices,
} from "@/components/AccountCreationChoices";
import { AccountSubtypeSelect } from "@/components/AccountSubtypeSelect";
import { CreditCardDetailsFields } from "@/components/CreditCardDetailsFields";
import { CryptoDetailsFields } from "@/components/CryptoDetailsFields";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { LoanDetailsFields } from "@/components/LoanDetailsFields";
import { OtherAssetNotice } from "@/components/OtherAssetNotice";
import { PropertyAddressFields, PropertyOverviewFields } from "@/components/PropertyDetailsFields";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
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
import { VehicleDetailsFields } from "@/components/VehicleDetailsFields";
import { useCreateAccount } from "@/hooks/useAccounts";
import {
	PROPERTY_STEPS,
	PROPERTY_STEP_FIELDS,
	firstPropertyStepOf,
	nextPropertyStep,
	previousStep,
	stepAfterType,
} from "@/lib/account-creation";
import { ApiError } from "@/lib/api";
import {
	CRYPTO_FIELD_NAMES,
	PROPERTY_FIELD_NAMES,
	VEHICLE_FIELD_NAMES,
	completeCryptoInput,
	completePropertyInput,
	completeVehicleInput,
} from "@/lib/asset-details";
import { CREDIT_CARD_FIELD_NAMES, completeCreditCardInput } from "@/lib/credit-card-details";
import { yearsAgo } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";
import { LOAN_FIELD_NAMES, completeLoanInput } from "@/lib/loan-details";
import { cn } from "@/lib/utils";

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
	...ADDITIONAL_DETAIL_NAMES,
	"excludedFromReports",
	...LOAN_FIELD_NAMES,
	...CREDIT_CARD_FIELD_NAMES,
	...PROPERTY_FIELD_NAMES,
	...VEHICLE_FIELD_NAMES,
	...CRYPTO_FIELD_NAMES,
] as const;

/** A type's details with every field blank; none for a type without any. */
function blankDetails(type: AccountType): CreateAccountInput["details"] {
	switch (type) {
		case "loan":
			return completeLoanInput(undefined);
		case "credit_card":
			return completeCreditCardInput(undefined);
		case "property":
			return completePropertyInput(undefined);
		case "vehicle":
			return completeVehicleInput(undefined);
		case "crypto":
			return completeCryptoInput(undefined);
		default:
			return undefined;
	}
}

/**
 * A new account of `type`, each field as Sure's form opens it: no subtype,
 * Sure's `include_blank` or prompt.
 */
function defaultsFor(type: AccountType): CreateAccountInput {
	const details = blankDetails(type);

	return {
		name: "",
		type,
		subtype: null,
		currency: DEFAULT_CURRENCY,
		openingBalance: "",
		// Sure's `OpeningBalanceManager#default_date`: a line dated today must land
		// after the opening balance, which is an end-of-day balance.
		openingDate: yearsAgo(2),
		...(details === undefined ? {} : { details }),
		institutionName: "",
		institutionDomain: "",
		notes: "",
		excludedFromReports: false,
	};
}

// Only the chosen type's details are ever in the form: choosing a type starts
// its values afresh. `raw` hands the typed text to the API as is: the same
// schema parses it there, into minor units of the chosen currency.
const resolver = zodResolver(createAccountFormSchema, undefined, { raw: true });

/** The paths of a form's errors, as the API names its fields. */
function errorPaths(errors: FieldErrors<CreateAccountInput>): string[] {
	return Object.entries(errors).flatMap(([name, error]) =>
		name === "details" && error !== undefined && typeof error === "object"
			? [name, ...Object.keys(error).map((field) => `details.${field}`)]
			: [name],
	);
}

/** Sure's left tabs of `properties/_form_tabs`: an earlier step opens again, a later one waits. */
function PropertyStepTabs({
	current,
	onOpen,
}: {
	current: PropertyStep;
	onOpen: (step: PropertyStep) => void;
}) {
	const { t } = useTranslation();
	const currentIndex = PROPERTY_STEPS.indexOf(current);
	const tab = "flex items-center rounded-lg px-3 py-2 text-sm font-medium";

	return (
		<nav aria-label={t("accounts.new.property.steps")} className="shrink-0 sm:w-[156px]">
			<ol className="flex gap-0.5 sm:flex-col">
				{PROPERTY_STEPS.map((step, index) => (
					<li key={step}>
						{index === currentIndex ? (
							<span aria-current="step" className={cn(tab, "bg-muted text-foreground")}>
								{t(`accounts.new.property.${step}`)}
							</span>
						) : index < currentIndex ? (
							<button
								type="button"
								className={cn(
									tab,
									"w-full text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
								onClick={() => onOpen(step)}
							>
								{t(`accounts.new.property.${step}`)}
							</button>
						) : (
							<span className={cn(tab, "text-muted-foreground")}>
								{t(`accounts.new.property.${step}`)}
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

type CreateAccountDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Sure's account creation in its steps, in one dialog over one form: the
 * type (`accounts/new`), how to add it (`accounts/new/_method_selector`)
 * where Sure asks, then the type's own form; a property's in Sure's three
 * tabs. One `POST` at the end, so no half-made account is ever left.
 */
export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const createAccount = useCreateAccount();
	const [step, setStep] = useState<CreationStep>({ kind: "types" });
	const [shown, setShown] = useState(open);
	const content = useRef<HTMLDivElement>(null);
	const form = useForm<CreateAccountInput>({ resolver, defaultValues: defaultsFor("depository") });
	const { errors, isSubmitting } = form.formState;
	const currency = useController({ control: form.control, name: "currency" });
	const openingDate = useController({ control: form.control, name: "openingDate" });
	const subtype = useController({ control: form.control, name: "subtype" });
	const details = useController({ control: form.control, name: "details" });
	const excluded = useController({ control: form.control, name: "excludedFromReports" });
	const type = form.watch("type");
	const listed = step.kind === "types" || step.kind === "method";

	// Each opening starts from the type list; reset as it opens, so the
	// closing animation still shows the step it closes on.
	if (open !== shown) {
		setShown(open);

		if (open) {
			setStep({ kind: "types" });
		}
	}

	// A refused field first, so a refusal that opens its step lands on it.
	const focusFirst = () => {
		const root = content.current;

		(
			root?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
			root?.querySelector<HTMLElement>(`${FIRST_CHOICE}, input, [role="combobox"]`)
		)?.focus();
	};

	// A step replaces the element that held focus; the next one's first row
	// or field takes it, as a new page of Sure's would.
	useEffect(focusFirst, [step]);

	const chooseType = (chosen: AccountType) => {
		form.reset(defaultsFor(chosen));
		setStep(stepAfterType(chosen));
	};

	const back = () => {
		const previous = previousStep(step);

		if (previous !== null) {
			setStep(previous);
		}
	};

	// Sure's `link_with_provider`: Archant starts the Enable Banking flow from « Banques ».
	const linkBank = () => {
		onOpenChange(false);
		void navigate({ to: "/settings/banks" });
	};

	const openPropertyStepOf = (paths: readonly string[]) => {
		const refused = form.getValues("type") === "property" ? firstPropertyStepOf(paths) : null;

		if (refused !== null) {
			setStep({ kind: "property", step: refused });
		}
	};

	const submit = form.handleSubmit(
		async (values) => {
			try {
				const account = await createAccount.mutateAsync(values);
				toast.success(t("accounts.form.created", { name: account.name }));
				onOpenChange(false);
			} catch (error) {
				const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
				const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

				openPropertyStepOf(apiError.fields.map((field) => field.path));

				if (
					apiError.code !== "VALIDATION_ERROR" ||
					unplaced.length > 0 ||
					apiError.fields.length === 0
				) {
					showErrorToast(apiError.code);
				}
			}
		},
		(refused) => openPropertyStepOf(errorPaths(refused)),
	);

	// Sure's « Suivant »: the step's own fields are checked before the next opens.
	const nextPropertyStepOrSubmit = async (current: PropertyStep) => {
		const next = nextPropertyStep(current);

		if (next === null) {
			await submit();

			return;
		}

		if (await form.trigger([...PROPERTY_STEP_FIELDS[current]])) {
			setStep({ kind: "property", step: next });
		}
	};

	const title = () => {
		switch (step.kind) {
			case "types":
				return t("accounts.new.title");
			case "method":
				return t("accounts.new.method.title");
			case "form":
				return t(`accounts.new.formTitles.${step.type}`);
		}

		return step.step === "overview"
			? t("accounts.new.property.title")
			: t("accounts.new.property.manualTitle");
	};

	const describedBy = (name: (typeof TOP_FIELD_NAMES)[number]) =>
		errors[name] === undefined ? {} : { "aria-describedby": `${name}-error` };

	const nameField = (label: string, placeholder?: string) => (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="name">{label}</Label>
			<Input
				id="name"
				autoComplete="off"
				{...(placeholder === undefined ? {} : { placeholder })}
				aria-invalid={errors.name !== undefined}
				{...describedBy("name")}
				{...form.register("name")}
			/>
			<FieldMessage id="name-error" error={errors.name} />
		</div>
	);

	const subtypeField = (label: string, prompt?: string) => (
		<AccountSubtypeSelect
			id="subtype"
			type={type}
			value={subtype.field.value}
			onChange={subtype.field.onChange}
			error={errors.subtype}
			label={label}
			prompt={prompt}
		/>
	);

	const balanceFields = (balanceLabel: string) => (
		<>
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
					<Label htmlFor="openingBalance">{balanceLabel}</Label>
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
		</>
	);

	const additionalDetails = (
		<AccountAdditionalDetails
			idPrefix=""
			register={(name) => form.register(name)}
			errorOf={(name) => errors[name]}
		>
			<ExcludedFromReportsSwitch
				id="excludedFromReports"
				checked={excluded.field.value ?? false}
				onCheckedChange={excluded.field.onChange}
				onBlur={excluded.field.onBlur}
			/>
		</AccountAdditionalDetails>
	);

	const detailsError = (field: string) => errorAt(errors, `details.${field}`);

	// Sure's `accounts/_form`: name, balance and opening date, then the type's
	// own fields, then « Détails supplémentaires ».
	const typeForm = (
		<>
			{type === "other_asset" && <OtherAssetNotice />}
			{nameField(t("accounts.form.name"))}
			{balanceFields(t("accounts.form.balance"))}

			{(type === "depository" || type === "investment" || type === "crypto") &&
				subtypeField(t("accounts.new.subtype"))}

			{type === "crypto" && (
				<CryptoDetailsFields
					value={completeCryptoInput(details.field.value)}
					onChange={details.field.onChange}
					error={detailsError("taxTreatment")}
				/>
			)}

			{type === "credit_card" && (
				<CreditCardDetailsFields
					value={completeCreditCardInput(details.field.value)}
					onChange={details.field.onChange}
					errorOf={detailsError}
				/>
			)}

			{type === "vehicle" && (
				<VehicleDetailsFields
					value={completeVehicleInput(details.field.value)}
					onChange={details.field.onChange}
					errorOf={detailsError}
				/>
			)}

			{type === "loan" && (
				<>
					<LoanDetailsFields
						value={completeLoanInput(details.field.value)}
						onChange={details.field.onChange}
						errorOf={detailsError}
					/>
					{subtypeField(t("accounts.new.subtype"), t("accounts.new.loanSubtypePrompt"))}
				</>
			)}

			{additionalDetails}
		</>
	);

	const propertyFields = (current: PropertyStep) => {
		const value = completePropertyInput(details.field.value);

		switch (current) {
			case "overview":
				return (
					<>
						{nameField(t("accounts.new.property.name"), t("accounts.new.property.namePlaceholder"))}
						{subtypeField(t("accounts.new.property.type"), t("accounts.new.property.typePrompt"))}
						<PropertyOverviewFields
							value={value}
							onChange={details.field.onChange}
							errorOf={detailsError}
						/>
					</>
				);
			case "value":
				return balanceFields(t("accounts.new.property.marketValue"));
		}

		return (
			<>
				<PropertyAddressFields
					value={value}
					onChange={details.field.onChange}
					errorOf={detailsError}
				/>
				{additionalDetails}
			</>
		);
	};

	const body = () => {
		switch (step.kind) {
			case "types":
				return <AccountTypeChoices onChoose={chooseType} />;
			case "method":
				return (
					<MethodChoices
						type={step.type}
						onManual={() => setStep({ kind: "form", type: step.type })}
						onLink={linkBank}
					/>
				);
			case "form":
				return (
					<form
						id="create-account"
						noValidate
						className="flex flex-col gap-4"
						onSubmit={(event) => void submit(event)}
					>
						{typeForm}
					</form>
				);
		}

		return (
			<div className="flex flex-col gap-4 sm:flex-row">
				<PropertyStepTabs
					current={step.step}
					onOpen={(opened) => setStep({ kind: "property", step: opened })}
				/>
				<form
					id="create-account"
					noValidate
					className="flex min-w-0 flex-1 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void nextPropertyStepOrSubmit(step.step);
					}}
				>
					{propertyFields(step.step)}
				</form>
			</div>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* Sure's dialog has a title and no description. */}
			<DialogContent
				ref={content}
				aria-describedby={undefined}
				className={cn("max-h-[90vh] overflow-y-auto", step.kind === "property" && "sm:max-w-2xl")}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					focusFirst();
				}}
				{...(listed ? { onKeyDown: moveBetweenChoices } : {})}
			>
				<DialogHeader className="flex-row items-center gap-2 pr-8">
					{step.kind !== "types" && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("accounts.new.back")}
							onClick={back}
						>
							<ArrowLeftIcon aria-hidden="true" />
						</Button>
					)}
					<DialogTitle>{title()}</DialogTitle>
				</DialogHeader>

				{body()}

				{listed ? (
					<ChoicesFooter onClose={() => onOpenChange(false)} />
				) : (
					<DialogFooter>
						<Button type="submit" form="create-account" disabled={isSubmitting}>
							{step.kind === "property" && step.step !== "address"
								? t("accounts.new.property.next")
								: t("accounts.form.submit")}
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
