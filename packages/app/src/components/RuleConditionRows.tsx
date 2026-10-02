import type { FormValues, LeafName, Options } from "@/lib/rule-form";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";

import { PlusIcon, XIcon } from "lucide-react";
import { useController, useFieldArray, useFormState } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { RULE_TYPE_VALUES } from "@archant/api/schemas/rules";
import type { RuleConditionType } from "@archant/data/rules";
import { RULE_OPERATORS_BY_TYPE } from "@archant/data/rules";

import { FieldMessage } from "@/components/FieldMessage";
import { LEAF_REFERENCES, ReferenceField } from "@/components/RuleReferenceField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { LEAF_TYPES, described, errorAt, errorId, newLeaf } from "@/lib/rule-form";
import { operatorKey } from "@/lib/rule-summary";

/** One condition on a label, an amount, an account, a merchant, a category, a tag, notes or a type. */
export function LeafRow({
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
export function GroupRow({
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
