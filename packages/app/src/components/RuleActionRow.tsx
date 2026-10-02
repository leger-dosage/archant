import type { FormValues, Options } from "@/lib/rule-form";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";

import { XIcon } from "lucide-react";
import { useController, useFormState } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";

import type { RuleActionType } from "@archant/data/rules";
import { RULE_ACTION_TYPES } from "@archant/data/rules";

import { FieldMessage } from "@/components/FieldMessage";
import { ACTION_REFERENCES, ReferenceField } from "@/components/RuleReferenceField";
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
import { described, errorAt, errorId, newAction } from "@/lib/rule-form";
import { cn } from "@/lib/utils";

const PATTERN_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/troubleshooting.md#labels-show-backslashes-or-a-card-prefix";

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
	const replacement = useController({ control, name: `actions.${index}.replacement` });
	const actionType: RuleActionType = type.field.value;
	const label = String(index + 1);
	const path = `actions.${index}.value`;
	const error = errorAt(errors, path) ?? errorAt(errors, `actions.${index}`);
	const id = `rule-action-${index}`;
	const replacementPath = `actions.${index}.replacement`;
	// The replacement's fields sit under visible labels (a 16px line and a 6px gap),
	// so the type and the remove button drop by as much to stay level with the pattern.
	const levelWithPattern = actionType === "replace_in_transaction_name" ? "mt-5.5" : undefined;
	const replacementError = errorAt(errors, replacementPath);
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
			case "replace_in_transaction_name":
				return (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={id} className="text-xs text-muted-foreground">
								{t("rules.form.pattern")}
							</Label>
							<Input
								id={id}
								autoComplete="off"
								spellCheck={false}
								aria-invalid={error !== undefined}
								{...described(path, error)}
								value={current}
								onChange={value.field.onChange}
								onBlur={value.field.onBlur}
							/>
							<FieldMessage id={errorId(path)} error={error} />
							<p className="text-xs text-muted-foreground">
								<Trans
									i18nKey="rules.form.patternHint"
									components={{
										guide: (
											<a
												href={PATTERN_GUIDE}
												target="_blank"
												rel="noreferrer"
												className="underline underline-offset-4"
											/>
										),
									}}
								/>
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={`${id}-replacement`} className="text-xs text-muted-foreground">
								{t("rules.form.replacement")}
							</Label>
							<Input
								id={`${id}-replacement`}
								autoComplete="off"
								spellCheck={false}
								placeholder={t("rules.form.replacementPlaceholder")}
								aria-invalid={replacementError !== undefined}
								{...described(replacementPath, replacementError)}
								value={replacement.field.value ?? ""}
								onChange={replacement.field.onChange}
								onBlur={replacement.field.onBlur}
							/>
							<FieldMessage id={errorId(replacementPath)} error={replacementError} />
						</div>
					</div>
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
							const fresh = newAction(picked);

							type.field.onChange(picked);
							value.field.onChange(fresh.value);
							replacement.field.onChange(fresh.replacement);
						}
					}}
				>
					<SelectTrigger
						className={cn("w-52 shrink-0", levelWithPattern)}
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
				<div className={levelWithPattern}>
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
			</div>
			{actionType !== "replace_in_transaction_name" && (
				<FieldMessage id={errorId(path)} error={error} />
			)}
		</div>
	);
}
