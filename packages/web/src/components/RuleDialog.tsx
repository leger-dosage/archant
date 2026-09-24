import type { CategoryData } from "@/hooks/useCategories";
import type { RuleData } from "@/hooks/useRules";
import type { Control, FieldErrors, Path } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { get, useController, useFieldArray, useForm, useFormState } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { RuleFormInput } from "@archant/api/schemas/rules";
import { ruleSchema } from "@archant/api/schemas/rules";
import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RuleConditionType } from "@archant/data/rules";
import { RULE_OPERATORS_BY_TYPE } from "@archant/data/rules";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryDot } from "@/components/CategoryDot";
import { DateField } from "@/components/DateField";
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

const newAction = (): FormValues["actions"][number] => ({
	actionType: "set_transaction_category",
	value: "",
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

/** One condition on a label, an amount or an account. */
function LeafRow({
	control,
	name,
	label,
	accounts,
	onRemove,
}: {
	control: Control<FormValues>;
	name: LeafName;
	label: string;
	accounts: readonly AccountOption[];
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
				<Select value={operator.field.value ?? ""} onValueChange={operator.field.onChange}>
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
				<div className="min-w-0 flex-1">
					{leafType === "transaction_account" ? (
						<Select value={value.field.value ?? ""} onValueChange={value.field.onChange}>
							<SelectTrigger
								id={valueId}
								className="w-full"
								aria-label={t("rules.form.value", { index: label })}
								aria-invalid={valueError !== undefined}
								{...described(`${name}.value`, valueError)}
							>
								{/* A deleted account is in no option: say so rather than show the empty placeholder. */}
								{value.field.value !== "" &&
								value.field.value !== null &&
								value.field.value !== undefined &&
								!accounts.some((account) => account.id === value.field.value) ? (
									<span>{t("rules.summary.deletedAccount")}</span>
								) : (
									<SelectValue placeholder={t("rules.form.accountPlaceholder")} />
								)}
							</SelectTrigger>
							<SelectContent>
								{accounts.map((account) => (
									<SelectItem key={account.id} value={account.id}>
										{account.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<Input
							id={valueId}
							autoComplete="off"
							aria-label={t("rules.form.value", { index: label })}
							aria-invalid={valueError !== undefined}
							{...described(`${name}.value`, valueError)}
							{...(leafType === "transaction_amount"
								? { inputMode: "decimal" as const, className: "text-right tabular-nums" }
								: {})}
							value={value.field.value ?? ""}
							onChange={value.field.onChange}
							onBlur={value.field.onBlur}
						/>
					)}
				</div>
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
	accounts,
	onRemove,
}: {
	control: Control<FormValues>;
	index: number;
	accounts: readonly AccountOption[];
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
					accounts={accounts}
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

/** The « Catégorie » action's value: the category combobox behind a button showing the choice. */
function CategoryAction({
	control,
	index,
	categories,
}: {
	control: Control<FormValues>;
	index: number;
	categories: readonly CategoryData[];
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const { errors } = useFormState({ control });
	const value = useController({ control, name: `actions.${index}.value` });
	const path = `actions.${index}.value`;
	const error = errorAt(errors, path) ?? errorAt(errors, `actions.${index}`);
	const category = categories.find((candidate) => candidate.id === value.field.value);
	const id = `rule-action-${index}`;

	return (
		<div className="flex flex-1 flex-col gap-1">
			<div className="flex items-center gap-2">
				<Label htmlFor={id} className="w-36 shrink-0">
					{t("rules.form.setCategory")}
				</Label>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<Button
							id={id}
							type="button"
							variant="outline"
							className="min-w-0 flex-1 justify-start font-normal"
							aria-invalid={error !== undefined}
							{...described(path, error)}
						>
							{category === undefined ? (
								<span className="text-muted-foreground">
									{value.field.value === "" || value.field.value === null
										? t("rules.form.categoryPlaceholder")
										: t("rules.summary.deletedCategory")}
								</span>
							) : (
								<>
									<CategoryDot color={category.color} />
									<span className="truncate">{category.name}</span>
								</>
							)}
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
						<CategoryCombobox
							categories={categories}
							value={value.field.value ?? undefined}
							allowNone={false}
							onSelect={(categoryId) => {
								value.field.onChange(categoryId ?? "");
								setOpen(false);
							}}
						/>
					</PopoverContent>
				</Popover>
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
	accounts: readonly AccountOption[];
	categories: readonly CategoryData[];
	reportingCurrency: CurrencyCode;
};

/**
 * Creates or edits a rule, as Sure's modal: a name and a start date, both
 * optional, then « Si » its conditions and groups, then « Alors » its action.
 */
export function RuleDialog({
	open,
	onOpenChange,
	rule,
	accounts,
	categories,
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
									accounts={accounts}
									onRemove={() => conditions.remove(index)}
								/>
							) : (
								<LeafRow
									key={field.id}
									control={form.control}
									name={`conditions.${index}`}
									label={String(index + 1)}
									accounts={accounts}
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
							<div key={field.id} className="flex items-start gap-2">
								<CategoryAction control={form.control} index={index} categories={categories} />
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t("rules.form.removeAction")}
									onClick={() => actions.remove(index)}
								>
									<XIcon />
								</Button>
							</div>
						))}
						{/* One action type for now, and a rule holds each type once. */}
						{actions.fields.length === 0 && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="self-start"
								aria-invalid={actionsError !== undefined}
								{...described("actions", actionsError)}
								onClick={() => actions.append(newAction())}
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
