import type { CategoryData } from "@/hooks/useCategories";
import type { MerchantData } from "@/hooks/useMerchants";
import type { RuleData } from "@/hooks/useRules";
import type { TagData } from "@/hooks/useTags";
import type { ShownError } from "@/lib/form-errors";
import type { FieldErrors, Path } from "react-hook-form";

import { get } from "react-hook-form";

import type { RuleFormInput } from "@archant/api/schemas/rules";
import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RuleActionType, RuleConditionType } from "@archant/data/rules";
import { isValuelessAction } from "@archant/data/rules";

import { amountToText } from "@/lib/amount-sign";

export type FormValues = RuleFormInput;
type ConditionValues = FormValues["conditions"][number];
type LeafValues = NonNullable<ConditionValues["conditions"]>[number];
export type LeafType = Exclude<RuleConditionType, "compound">;
export type LeafName = `conditions.${number}` | `conditions.${number}.conditions.${number}`;

export const LEAF_TYPES: readonly LeafType[] = [
	"transaction_name",
	"transaction_amount",
	"transaction_account",
	"transaction_merchant",
	"transaction_category",
	"transaction_tag",
	"transaction_notes",
	"transaction_type",
];

export const newLeaf = (): LeafValues => ({
	conditionType: "transaction_name",
	operator: "like",
	value: "",
});

export const newGroup = (): ConditionValues => ({
	conditionType: "compound",
	operator: "and",
	value: null,
	conditions: [newLeaf()],
});

type ActionValues = FormValues["actions"][number];

export const newAction = (
	actionType: RuleActionType = "set_transaction_category",
): ActionValues => ({
	actionType,
	// An exclusion takes no value: the schema refuses one.
	value: isValuelessAction(actionType) ? null : "",
	// Only a replacement in the label has a replacement: the schema refuses one elsewhere.
	replacement: actionType === "replace_in_transaction_name" ? "" : null,
});

// Sure's new rule starts with one condition and one action to fill in.
export const defaults = (): FormValues => ({
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

export function valuesOf(rule: RuleData, currency: CurrencyCode): FormValues {
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
		actions: rule.actions.map((action) => ({
			actionType: action.actionType,
			value: action.value,
			replacement: action.replacement ?? null,
		})),
	};
}

/** Every path a field error of the API can name, for the values being saved. */
export function fieldNames(values: FormValues): Path<FormValues>[] {
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
		names.push(`actions.${index}`, `actions.${index}.value`, `actions.${index}.replacement`);
	}

	return names;
}

function isShownError(value: unknown): value is ShownError {
	return (
		typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
	);
}

/**
 * The error on `path` itself. An array's own error sits on `root` when the
 * resolver reports it on a non-empty list, on the array otherwise.
 */
export function errorAt(errors: FieldErrors<FormValues>, path: string): ShownError | undefined {
	const found: unknown = get(errors, path);
	const root: unknown = get(errors, `${path}.root`);

	if (isShownError(root)) {
		return root;
	}

	return isShownError(found) ? found : undefined;
}

export const errorId = (path: string) => `rule-${path.replaceAll(".", "-")}-error`;

export const described = (path: string, error: ShownError | undefined) =>
	error === undefined ? {} : { "aria-describedby": errorId(path) };

type AccountOption = { id: string; name: string };

/** Every list a value picker offers, loaded by the page. */
export type Options = {
	accounts: readonly AccountOption[];
	categories: readonly CategoryData[];
	merchants: readonly MerchantData[];
	tags: readonly TagData[];
};
