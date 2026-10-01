import type { RuleData } from "@/hooks/useRules";
import type { FormValues, Options } from "@/lib/rule-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useController, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ruleSchema } from "@archant/api/schemas/rules";
import type { CurrencyCode } from "@archant/data/money";
import { RULE_ACTION_TYPES } from "@archant/data/rules";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { ActionRow } from "@/components/RuleActionRow";
import { GroupRow, LeafRow } from "@/components/RuleConditionRows";
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
import { useCreateRule, useUpdateRule } from "@/hooks/useRules";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";
import {
	defaults,
	described,
	errorAt,
	errorId,
	fieldNames,
	newAction,
	newGroup,
	newLeaf,
	valuesOf,
} from "@/lib/rule-form";

type RuleDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The rule to edit; absent to create one. */
	rule?: RuleData | undefined;
	options: Options;
	reportingCurrency: CurrencyCode;
	/** Called with the rule once saved, after the dialog closes. */
	onSaved?: ((rule: RuleData) => void) | undefined;
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
	onSaved,
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
			let saved: RuleData;

			if (rule === undefined) {
				saved = await createRule.mutateAsync(values);
				toast.success(t("rules.form.created"));
			} else {
				saved = await updateRule.mutateAsync({ id: rule.id, input: values });
				toast.success(t("rules.form.saved"));
			}

			onOpenChange(false);
			onSaved?.(saved);
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
			<DialogContent
				showCloseButton={false}
				className="max-h-[90vh] overflow-y-auto sm:max-w-[700px]"
			>
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
