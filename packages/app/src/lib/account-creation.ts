import type { AccountType } from "@archant/data/account-types";

/** The types Sure's `accounts/new.html.erb` lists, in its order. */
export const NEW_ACCOUNT_TYPES = [
	"depository",
	"investment",
	"crypto",
	"property",
	"vehicle",
	"credit_card",
	"loan",
	"other_asset",
	"other_liability",
] as const satisfies readonly AccountType[];

// The types whose `new.html.erb` renders `accounts/new/method_selector` on
// `step=method_select`; the others ignore the step and open their form.
const METHOD_TYPES: ReadonlySet<AccountType> = new Set([
	"depository",
	"investment",
	"crypto",
	"credit_card",
	"loan",
]);

// Sure's `EnableBankingAdapter.supported_account_types`.
const LINKED_TYPES: ReadonlySet<AccountType> = new Set(["depository", "credit_card"]);

/** Whether Sure asks « Comment voulez-vous l'ajouter ? » before the type's form. */
export function hasMethodStep(type: AccountType): boolean {
	return METHOD_TYPES.has(type);
}

/** Whether the method step offers « Lier avec Enable Banking ». */
export function linksBank(type: AccountType): boolean {
	return LINKED_TYPES.has(type);
}

/** Sure's property tabs, `properties/_form_tabs.html.erb`, in order. */
export const PROPERTY_STEPS = ["overview", "value", "address"] as const;

export type PropertyStep = (typeof PROPERTY_STEPS)[number];

/** The types with a form of their own; a property walks its steps instead. */
type FormType = Exclude<AccountType, "property">;

export type CreationStep =
	| { kind: "types" }
	| { kind: "method"; type: FormType }
	| { kind: "form"; type: FormType }
	| { kind: "property"; step: PropertyStep };

/** Where choosing a type leads, as Sure's `new_polymorphic_path(step: "method_select")`. */
export function stepAfterType(type: AccountType): CreationStep {
	if (type === "property") {
		return { kind: "property", step: "overview" };
	}

	return hasMethodStep(type) ? { kind: "method", type } : { kind: "form", type };
}

/** Where a step's back arrow leads; none from the type list. */
export function previousStep(step: CreationStep): CreationStep | null {
	switch (step.kind) {
		case "types":
			return null;
		case "method":
			return { kind: "types" };
		case "form":
			return hasMethodStep(step.type) ? { kind: "method", type: step.type } : { kind: "types" };
	}

	const before = PROPERTY_STEPS[PROPERTY_STEPS.indexOf(step.step) - 1];

	return before === undefined ? { kind: "types" } : { kind: "property", step: before };
}

/** The property step after `step`; none after « Adresse », which posts. */
export function nextPropertyStep(step: PropertyStep): PropertyStep | null {
	return PROPERTY_STEPS[PROPERTY_STEPS.indexOf(step) + 1] ?? null;
}

/** The fields each property step shows, as the form names them. */
export const PROPERTY_STEP_FIELDS = {
	overview: ["name", "subtype", "details.yearBuilt", "details.areaValue", "details.areaUnit"],
	value: ["currency", "openingBalance", "openingDate"],
	address: [
		"details.addressLine1",
		"details.locality",
		"details.region",
		"details.postalCode",
		"details.country",
		"institutionName",
		"institutionDomain",
		"notes",
		"excludedFromReports",
	],
} as const satisfies Record<PropertyStep, readonly string[]>;

/**
 * The property step that shows a field, by its path as the API or the form
 * names it; null for a field no step shows.
 */
export function propertyStepOfField(path: string): PropertyStep | null {
	const step = PROPERTY_STEPS.find((candidate) => {
		const fields: readonly string[] = PROPERTY_STEP_FIELDS[candidate];

		return fields.includes(path);
	});

	return step ?? null;
}

/** The earliest step showing one of `paths`, so a refusal opens where its first field sits. */
export function firstPropertyStepOf(paths: readonly string[]): PropertyStep | null {
	const steps = new Set(paths.map(propertyStepOfField));

	return PROPERTY_STEPS.find((step) => steps.has(step)) ?? null;
}
