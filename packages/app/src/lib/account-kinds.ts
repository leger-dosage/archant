import type { AccountSubtype, AccountType } from "@archant/data/account-types";

/**
 * The form's single "Type" choice, spelled out as the type and subtype pairs
 * the API stores. The id doubles as the translation key under
 * `accounts.subtypes`.
 */
export const ACCOUNT_KINDS = [
	{ id: "checking", type: "depository", subtype: "checking" },
	{ id: "savings", type: "depository", subtype: "savings" },
	{ id: "credit_card", type: "credit_card", subtype: null },
	{ id: "mortgage", type: "loan", subtype: "mortgage" },
	{ id: "consumer", type: "loan", subtype: "consumer" },
	// `other` alone would read as any account, not a loan.
	{ id: "other_loan", type: "loan", subtype: "other" },
	{ id: "pea", type: "investment", subtype: "pea" },
	{ id: "assurance_vie", type: "investment", subtype: "assurance_vie" },
	// Sure's `brokerage`, labelled « Compte-titres ».
	{ id: "brokerage", type: "investment", subtype: "brokerage" },
	{ id: "other_investment", type: "investment", subtype: "other" },
	{ id: "single_family_home", type: "property", subtype: "single_family_home" },
	{ id: "apartment", type: "property", subtype: "apartment" },
	{ id: "second_home", type: "property", subtype: "second_home" },
	{ id: "investment_property", type: "property", subtype: "investment_property" },
	{ id: "plot", type: "property", subtype: "plot" },
	{ id: "commercial", type: "property", subtype: "commercial" },
	{ id: "vehicle", type: "vehicle", subtype: null },
] as const satisfies readonly { id: string; type: AccountType; subtype: AccountSubtype | null }[];

export type AccountKindId = (typeof ACCOUNT_KINDS)[number]["id"];

export function kindOf(type: AccountType, subtype: AccountSubtype | null): AccountKindId {
	return (
		ACCOUNT_KINDS.find((kind) => kind.type === type && kind.subtype === subtype)?.id ?? "checking"
	);
}
