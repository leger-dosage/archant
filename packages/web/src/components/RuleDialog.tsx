import type { CategoryData } from "@/hooks/useCategories";
import type { MerchantData } from "@/hooks/useMerchants";
import type { RuleData } from "@/hooks/useRules";
import type { TagData } from "@/hooks/useTags";
import type { ReactNode } from "react";
import type { Control, FieldErrors, Path } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	get,
	useController,
	useFieldArray,
	useForm,
	useFormState,
	useWatch,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { RuleFormInput } from "@archant/api/schemas/rules";
import { RULE_TYPE_VALUES, ruleSchema } from "@archant/api/schemas/rules";
import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RuleActionType, RuleConditionType } from "@archant/data/rules";
import { RULE_ACTION_TYPES, RULE_OPERATORS_BY_TYPE, isValuelessAction } from "@archant/data/rules";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryDot } from "@/components/CategoryDot";
import { DateField } from "@/components/DateField";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { TagCombobox } from "@/components/TagCombobox";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateRule, useUpdateRule } from "@/hooks/useRules";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { operatorKey } from "@/lib/rule-summary";

type FormValues = RuleFormInput;
type ConditionValues = FormValues["conditions"][number];
type LeafValues = NonNullable<ConditionValues["conditions"]>[number];
type LeafType = Exclude<RuleConditionType, "compound">;
type LeafName = `conditions.${number}` | `conditions.${number}.conditions.${number}`;

const LEAF_TYPES: readonly LeafType[] = [
	"transaction_name",
	"transaction_amount",
	"transaction_account",
	"transaction_merchant",
	"transaction_category",
	"transaction_tag",
	"transaction_notes",
	"transaction_type",
];

const newLeaf = (): LeafValues => ({
	conditionType: "transaction_name",
	operator: "like",
	value: "",
});

const newGroup = (): ConditionValues => ({
	conditionType: "compound",
	operator: "and",
	value: null,
	conditions: [newLeaf()],
});

type ActionValues = FormValues["actions"][number];

const newAction = (actionType: RuleActionType = "set_transaction_category"): ActionValues => ({
	actionType,
	// An exclusion takes no value: the schema refuses one.
	value: isValuelessAction(actionType) ? null : "",
});

// Sure's new rule starts with one condition and one action to fill in.
const defaults = (): FormValues => ({
	name: "",
	effectiveDate: null,
	conditions: [newLeaf()],
	actions: [newAction()],
});

function leafValues(condition: RuleData["conditions"][number], currency: CurrencyCode): LeafValues {
	const value = condition.value ?? "";

	return {
		conditionType: condition.conditionType,
		operator: condition.operator,
		// Stored in minor units; the field shows it as typed: `5000` is `50,00`.
		value:
			condition.conditionType === "transaction_amount"
				? amountToText(toMinorUnits(Number(value)), currency)
				: value,
	};
}

function valuesOf(rule: RuleData, currency: CurrencyCode): FormValues {
	return {
		name: rule.name ?? "",
		effectiveDate: rule.effectiveDate,
		conditions: rule.conditions.map((condition) =>
			condition.conditionType === "compound"
				? {
						conditionType: "compound",
						operator: condition.operator,
						value: null,
						conditions: condition.conditions.map((child) => leafValues(child, currency)),
					}
				: leafValues(condition, currency),
		),
		actions: rule.actions.map((action) => ({ actionType: action.actionType, value: action.value })),
	};
}

/** Every path a field error of the API can name, for the values being saved. */
function fieldNames(values: FormValues): Path<FormValues>[] {
	const names: Path<FormValues>[] = ["name", "effectiveDate", "actions"];

	for (const [index, condition] of values.conditions.entries()) {
		names.push(`conditions.${index}.operator`, `conditions.${index}.value`);

		for (const position of (condition.conditions ?? []).keys()) {
			names.push(
				`conditions.${index}.conditions.${position}`,
				`conditions.${index}.conditions.${position}.operator`,
				`conditions.${index}.conditions.${position}.value`,
			);
		}
	}

	for (const index of values.actions.keys()) {
		names.push(`actions.${index}`, `actions.${index}.value`);
	}

	return names;
}

