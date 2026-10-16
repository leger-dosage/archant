import type { AccountSubtype, AccountType } from "@archant/data/account-types";

/**
 * The form's single "Type" choice, spelled out as the type and subtype pairs
 * the API stores. The id doubles as the translation key under
 * `accounts.subtypes`.
 */
export const ACCOUNT_KINDS = [
	// A depository without a subtype, Sure's `allow_blank`. Its id names the
	// type: Sure shows the type's name, and « Espèces » is already `cash`'s.
	{ id: "depository", type: "depository", subtype: null },
	{ id: "cash", type: "depository", subtype: "cash" },
	{ id: "checking", type: "depository", subtype: "checking" },
	{ id: "savings", type: "depository", subtype: "savings" },
	{ id: "cd", type: "depository", subtype: "cd" },
	{ id: "money_market", type: "depository", subtype: "money_market" },
	{ id: "credit_card", type: "credit_card", subtype: null },
	{ id: "mortgage", type: "loan", subtype: "mortgage" },
	{ id: "student", type: "loan", subtype: "student" },
	{ id: "auto", type: "loan", subtype: "auto" },
	{ id: "home_equity", type: "loan", subtype: "home_equity" },
	{ id: "line_of_credit", type: "loan", subtype: "line_of_credit" },
	{ id: "business", type: "loan", subtype: "business" },
	// `other` alone would read as any account, not a loan.
	{ id: "other_loan", type: "loan", subtype: "other" },
	// An investment without a subtype, Sure's `include_blank`, named as Sure
	// names the type.
	{ id: "investment", type: "investment", subtype: null },
	{ id: "assurance_vie", type: "investment", subtype: "assurance_vie" },
	{ id: "pea", type: "investment", subtype: "pea" },
	{ id: "pillar_3a", type: "investment", subtype: "pillar_3a" },
	{ id: "riester", type: "investment", subtype: "riester" },
	{ id: "pension", type: "investment", subtype: "pension" },
	{ id: "retirement", type: "investment", subtype: "retirement" },
	{ id: "mutual_fund", type: "investment", subtype: "mutual_fund" },
	{ id: "gold", type: "investment", subtype: "gold" },
	{ id: "angel", type: "investment", subtype: "angel" },
	{ id: "trust", type: "investment", subtype: "trust" },
	{ id: "other_investment", type: "investment", subtype: "other" },
	// Sure's `brokerage`, labelled « Compte-titres ».
	{ id: "brokerage", type: "investment", subtype: "brokerage" },
	// Right after investments, as Sure's `Accountable::TYPES`: a crypto account
	// without a subtype, named as Sure names the type, then `Crypto::SUBTYPES`.
	{ id: "crypto", type: "crypto", subtype: null },
	{ id: "wallet", type: "crypto", subtype: "wallet" },
	{ id: "exchange", type: "crypto", subtype: "exchange" },
	// Sure's `Property::SUBTYPES`, in its order.
	{ id: "single_family_home", type: "property", subtype: "single_family_home" },
	{ id: "multi_family_home", type: "property", subtype: "multi_family_home" },
	{ id: "condominium", type: "property", subtype: "condominium" },
	{ id: "townhouse", type: "property", subtype: "townhouse" },
	{ id: "investment_property", type: "property", subtype: "investment_property" },
	{ id: "second_home", type: "property", subtype: "second_home" },
	{ id: "apartment", type: "property", subtype: "apartment" },
	{ id: "plot", type: "property", subtype: "plot" },
	{ id: "commercial", type: "property", subtype: "commercial" },
	{ id: "agri_land", type: "property", subtype: "agri_land" },
	{ id: "vehicle", type: "vehicle", subtype: null },
	// Last, as Sure's `accounts/new` lists them.
	{ id: "other_asset", type: "other_asset", subtype: null },
	{ id: "other_liability", type: "other_liability", subtype: null },
] as const satisfies readonly { id: string; type: AccountType; subtype: AccountSubtype | null }[];

export type AccountKindId = (typeof ACCOUNT_KINDS)[number]["id"];

export function kindOf(type: AccountType, subtype: AccountSubtype | null): AccountKindId {
	return (
		ACCOUNT_KINDS.find((kind) => kind.type === type && kind.subtype === subtype)?.id ?? "checking"
	);
}

/**
 * The investment subtypes by region, as Sure's `subtypes_grouped_for_select`
 * orders them for `EUR`, the reporting currency: Europe, then the generic
 * ones, then the United States. The id is the key under
 * `accounts.subtypeRegions`; each kind's label is under
 * `accounts.subtypeLongs`, Sure's long label, which only the select shows.
 */
export const INVESTMENT_REGIONS = [
	{ id: "eu", kinds: ["assurance_vie", "pea", "pillar_3a", "riester"] },
	{
		id: "generic",
		kinds: ["pension", "retirement", "mutual_fund", "gold", "angel", "trust", "other_investment"],
	},
	{ id: "us", kinds: ["brokerage"] },
] as const satisfies readonly { id: string; kinds: readonly AccountKindId[] }[];

/**
 * The crypto subtypes, as Sure's `Crypto::SUBTYPES`; each kind's label in a
 * select is under `accounts.subtypeLongs`, Sure's long label.
 */
export const CRYPTO_KINDS = ["wallet", "exchange"] as const satisfies readonly AccountKindId[];
