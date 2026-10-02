import type { FormValues, Options } from "@/lib/rule-form";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";

import { XIcon } from "lucide-react";
import { useController, useFormState } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { RuleActionType } from "@archant/data/rules";
import { RULE_ACTION_TYPES } from "@archant/data/rules";

import { FieldMessage } from "@/components/FieldMessage";
import { ACTION_REFERENCES, ReferenceField } from "@/components/RuleReferenceField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { described, errorAt, errorId, newAction } from "@/lib/rule-form";

/** One action: its type, among those no other action holds, then its value. */
export function ActionRow({
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