type ShownError = { type: string; message?: string };

function isShownError(value: unknown): value is ShownError {
	return (
		typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
	);
}

/**
 * The error on `path` itself. An array's own error sits on `root` when the
 * resolver reports it on a non-empty list, on the array otherwise.
 */
function errorAt(errors: FieldErrors<FormValues>, path: string): ShownError | undefined {
	const found: unknown = get(errors, path);
	const root: unknown = get(errors, `${path}.root`);

	if (isShownError(root)) {
		return root;
	}

	return isShownError(found) ? found : undefined;
}

function FieldMessage({ id, error }: { id: string; error: ShownError | undefined }) {
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

const errorId = (path: string) => `rule-${path.replaceAll(".", "-")}-error`;

const described = (path: string, error: ShownError | undefined) =>
	error === undefined ? {} : { "aria-describedby": errorId(path) };

type AccountOption = { id: string; name: string };

/** Every list a value picker offers, loaded by the page. */
type Options = {
	accounts: readonly AccountOption[];
	categories: readonly CategoryData[];
	merchants: readonly MerchantData[];
	tags: readonly TagData[];
};

/**
 * A button showing the chosen merchant, category or tag, opening its
 * combobox in a popover; `children` gets the function that closes it.
 */
function PickerField({
	id,
	label,
	chosen,
	placeholder,
	deleted,
	invalid,
	describedBy,
	children,
}: {
	id: string;
	label: string;
	/** The picked row's name and colour; `undefined` when none is picked or it was deleted. */
	chosen: { name: string; color?: string } | undefined;
	placeholder: string;
	/** Shown instead of the placeholder when an id is set but names no row. */
	deleted: string | null;
	invalid: boolean;
	describedBy: { "aria-describedby"?: string };
	children: (close: () => void) => ReactNode;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					className="w-full min-w-0 justify-start font-normal"
					aria-label={label}
					aria-invalid={invalid}
					{...describedBy}
				>
					{chosen === undefined ? (
						<span className="text-muted-foreground">{deleted ?? placeholder}</span>
					) : (
						<>
							{chosen.color !== undefined && <CategoryDot color={chosen.color} />}
							<span className="truncate">{chosen.name}</span>
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
				{children(() => setOpen(false))}
			</PopoverContent>
		</Popover>
	);
}

/** The text a picker shows for a set id that names no row any more, `null` when unset. */
const deletedText = (value: string | null | undefined, text: string) =>
	value === "" || value === null || value === undefined ? null : text;

/** The row a condition or an action names, by its table. */
type ReferenceKind = "account" | "merchant" | "category" | "tag";

const LEAF_REFERENCES = {
	transaction_account: "account",
	transaction_merchant: "merchant",
	transaction_category: "category",
	transaction_tag: "tag",
} as const satisfies Partial<Record<LeafType, ReferenceKind>>;

const ACTION_REFERENCES = {
	set_transaction_category: "category",
	set_transaction_merchant: "merchant",
	set_transaction_tags: "tag",
	set_as_transfer_or_payment: "account",
} as const satisfies Partial<Record<RuleActionType, ReferenceKind>>;

/**
 * The value naming an account, a merchant, a category or a tag: a select for
 * an account, a combobox behind a button for the others. Shared by conditions
 * and actions.
 */
function ReferenceField({
	kind,
	id,
	label,
	value,
	onPick,
	invalid,
	describedBy,
	options,
}: {
	kind: ReferenceKind;
	id: string;
	label: string;
	/** The picked id, `""` for none. */
	value: string;
	onPick: (id: string) => void;
	invalid: boolean;
	describedBy: { "aria-describedby"?: string };
	options: Options;
}) {
	const { t } = useTranslation();
	const pickerProps = { id, label, invalid, describedBy };
	const picked = value === "" ? undefined : value;

	switch (kind) {
		case "account":
			return (
				<Select value={value} onValueChange={onPick}>
					<SelectTrigger
						id={id}
						className="w-full"
						aria-label={label}
						aria-invalid={invalid}
						{...describedBy}
					>
						{/* A deleted account is in no option: say so rather than show the empty placeholder. */}
						{value !== "" && !options.accounts.some((account) => account.id === value) ? (
							<span>{t("rules.summary.deletedAccount")}</span>
						) : (
							<SelectValue placeholder={t("rules.form.accountPlaceholder")} />
						)}
					</SelectTrigger>
					<SelectContent>
						{options.accounts.map((account) => (
							<SelectItem key={account.id} value={account.id}>
								{account.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "merchant":
			return (
				<PickerField
					{...pickerProps}
					chosen={options.merchants.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.merchantPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedMerchant"))}
				>
					{(close) => (
						<MerchantCombobox
							merchants={options.merchants}
							value={picked}
							mode="target"
							onSelect={(merchantId) => {
								onPick(merchantId ?? "");
								close();
							}}
						/>
					)}
				</PickerField>
			);
		case "category":
			return (
				<PickerField
					{...pickerProps}
					chosen={options.categories.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.categoryPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedCategory"))}
				>
					{(close) => (
						<CategoryCombobox
							categories={options.categories}
							value={picked}
							allowNone={false}
							onSelect={(categoryId) => {
								onPick(categoryId ?? "");
								close();
							}}
						/>
					)}
				</PickerField>
			);
		default:
			return (
				<PickerField
					{...pickerProps}
					chosen={options.tags.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.tagPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedTag"))}
				>
					{(close) => (
						<TagCombobox
							tags={options.tags}
							value={picked === undefined ? [] : [picked]}
							onToggle={(tagId) => {
								onPick(tagId);
								close();
							}}
						/>
					)}
				</PickerField>
			);
	}
}

/** One condition on a label, an amount, an account, a merchant, a category, a tag, notes or a type. */
function LeafRow({
	control,
	name,
	label,
	options,
	onRemove,
}: {
	control: Control<FormValues>;
	name: LeafName;
	label: string;
	options: Options;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const { errors } = useFormState({ control });
	const type = useController({ control, name: `${name}.conditionType` });
	const operator = useController({ control, name: `${name}.operator` });
	const value = useController({ control, name: `${name}.value` });
	const conditionType: RuleConditionType = type.field.value ?? "transaction_name";
	const leafType = conditionType === "compound" ? "transaction_name" : conditionType;
	const operatorError = errorAt(errors, `${name}.operator`);
	const valueError = errorAt(errors, `${name}.value`) ?? errorAt(errors, name);
	const valueId = `rule-${name.replaceAll(".", "-")}-value`;
	const valueLabel = t("rules.form.value", { index: label });
	const current = value.field.value ?? "";
	const pick = (next: string) => value.field.onChange(next);
	const pickerProps = {
		id: valueId,
		label: valueLabel,
		invalid: valueError !== undefined,
		describedBy: described(`${name}.value`, valueError),
	};

	const valueField = (): ReactNode => {
		switch (leafType) {
			case "transaction_type":
				return (
					<Select value={current} onValueChange={pick}>
						<SelectTrigger
							id={valueId}
							className="w-full"
							aria-label={valueLabel}
							aria-invalid={valueError !== undefined}
							{...described(`${name}.value`, valueError)}
						>
							<SelectValue placeholder={t("rules.form.typePlaceholder")} />
						</SelectTrigger>
						<SelectContent>
							{RULE_TYPE_VALUES.map((option) => (
								<SelectItem key={option} value={option}>
									{t(`rules.types.${option}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				);
			case "transaction_account":
			case "transaction_merchant":
			case "transaction_category":
			case "transaction_tag":
				return (
					<ReferenceField
						{...pickerProps}
						kind={LEAF_REFERENCES[leafType]}
						value={current}
						onPick={pick}
						options={options}
					/>
				);
			default:
				return (
					<Input
						id={valueId}
						autoComplete="off"
						aria-label={valueLabel}
						aria-invalid={valueError !== undefined}
						{...described(`${name}.value`, valueError)}
						{...(leafType === "transaction_amount"
							? { inputMode: "decimal" as const, className: "text-right tabular-nums" }
							: {})}
						value={current}
						onChange={value.field.onChange}
						onBlur={value.field.onBlur}
					/>
				);
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-start gap-2">
				<Select
					value={leafType}
					onValueChange={(next) => {
						const picked = LEAF_TYPES.find((candidate) => candidate === next);

						if (picked !== undefined) {
							type.field.onChange(picked);
							operator.field.onChange(RULE_OPERATORS_BY_TYPE[picked][0]);
							value.field.onChange("");
						}
					}}
				>
					<SelectTrigger
						className="w-36 shrink-0"
						aria-label={t("rules.form.field", { index: label })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{LEAF_TYPES.map((option) => (
							<SelectItem key={option} value={option}>
								{t(`rules.fields.${option}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select
					value={operator.field.value ?? ""}
					onValueChange={(next) => {
						// « est vide » reads no value: the field goes, and so does what it held.
						if (next === "is_null") {
							value.field.onChange(null);
						}

						operator.field.onChange(next);
					}}
				>
					<SelectTrigger
						className="w-52 shrink-0"
						aria-label={t("rules.form.operator", { index: label })}
						aria-invalid={operatorError !== undefined}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{RULE_OPERATORS_BY_TYPE[leafType].map((option) => {
							const key = operatorKey(leafType, option);

							return (
								<SelectItem key={option} value={option}>
									{key === null ? option : t(key)}
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>
				<div className="min-w-0 flex-1">{operator.field.value !== "is_null" && valueField()}</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={t("rules.form.remove", { index: label })}
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			<FieldMessage id={errorId(`${name}.operator`)} error={operatorError} />
			<FieldMessage id={errorId(`${name}.value`)} error={valueError} />
		</div>
	);
}

/** A group of conditions, one level deep, matching on all or any of them. */
function GroupRow({
	control,
	index,
	options,
	onRemove,
}: {
	control: Control<FormValues>;
	index: number;
	options: Options;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const label = String(index + 1);
	const operator = useController({ control, name: `conditions.${index}.operator` });
	const children = useFieldArray({ control, name: `conditions.${index}.conditions` });

	return (
		<fieldset className="flex flex-col gap-2 rounded-md border p-3">
			<legend className="px-1 text-sm font-medium">
				{t("rules.form.group", { index: label })}
			</legend>
			<div className="flex items-center gap-2">
				<Select value={operator.field.value} onValueChange={operator.field.onChange}>
					<SelectTrigger
						className="w-56"
						aria-label={t("rules.form.groupOperator", { index: label })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{RULE_OPERATORS_BY_TYPE.compound.map((option) => (
							<SelectItem key={option} value={option}>
								{t(option === "and" ? "rules.operators.all" : "rules.operators.any")}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="ml-auto"
					aria-label={t("rules.form.remove", { index: label })}
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			{children.fields.length === 0 && (
				<p className="text-sm text-muted-foreground">{t("rules.form.groupEmpty")}</p>
			)}
			{children.fields.map((field, position) => (
				<LeafRow
					key={field.id}
					control={control}
					name={`conditions.${index}.conditions.${position}`}
					label={`${label}.${position + 1}`}
					options={options}
					onRemove={() => children.remove(position)}
				/>
			))}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => children.append(newLeaf())}
			>
				<PlusIcon />
				{t("rules.form.addToGroup")}
			</Button>
		</fieldset>
	);
}

/** One action: its type, among those no other action holds, then its value. */
function ActionRow({
	control,
	index,
	options,
	taken,
	onRemove,
}: {
	control: Control<FormValues>;
	index: number;
	options: Options;
	/** The types the other actions hold: a rule holds each type once, as in Sure. */
	taken: ReadonlySet<RuleActionType>;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const { errors } = useFormState({ control });
	const type = useController({ control, name: `actions.${index}.actionType` });
	const value = useController({ control, name: `actions.${index}.value` });
	const actionType: RuleActionType = type.field.value;
	const label = String(index + 1);
	const path = `actions.${index}.value`;
	const error = errorAt(errors, path) ?? errorAt(errors, `actions.${index}`);
	const id = `rule-action-${index}`;
	const current = value.field.value ?? "";
	// The value's name is the action's: « Catégorie », « Renommer », « Virement avec ».
	const valueLabel = t(`rules.actionTypes.${actionType}`);
	const pick = (next: string) => value.field.onChange(next);
	const pickerProps = {
		id,
		label: valueLabel,
		invalid: error !== undefined,
		describedBy: described(path, error),
	};

	const valueField = (): ReactNode => {
		switch (actionType) {
			case "set_transaction_category":
			case "set_transaction_merchant":
			case "set_transaction_tags":
			case "set_as_transfer_or_payment":
				return (
					<ReferenceField
						{...pickerProps}
						kind={ACTION_REFERENCES[actionType]}
						value={current}
						onPick={pick}
						options={options}
					/>
				);
			case "set_transaction_name":
				return (
					<Input
						id={id}
						autoComplete="off"
						aria-label={valueLabel}
						aria-invalid={error !== undefined}
						{...described(path, error)}
						value={current}
						onChange={value.field.onChange}
						onBlur={value.field.onBlur}
					/>
				);
			default:
				return <p className="py-2 text-sm text-muted-foreground">{t("rules.form.excludeHint")}</p>;
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-start gap-2">
				<Select
					value={actionType}
					onValueChange={(next) => {
						const picked = RULE_ACTION_TYPES.find((candidate) => candidate === next);

						if (picked !== undefined) {
							type.field.onChange(picked);
							value.field.onChange(newAction(picked).value);
						}
					}}
				>
					<SelectTrigger
						className="w-52 shrink-0"
						aria-label={t("rules.form.action", { index: label })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{RULE_ACTION_TYPES.filter((option) => option === actionType || !taken.has(option)).map(
							(option) => (
								<SelectItem key={option} value={option}>
									{t(`rules.actionTypes.${option}`)}
								</SelectItem>
							),
						)}
					</SelectContent>
				</Select>
				<div className="min-w-0 flex-1">{valueField()}</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={t("rules.form.removeAction", { index: label })}
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			<FieldMessage id={errorId(path)} error={error} />
		</div>
	);
}

type RuleDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The rule to edit; absent to create one. */
	rule?: RuleData | undefined;
	options: Options;
	reportingCurrency: CurrencyCode;
};

/**
 * Creates or edits a rule, as Sure's modal: a name and a start date, both
 * optional, then « Si » its conditions and groups, then « Alors » its
 * actions, one per type.
 */
export function RuleDialog({
	open,
	onOpenChange,
	rule,
	options,
	reportingCurrency,
}: RuleDialogProps) {
	const { t } = useTranslation();
	const createRule = useCreateRule();
	const updateRule = useUpdateRule();
	const schema = useMemo(() => ruleSchema(reportingCurrency), [reportingCurrency]);
	const form = useForm<FormValues>({
		// `raw` hands the typed text to the API as is: the same schema parses the
		// amount there, into minor units of the reporting currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: rule === undefined ? defaults() : valuesOf(rule, reportingCurrency),
	});
	const { errors, isSubmitting } = form.formState;
	const conditions = useFieldArray({ control: form.control, name: "conditions" });
	const actions = useFieldArray({ control: form.control, name: "actions" });
	const effectiveDate = useController({ control: form.control, name: "effectiveDate" });
	const actionsError = errorAt(errors, "actions");
	const actionTypes = useWatch({ control: form.control, name: "actions" }).map(
		(action) => action.actionType,
	);
	const remaining = RULE_ACTION_TYPES.filter((type) => !actionTypes.includes(type));

	// Keyed on the id: the page hands over the rule from the current list, a
	// new object on every refetch, which must not wipe what is being typed.
	const ruleId = rule?.id;
	const latest = useRef(rule);
	latest.current = rule;

	useEffect(() => {
		if (open) {
			form.reset(
				latest.current === undefined ? defaults() : valuesOf(latest.current, reportingCurrency),
			);
		}
	}, [open, ruleId, form, reportingCurrency]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (rule === undefined) {
				await createRule.mutateAsync(values);
				toast.success(t("rules.form.created"));
			} else {
				await updateRule.mutateAsync({ id: rule.id, input: values });
				toast.success(t("rules.form.saved"));
			}

			onOpenChange(false);
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(apiError.fields, fieldNames(values), form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}
		}
	});

	const nameError = errorAt(errors, "name");
	const dateError = errorAt(errors, "effectiveDate");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>
						{t(rule === undefined ? "rules.form.addTitle" : "rules.form.editTitle")}
					</DialogTitle>
					<DialogDescription>{t("rules.form.description")}</DialogDescription>
				</DialogHeader>
				<form
					id="rule-form"
					noValidate
					className="flex flex-col gap-5"
					onSubmit={(event) => void submit(event)}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="rule-name">{t("rules.form.name")}</Label>
							<Input
								id="rule-name"
								autoComplete="off"
								placeholder={t("rules.form.namePlaceholder")}
								aria-invalid={nameError !== undefined}
								{...described("name", nameError)}
								{...form.register("name")}
							/>
							<FieldMessage id={errorId("name")} error={nameError} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="rule-effective-date">{t("rules.form.effectiveDate")}</Label>
							<DateField
								// A fresh field per opening: it keeps the typed text in local state.
								key={`${String(open)}-${ruleId ?? "new"}`}
								id="rule-effective-date"
								value={effectiveDate.field.value ?? ""}
								onChange={(next) => effectiveDate.field.onChange(next === "" ? null : next)}
								onBlur={effectiveDate.field.onBlur}
								invalid={dateError !== undefined}
								{...(dateError === undefined ? {} : { describedBy: errorId("effectiveDate") })}
							/>
							{dateError === undefined ? (
								<p className="text-xs text-muted-foreground">{t("rules.form.effectiveDateHint")}</p>
							) : (
								<FieldMessage id={errorId("effectiveDate")} error={dateError} />
							)}
						</div>
					</div>

					<section className="flex flex-col gap-3" aria-labelledby="rule-conditions">
						<h3 id="rule-conditions" className="text-sm font-semibold">
							{t("rules.form.conditions")}
						</h3>
						{conditions.fields.length === 0 && (
							<p className="text-sm text-muted-foreground">{t("rules.form.noCondition")}</p>
						)}
						{conditions.fields.map((field, index) =>
							field.conditionType === "compound" ? (
								<GroupRow
									key={field.id}
									control={form.control}
									index={index}
									options={options}
									onRemove={() => conditions.remove(index)}
								/>
							) : (
								<LeafRow
									key={field.id}
									control={form.control}
									name={`conditions.${index}`}
									label={String(index + 1)}
									options={options}
									onRemove={() => conditions.remove(index)}
								/>
							),
						)}
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => conditions.append(newLeaf())}
							>
								<PlusIcon />
								{t("rules.form.addCondition")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => conditions.append(newGroup())}
							>
								<PlusIcon />
								{t("rules.form.addGroup")}
							</Button>
						</div>
					</section>

					<section className="flex flex-col gap-3" aria-labelledby="rule-actions">
						<h3 id="rule-actions" className="text-sm font-semibold">
							{t("rules.form.actions")}
						</h3>
						{actions.fields.map((field, index) => (
							<ActionRow
								key={field.id}
								control={form.control}
								index={index}
								options={options}
								taken={new Set(actionTypes.filter((_, position) => position !== index))}
								onRemove={() => actions.remove(index)}
							/>
						))}
						{remaining.length > 0 && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="self-start"
								aria-invalid={actionsError !== undefined}
								{...described("actions", actionsError)}
								onClick={() => {
									const [next] = remaining;

									if (next !== undefined) {
										actions.append(newAction(next));
									}
								}}
							>
								<PlusIcon />
								{t("rules.form.addAction")}
							</Button>
						)}
						<FieldMessage id={errorId("actions")} error={actionsError} />
					</section>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="rule-form" disabled={isSubmitting}>
						{t("rules.form.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
