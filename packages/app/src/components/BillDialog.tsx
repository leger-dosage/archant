import type { AccountSummaryData } from "@/hooks/useAccounts";
import type { BillCandidateData, RecurringData } from "@/hooks/useRecurring";
import type { Path, Resolver, UseFormReturn } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useRef } from "react";
import { useController, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import type {
	BillKind,
	DeclareFormInput,
	EditFormInput,
	FrequencyKey,
} from "@archant/api/schemas/bills";
import {
	CUSTOM_PRESET,
	EDITABLE_BILL_TYPES,
	FREQUENCY_PRESETS,
	INTERVAL_PRESET,
	INTERVAL_UNITS,
	MAX_INTERVAL,
	declareBillSchema,
	editBillSchema,
	firstDueFrom,
} from "@archant/api/schemas/bills";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { DEFAULT_CURRENCY, isCurrencyCode, toMinorUnits } from "@archant/data/money";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { Money } from "@/components/Money";
import { CategoryField } from "@/components/TransactionFields";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	recurringName,
	useBillCandidates,
	useDeclareBill,
	useEditBill,
} from "@/hooks/useRecurring";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";

/** What the declare dialog starts from: a transaction, as Sure's `prefill_recurring_from_entry`. */
export type BillPrefill = {
	kind: BillKind;
	name: string;
	amount: string;
	accountId: string;
	firstDueOn: string;
	entryId: string;
};

/**
 * The form filled from a transaction: the merchant's name else the label,
 * the magnitude, the account, an income for money coming in, and its day
 * from today on.
 */
export function prefillFrom(entry: {
	id: string;
	name: string;
	amount: MinorUnits;
	currency: string;
	accountId: string;
	date: string;
}): BillPrefill {
	return {
		kind: entry.amount > 0 ? "income" : "bill",
		name: entry.name,
		amount: amountToText(toMinorUnits(Math.abs(entry.amount)), entry.currency),
		accountId: entry.accountId,
		firstDueOn: firstDueFrom(entry.date, toIsoDate()),
		entryId: entry.id,
	};
}

/**
 * What both forms hold: the declare dialog's fields and the edit dialog's,
 * each form reading its own and its schema the rest away, so the fields they
 * share are drawn once.
 */
type BillValues = DeclareFormInput & EditFormInput;

type BillForm = UseFormReturn<BillValues>;

const DECLARE_FIELDS = [
	"kind",
	"name",
	"amount",
	"accountId",
	"firstDueOn",
	"frequency.preset",
	"frequency.interval",
	"frequency.unit",
	"autopay",
	"notes",
	"paymentUrl",
] as const satisfies readonly Path<BillValues>[];

const EDIT_FIELDS = [
	"name",
	"amount",
	"accountId",
	"billType",
	"categoryId",
	"frequency.preset",
	"frequency.interval",
	"frequency.unit",
	"frequency.dayOfMonth",
	"frequency.secondDayOfMonth",
	"frequency.weekday",
	"frequency.monthOfYear",
	"endAfterCount",
	"autopay",
	"notes",
	"paymentUrl",
] as const satisfies readonly Path<BillValues>[];

/**
 * The edit schema over what the form holds, the declare dialog's fields
 * included, which an edit drops before it is sent.
 */
function editFormSchema(currency: CurrencyCode) {
	const schema = editBillSchema(currency);

	return z.custom<BillValues>().superRefine((values, context) => {
		const parsed = schema.safeParse(values);

		for (const issue of parsed.error?.issues ?? []) {
			// A built-in code travels as the message, which `fieldErrorCode` reads.
			context.addIssue({
				code: "custom",
				path: issue.path,
				message: issue.code === "custom" ? issue.message : issue.code,
			});
		}
	});
}

const errorId = (path: string) => `bill-${path.replaceAll(".", "-")}-error`;

const LAST_DAY = "-1";

// Monday first, as the calendar (EXPERIENCE.md); 0 is Sunday, as Ruby's.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

const weekdayName = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" });

const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

/** A capitalised day or month name, as a select lists it. */
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The currency amounts are read in: the chosen account's. */
function currencyOf(
	accounts: readonly AccountSummaryData[],
	accountId: string | undefined,
): CurrencyCode {
	const code = accounts.find((account) => account.id === accountId)?.currency;

	return code !== undefined && isCurrencyCode(code) ? code : DEFAULT_CURRENCY;
}

/** Puts an API refusal on its fields, else in a toast. */
function showError(
	error: unknown,
	fields: readonly Path<BillValues>[],
	setError: BillForm["setError"],
) {
	const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
	const unplaced = applyFieldErrors(apiError.fields, fields, setError);

	if (apiError.code !== "VALIDATION_ERROR" || unplaced.length > 0 || apiError.fields.length === 0) {
		showErrorToast(apiError.code);
	}
}

/** A labelled select over `options`, its error under it. */
function SelectField({
	form,
	name,
	label,
	options,
}: {
	form: BillForm;
	name: Path<BillValues>;
	label: string;
	options: readonly { value: string; label: string }[];
}) {
	const { field } = useController({ control: form.control, name });
	const error = errorAt(form.formState.errors, name);
	const id = `bill-${name.replaceAll(".", "-")}`;

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={typeof field.value === "string" ? field.value : ""}
				onValueChange={field.onChange}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-invalid={error !== undefined}
					{...(error === undefined ? {} : { "aria-describedby": errorId(name) })}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<FieldMessage id={errorId(name)} error={error} />
		</div>
	);
}

/** A labelled text field registered on `name`, its error under it. */
function TextField({
	form,
	name,
	label,
	hint,
	...input
}: {
	form: BillForm;
	name: Path<BillValues>;
	label: string;
	hint?: string;
	placeholder?: string;
	inputMode?: "decimal" | "numeric" | "url";
	className?: string;
}) {
	const error = errorAt(form.formState.errors, name);
	const id = `bill-${name.replaceAll(".", "-")}`;
	const described = [
		...(hint === undefined ? [] : [`${id}-hint`]),
		...(error === undefined ? [] : [errorId(name)]),
	];

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				autoComplete="off"
				aria-invalid={error !== undefined}
				{...(described.length === 0 ? {} : { "aria-describedby": described.join(" ") })}
				{...input}
				{...form.register(name)}
			/>
			{hint !== undefined && (
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					{hint}
				</p>
			)}
			<FieldMessage id={errorId(name)} error={error} />
		</div>
	);
}

/** Sure's frequency picker: a preset, every N weeks, months or years, and on an edit the day fields. */
function FrequencyFields({
	form,
	income,
	days,
	custom,
}: {
	form: BillForm;
	income: boolean;
	/** The edit dialog's day fields; a new series takes its days from its first date. */
	days: boolean;
	/** Offers « Échéancier personnalisé », for rules no preset expresses. */
	custom: boolean;
}) {
	const { t } = useTranslation();
	const preset = useWatch({ control: form.control, name: "frequency.preset" });
	const unit = useWatch({ control: form.control, name: "frequency.unit" });
	const interval = preset === INTERVAL_PRESET;
	const presets: FrequencyKey[] = [
		...FREQUENCY_PRESETS,
		INTERVAL_PRESET,
		...(custom ? ([CUSTOM_PRESET] as const) : []),
	];
	const shows = (keys: readonly string[], units: readonly string[]) =>
		keys.includes(preset ?? "") || (interval && units.includes(unit ?? ""));
	const dayOptions = [
		...Array.from({ length: 31 }, (_, index) => ({
			value: String(index + 1),
			label: String(index + 1),
		})),
		{ value: LAST_DAY, label: t("recurring.form.lastDay") },
	];

	return (
		<div className="flex flex-col gap-3">
			<SelectField
				form={form}
				name="frequency.preset"
				label={t(income ? "recurring.form.incomeFrequency" : "recurring.form.frequency")}
				options={presets.map((value) => ({
					value,
					label: t(`recurring.frequencyPresets.${value}`),
				}))}
			/>
			{interval && (
				<div className="grid grid-cols-2 gap-3">
					<TextField
						form={form}
						name="frequency.interval"
						label={t("recurring.form.interval")}
						inputMode="numeric"
						placeholder={`1–${MAX_INTERVAL}`}
					/>
					<SelectField
						form={form}
						name="frequency.unit"
						label={t("recurring.form.intervalUnit")}
						options={INTERVAL_UNITS.map((value) => ({
							value,
							label: t(`recurring.intervalUnits.${value}`),
						}))}
					/>
				</div>
			)}
			{days && (
				<div className="grid grid-cols-2 gap-3">
					{shows(
						["monthly", "semimonthly", "quarterly", "semiannual", "annual"],
						["monthly", "yearly"],
					) && (
						<SelectField
							form={form}
							name="frequency.dayOfMonth"
							label={t("recurring.form.day")}
							options={dayOptions}
						/>
					)}
					{shows(["semimonthly"], []) && (
						<SelectField
							form={form}
							name="frequency.secondDayOfMonth"
							label={t("recurring.form.secondDay")}
							options={dayOptions}
						/>
					)}
					{shows(["weekly", "biweekly"], ["weekly"]) && (
						<SelectField
							form={form}
							name="frequency.weekday"
							label={t("recurring.form.weekday")}
							options={WEEKDAYS.map((weekday) => ({
								value: String(weekday),
								// 4 January 1970 was a Sunday.
								label: capitalised(weekdayName.format(Date.UTC(1970, 0, 4 + weekday))),
							}))}
						/>
					)}
					{shows(["annual"], ["yearly"]) && (
						<SelectField
							form={form}
							name="frequency.monthOfYear"
							label={t("recurring.form.month")}
							options={Array.from({ length: 12 }, (_, index) => ({
								value: String(index + 1),
								label: capitalised(monthName.format(Date.UTC(2026, index, 1))),
							}))}
						/>
					)}
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				{t(
					days
						? income
							? "recurring.form.incomeFrequencyHint"
							: "recurring.form.frequencyHint"
						: income
							? "recurring.form.incomeFrequencyNewHint"
							: "recurring.form.frequencyNewHint",
				)}
			</p>
		</div>
	);
}

/** The account a bill is paid from, or an income paid into. */
function AccountField({
	form,
	accounts,
	income,
}: {
	form: BillForm;
	accounts: readonly AccountSummaryData[];
	income: boolean;
}) {
	const { t } = useTranslation();

	return (
		<SelectField
			form={form}
			name="accountId"
			label={t(income ? "recurring.form.incomeAccount" : "recurring.form.account")}
			options={accounts.map((account) => ({ value: account.id, label: account.name }))}
		/>
	);
}

/** Autopay, the payment link and the notes; an income has notes only, as Sure's form. */
function MoreFields({ form, income }: { form: BillForm; income: boolean }) {
	const { t } = useTranslation();
	const autopay = useController({ control: form.control, name: "autopay" });
	const notesError = errorAt(form.formState.errors, "notes");

	return (
		<fieldset className="flex flex-col gap-3">
			<legend className="mb-1 text-sm font-medium">{t("recurring.form.moreOptions")}</legend>
			{!income && (
				<>
					<TextField
						form={form}
						name="paymentUrl"
						label={t("recurring.form.paymentUrl")}
						hint={t("recurring.form.paymentUrlHint")}
						placeholder={t("recurring.form.paymentUrlPlaceholder")}
						inputMode="url"
					/>
					<div className="flex items-start gap-3">
						<Switch
							id="bill-autopay"
							checked={autopay.field.value ?? false}
							onCheckedChange={autopay.field.onChange}
							onBlur={autopay.field.onBlur}
							aria-describedby="bill-autopay-hint"
							className="mt-0.5"
						/>
						<div className="flex flex-col gap-1">
							<Label htmlFor="bill-autopay">{t("recurring.form.autopay")}</Label>
							<p id="bill-autopay-hint" className="text-xs text-muted-foreground">
								{t("recurring.form.autopayHint")}
							</p>
						</div>
					</div>
				</>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="bill-notes">{t("recurring.form.notes")}</Label>
				<Textarea
					id="bill-notes"
					rows={2}
					placeholder={t(
						income ? "recurring.form.incomeNotesPlaceholder" : "recurring.form.notesPlaceholder",
					)}
					aria-invalid={notesError !== undefined}
					{...(notesError === undefined ? {} : { "aria-describedby": errorId("notes") })}
					{...form.register("notes")}
				/>
				<FieldMessage id={errorId("notes")} error={notesError} />
			</div>
		</fieldset>
	);
}

/**
 * The declare dialog's starting points: what detection saw twice that no
 * series follows. Choosing one fills the form from its latest transaction.
 */
function Candidates({
	kind,
	onChoose,
}: {
	kind: BillKind;
	onChoose: (candidate: BillCandidateData) => void;
}) {
	const { t } = useTranslation();
	const candidates = useBillCandidates(kind, true);
	const title = t(
		kind === "income" ? "recurring.form.startFromIncome" : "recurring.form.startFrom",
	);

	if (candidates.isPending) {
		return <Skeleton className="h-16 w-full" />;
	}

	if (candidates.data === undefined || candidates.data.length === 0) {
		return null;
	}

	return (
		<section aria-label={title} className="flex flex-col gap-2">
			<p className="text-sm font-medium">{title}</p>
			<ul className="flex max-h-44 flex-col divide-y divide-line overflow-y-auto rounded-lg border">
				{candidates.data.map((candidate) => (
					<li key={candidate.entryId}>
						<button
							type="button"
							className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => onChoose(candidate)}
						>
							<span className="flex min-w-0 flex-col">
								<span className="truncate text-sm">{candidate.name}</span>
								<span className="text-xs text-muted-foreground">
									{t("recurring.form.candidateMeta", {
										count: candidate.occurrenceCount,
										date: formatTableDate(candidate.lastOccurrenceDate),
									})}
								</span>
							</span>
							<Money amount={candidate.amount} currency={candidate.currency} />
						</button>
					</li>
				))}
			</ul>
			<p className="text-xs text-muted-foreground">{t("recurring.form.startFromHint")}</p>
		</section>
	);
}

function declareValues(kind: BillKind, accounts: readonly AccountSummaryData[]): BillValues {
	return {
		kind,
		name: "",
		amount: "",
		accountId: accounts[0]?.id ?? "",
		firstDueOn: toIsoDate(),
		// Paychecks default to the most common pay cadence, bills to monthly, as Sure's.
		frequency: {
			preset: kind === "income" ? "biweekly" : "monthly",
			interval: "2",
			unit: "monthly",
		},
		autopay: false,
		notes: "",
		paymentUrl: "",
		entryId: null,
	};
}

/** « Ajouter une facture » or « Ajouter un revenu », as Sure's `DeclaredBill`. */
function DeclareForm({
	kind,
	prefill,
	accounts,
	onClose,
}: {
	kind: BillKind;
	prefill: BillPrefill | null;
	accounts: readonly AccountSummaryData[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const declare = useDeclareBill();
	// `raw` hands the typed text to the API as is: the same schema parses it
	// there, in the account's currency. Read through a ref, since that currency
	// follows the account chosen.
	const resolve: Resolver<BillValues> = async (values, context, options) =>
		zodResolver(declareBillSchema(currencyOf(accounts, values.accountId)), undefined, {
			raw: true,
		})(values, context, options);
	const resolver = useRef(resolve);
	resolver.current = resolve;
	const form = useForm<BillValues>({
		resolver: async (values, context, options) => resolver.current(values, context, options),
		defaultValues: { ...declareValues(kind, accounts), ...prefill },
	});
	const { errors, isSubmitting } = form.formState;
	const firstDueOn = useController({ control: form.control, name: "firstDueOn" });
	const income = useWatch({ control: form.control, name: "kind" }) === "income";
	const entryId = useWatch({ control: form.control, name: "entryId" });
	const dateError = errorAt(errors, "firstDueOn");

	const choose = (candidate: BillCandidateData) =>
		form.reset({
			...form.getValues(),
			...prefillFrom({
				id: candidate.entryId,
				name: candidate.name,
				amount: candidate.entryAmount,
				currency: candidate.currency,
				accountId: candidate.accountId,
				date: candidate.lastOccurrenceDate,
			}),
		});

	const submit = form.handleSubmit(async (values) => {
		try {
			const created = await declare.mutateAsync(values);
			toast.success(
				t(
					created.billType === "income" ? "recurring.form.createdIncome" : "recurring.form.created",
				),
			);
			onClose();
		} catch (error) {
			showError(error, DECLARE_FIELDS, form.setError);
		}
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t(income ? "recurring.form.incomeTitle" : "recurring.form.title")}
				</DialogTitle>
				<DialogDescription>{t("recurring.form.description")}</DialogDescription>
			</DialogHeader>
			{prefill === null && (entryId ?? null) === null && (
				<Candidates kind={kind} onChoose={choose} />
			)}
			<form
				id="bill-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					// React carries a submit up through the portal: the transaction
					// sheet's own form must not save too.
					event.stopPropagation();
					void submit(event);
				}}
			>
				<TextField
					form={form}
					name="name"
					label={t(income ? "recurring.form.incomeName" : "recurring.form.name")}
					placeholder={t(
						income ? "recurring.form.incomeNamePlaceholder" : "recurring.form.namePlaceholder",
					)}
				/>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<TextField
						form={form}
						name="amount"
						label={t(income ? "recurring.form.incomeAmount" : "recurring.form.amount")}
						inputMode="decimal"
						className="text-right tabular-nums"
					/>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="bill-firstDueOn">
							{t(income ? "recurring.form.incomeDueOn" : "recurring.form.firstDueOn")}
						</Label>
						<DateField
							// Remounted when a candidate fills it: the field keeps its own text.
							key={firstDueOn.field.value}
							id="bill-firstDueOn"
							value={firstDueOn.field.value}
							onChange={firstDueOn.field.onChange}
							onBlur={firstDueOn.field.onBlur}
							invalid={dateError !== undefined}
							{...(dateError === undefined ? {} : { describedBy: errorId("firstDueOn") })}
						/>
						<FieldMessage id={errorId("firstDueOn")} error={dateError} />
					</div>
				</div>
				<AccountField form={form} accounts={accounts} income={income} />
				<FrequencyFields form={form} income={income} days={false} custom={false} />
				<MoreFields form={form} income={income} />
			</form>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="bill-form" disabled={isSubmitting}>
					{t(income ? "recurring.form.submitIncome" : "recurring.form.submit")}
				</Button>
			</DialogFooter>
		</>
	);
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function editValues(series: RecurringData): BillValues {
	const frequency = series.frequency;
	const anchor = series.anchorDate ?? series.lastOccurrenceDate;

	return {
		// Read by the declare dialog only, and dropped before an edit is sent.
		kind: series.billType === "income" ? "income" : "bill",
		firstDueOn: series.nextExpectedDate,
		name: recurringName(series),
		amount: amountToText(toMinorUnits(Math.abs(series.amount)), series.currency),
		accountId: series.accountId,
		...(series.billType === "income"
			? {}
			: {
					billType: series.billType,
					categoryId: series.categoryId,
					autopay: series.autopay,
					paymentUrl: series.paymentUrl ?? "",
				}),
		frequency: {
			preset: frequency.key,
			interval: String(frequency.interval ?? 2),
			unit: frequency.intervalUnit ?? "monthly",
			dayOfMonth: String(frequency.dayOfMonth ?? series.expectedDayOfMonth),
			secondDayOfMonth: String(frequency.secondDayOfMonth ?? 15),
			weekday: String(frequency.weekday ?? weekdayOf(anchor)),
			monthOfYear: String(frequency.monthOfYear ?? Number(anchor.slice(5, 7))),
		},
		endAfterCount: series.endAfterCount === null ? "" : String(series.endAfterCount),
		notes: series.notes ?? "",
	};
}

/** « Modifier »: Sure's edit dialog, with what an income has none of left out. */
function EditForm({
	series,
	accounts,
	onClose,
}: {
	series: RecurringData;
	accounts: readonly AccountSummaryData[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const edit = useEditBill();
	const income = series.billType === "income";
	const resolve: Resolver<BillValues> = async (values, context, options) =>
		zodResolver(editFormSchema(currencyOf(accounts, values.accountId)), undefined, {
			raw: true,
		})(values, context, options);
	const resolver = useRef(resolve);
	resolver.current = resolve;
	const initial = useMemo(() => editValues(series), [series]);
	const form = useForm<BillValues>({
		resolver: async (values, context, options) => resolver.current(values, context, options),
		defaultValues: initial,
	});
	const { errors, isSubmitting } = form.formState;
	const billType = useWatch({ control: form.control, name: "billType" });
	const categoryId = useController({ control: form.control, name: "categoryId" });
	const categoryError = errorAt(errors, "categoryId");

	const submit = form.handleSubmit(
		async ({ kind: _kind, firstDueOn: _due, entryId: _entry, ...values }) => {
			// A name left as the merchant's or the label stays unset, so it follows them.
			const unchangedName = series.name === null && values.name.trim() === initial.name;

			try {
				await edit.mutateAsync({
					id: series.id,
					input: {
						...values,
						...(unchangedName ? { name: undefined } : {}),
						...(billType === "installment" ? {} : { endAfterCount: "" }),
					},
				});
				toast.success(t(income ? "recurring.form.savedIncome" : "recurring.form.saved"));
				onClose();
			} catch (error) {
				showError(error, EDIT_FIELDS, form.setError);
			}
		},
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t(income ? "recurring.form.editIncomeTitle" : "recurring.form.editTitle", {
						name: recurringName(series),
					})}
				</DialogTitle>
				<DialogDescription>{t("recurring.form.description")}</DialogDescription>
			</DialogHeader>
			<form
				id="bill-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					// React carries a submit up through the portal: the transaction
					// sheet's own form must not save too.
					event.stopPropagation();
					void submit(event);
				}}
			>
				<TextField
					form={form}
					name="name"
					label={t(income ? "recurring.form.incomeName" : "recurring.form.name")}
				/>
				<TextField
					form={form}
					name="amount"
					label={t(income ? "recurring.form.incomeAmount" : "recurring.form.amount")}
					inputMode="decimal"
					className="text-right tabular-nums"
				/>
				<AccountField form={form} accounts={accounts} income={income} />
				<FrequencyFields
					form={form}
					income={income}
					days
					custom={series.frequency.key === CUSTOM_PRESET}
				/>
				{!income && (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<SelectField
							form={form}
							name="billType"
							label={t("recurring.form.billType")}
							options={EDITABLE_BILL_TYPES.map((value) => ({
								value,
								label: t(`recurring.billTypes.${value}`),
							}))}
						/>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bill-category">{t("recurring.form.category")}</Label>
							<CategoryField
								id="bill-category"
								value={categoryId.field.value ?? null}
								onChange={categoryId.field.onChange}
								invalid={categoryError !== undefined}
								describedBy={categoryError === undefined ? undefined : errorId("categoryId")}
							/>
							<FieldMessage id={errorId("categoryId")} error={categoryError} />
						</div>
					</div>
				)}
				{!income && billType === "installment" && (
					<TextField
						form={form}
						name="endAfterCount"
						label={t("recurring.form.installmentCount")}
						hint={t("recurring.form.installmentCountHint")}
						inputMode="numeric"
					/>
				)}
				<MoreFields form={form} income={income} />
			</form>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="bill-form" disabled={isSubmitting}>
					{t(income ? "recurring.form.submitIncome" : "recurring.form.submit")}
				</Button>
			</DialogFooter>
		</>
	);
}

/** What the dialog opens on: a new bill or income, or a series to edit. */
export type BillDialogSubject =
	| { mode: "declare"; kind: BillKind; prefill: BillPrefill | null }
	| { mode: "edit"; series: RecurringData };

/**
 * Sure's declare and edit dialog for a series: name, amount, account, first
 * date and frequency, then autopay, the payment link and notes; on an edit,
 * the type, the category, the day fields and an installment's number of
 * payments. Mount a fresh one per opening.
 */
export function BillDialog({
	open,
	onOpenChange,
	subject,
	accounts,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	subject: BillDialogSubject;
	/** The accounts a series may be on: the active ones, and an edited series' own. */
	accounts: readonly AccountSummaryData[];
}) {
	const close = () => onOpenChange(false);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				{subject.mode === "declare" ? (
					<DeclareForm
						kind={subject.kind}
						prefill={subject.prefill}
						accounts={accounts}
						onClose={close}
					/>
				) : (
					<EditForm series={subject.series} accounts={accounts} onClose={close} />
				)}
			</DialogContent>
		</Dialog>
	);
}
