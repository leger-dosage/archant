import type { MinorUnits } from "./money.ts";

export const CLASSIFICATIONS = ["asset", "liability"] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * Sure's `Account#balance_type`: what moves a type's balance. A `cash` account
 * moves with its transactions, an `investment` one with them and its holdings,
 * a `non_cash` one only with its valuations.
 */
export const BALANCE_TYPES = ["cash", "investment", "non_cash"] as const;

export type BalanceType = (typeof BALANCE_TYPES)[number];

/**
 * The one list of account types. A type's classification decides which group
 * it is listed under and the sign of its balance updates (AD-5); its balance
 * type decides what moves its balance (AD-8); its subtypes are the only values
 * `accounts.subtype` accepts for it. A type with `subtypeOptional` also takes
 * no subtype at all, as Sure's `allow_blank`.
 */
export const ACCOUNT_TYPES = {
	// Sure's `Depository::SUBTYPES` keys in its order, less `hsa`, an American
	// health savings account no French household holds.
	depository: {
		classification: "asset",
		balanceType: "cash",
		subtypes: ["cash", "checking", "savings", "cd", "money_market"],
		subtypeOptional: true,
	},
	credit_card: { classification: "liability", balanceType: "cash", subtypes: [] },
	// Sure's `Loan::SUBTYPES` keys, in its order.
	loan: {
		classification: "liability",
		balanceType: "non_cash",
		subtypes: ["mortgage", "student", "auto", "home_equity", "line_of_credit", "business", "other"],
	},
	// Sure's `Investment::SUBTYPES` keys of its « Europe » and generic regions,
	// in the order its `subtypes_grouped_for_select` gives them for `EUR`, then
	// `brokerage`, the compte-titres, alone of its US ones. No French household
	// holds the US, UK, Canadian, Australian or Indian others.
	investment: {
		classification: "asset",
		balanceType: "investment",
		subtypes: [
			"assurance_vie",
			"pea",
			"pillar_3a",
			"riester",
			"pension",
			"retirement",
			"mutual_fund",
			"gold",
			"angel",
			"trust",
			"other",
			"brokerage",
		],
		subtypeOptional: true,
	},
	// Sure's `Crypto::SUBTYPES`: coins kept by their owner or on a platform.
	// Sure's `Accountable::TYPES` lists it right after investments, and its
	// balance moves as theirs, cash and holdings.
	crypto: {
		classification: "asset",
		balanceType: "investment",
		subtypes: ["wallet", "exchange"],
		subtypeOptional: true,
	},
	// Sure's `Property::SUBTYPES` keys, in its order.
	property: {
		classification: "asset",
		balanceType: "non_cash",
		subtypes: [
			"single_family_home",
			"multi_family_home",
			"condominium",
			"townhouse",
			"investment_property",
			"second_home",
			"apartment",
			"plot",
			"commercial",
			"agri_land",
		],
	},
	// Sure's `Vehicle` has no subtypes.
	vehicle: { classification: "asset", balanceType: "non_cash", subtypes: [] },
	// Sure's `OtherAsset` and `OtherLiability`: jewellery, a loan from a
	// relative, anything the other types do not name. No subtype, no details.
	other_asset: { classification: "asset", balanceType: "non_cash", subtypes: [] },
	other_liability: { classification: "liability", balanceType: "non_cash", subtypes: [] },
} as const satisfies Record<
	string,
	{
		classification: Classification;
		balanceType: BalanceType;
		subtypes: readonly string[];
		subtypeOptional?: true;
	}
>;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export type AccountSubtype = (typeof ACCOUNT_TYPES)[AccountType]["subtypes"][number];

export function isAccountType(value: string): value is AccountType {
	return Object.hasOwn(ACCOUNT_TYPES, value);
}

export const ACCOUNT_TYPE_IDS: readonly AccountType[] =
	Object.keys(ACCOUNT_TYPES).filter(isAccountType);

// Distinct values: `other` belongs to both loans and investments.
export const ACCOUNT_SUBTYPES: readonly AccountSubtype[] = [
	...new Set(
		ACCOUNT_TYPE_IDS.flatMap((type): readonly AccountSubtype[] => ACCOUNT_TYPES[type].subtypes),
	),
];

export function isAccountSubtype(value: unknown): value is AccountSubtype {
	return typeof value === "string" && ACCOUNT_SUBTYPES.some((subtype) => subtype === value);
}

export function classificationOf(type: AccountType): Classification {
	return ACCOUNT_TYPES[type].classification;
}

export function balanceTypeOf(type: AccountType): BalanceType {
	return ACCOUNT_TYPES[type].balanceType;
}

/**
 * Whether a booked transaction or trade moves the account's balance, as
 * Sure's `Balance::BaseCalculator`: on a non-cash account only valuations do,
 * so paying a builder from a property leaves the home's value as it was. A
 * loan is non-cash but its payments lower the debt, Sure's
 * `accountable_type == "Loan"` branch.
 */
export function transactionsMoveBalance(type: AccountType): boolean {
	return balanceTypeOf(type) !== "non_cash" || type === "loan";
}

/** Whether a type takes no subtype, either because it has none or because one is optional. */
export function allowsNullSubtype(type: AccountType): boolean {
	const definition: { subtypes: readonly string[]; subtypeOptional?: true } = ACCOUNT_TYPES[type];

	return definition.subtypes.length === 0 || definition.subtypeOptional === true;
}

export function isSubtypeOf(type: AccountType, subtype: string | null): boolean {
	const allowed: readonly string[] = ACCOUNT_TYPES[type].subtypes;

	return subtype === null ? allowsNullSubtype(type) : allowed.includes(subtype);
}

/**
 * The subtypes Sure's `Investment::SUBTYPES` does not treat as `:taxable`:
 * a PEA, an assurance-vie and a retirement plan hold money set aside, so no
 * cash-flow report and no list total counts their lines, as Sure's
 * `tax_advantaged_account_ids`. Net worth still does. No subtype is taxable,
 * as Sure's `|| :taxable`.
 */
export const TAX_ADVANTAGED_SUBTYPES = [
	"assurance_vie",
	"pea",
	"pillar_3a",
	"riester",
	"pension",
	"retirement",
] as const satisfies readonly AccountSubtype[];

/**
 * Sure's `Crypto.tax_treatments`, in its order: a crypto account stores the
 * one it is held under, `taxable` unless chosen.
 */
export const TAX_TREATMENTS = ["taxable", "tax_deferred", "tax_exempt"] as const;

export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/**
 * Whether an account is tax-advantaged, as Sure's
 * `Family#tax_advantaged_account_ids`: an investment account of a subtype in
 * `TAX_ADVANTAGED_SUBTYPES`, or a crypto account held `tax_deferred` or
 * `tax_exempt`.
 */
export function isTaxAdvantaged(account: {
	type: AccountType;
	subtype: string | null;
	details: AccountDetails | null;
}): boolean {
	if (account.type === "crypto") {
		const treatment = cryptoDetailsOf(account)?.taxTreatment ?? "taxable";

		return treatment !== "taxable";
	}

	return (
		account.type === "investment" &&
		TAX_ADVANTAGED_SUBTYPES.some((value) => value === account.subtype)
	);
}

/**
 * Whether an account holds securities, Sure's `Investment || Crypto`: its
 * balance is cash and holdings (AD-22). Its trades stay editable, its
 * positions listed, whatever its subtype.
 */
export function holdsSecurities(type: AccountType): boolean {
	return balanceTypeOf(type) === "investment";
}

/**
 * Whether an account takes new trades, as Sure's `supports_trades?`: every
 * investment account, and a crypto one only on an exchange; a wallet is
 * filled by a provider's sync, which Archant has not.
 */
export function supportsTrades(account: { type: AccountType; subtype: string | null }): boolean {
	return (
		account.type === "investment" || (account.type === "crypto" && account.subtype === "exchange")
	);
}

/**
 * Whether an account type can be a user's default for new transactions, as
 * Sure's `supports_default?`: the « Par défaut » caption shows only on these.
 */
export function supportsDefault(type: AccountType): boolean {
	return type === "depository" || type === "credit_card";
}

/**
 * Whether an account can be set as the default, and whether a stored default
 * still applies, as Sure's `eligible_for_transaction_default?`: a deactivated
 * or linked default stays stored, but the form ignores it.
 */
export function eligibleForTransactionDefault(account: {
	type: AccountType;
	active: boolean;
	linked: boolean;
}): boolean {
	return supportsDefault(account.type) && account.active && !account.linked;
}

/**
 * What a bank account can become, the targets of Sure's
 * `CASH_ACCOUNT_TYPE_MAP`: only these types hold a bank's cash balance.
 */
export const BANK_ACCOUNT_TARGETS = [
	{ type: "depository", subtype: "checking" },
	{ type: "depository", subtype: "savings" },
	{ type: "credit_card", subtype: null },
	{ type: "loan", subtype: "other" },
	{ type: "loan", subtype: "mortgage" },
] as const satisfies readonly { type: AccountType; subtype: AccountSubtype | null }[];

export type BankAccountTarget = (typeof BANK_ACCOUNT_TARGETS)[number];

export function isBankAccountTarget(type: AccountType, subtype: string | null): boolean {
	return BANK_ACCOUNT_TARGETS.some((target) => target.type === type && target.subtype === subtype);
}

/** Sure's `Loan.rate_types`: a variable or adjustable rate follows its dated changes. */
export const LOAN_RATE_TYPES = ["fixed", "variable", "adjustable"] as const;

export type LoanRateType = (typeof LOAN_RATE_TYPES)[number];

/**
 * Sure's `Loan.insurance_rate_types`: a level premium is charged on the amount
 * borrowed, a decreasing one on the balance still owed.
 */
export const LOAN_INSURANCE_TYPES = ["level_term", "decreasing_life"] as const;

export type LoanInsuranceType = (typeof LOAN_INSURANCE_TYPES)[number];

/** Sure's `AmortizationMath::MAX_PERIODS`: a hundred years of monthly payments. */
export const MAX_LOAN_TERM_MONTHS = 1200;

/** A dated rate change of a variable or adjustable loan, its rate in millionths. */
export type LoanRateChange = { effectiveDate: string; rate: number };

/**
 * What a loan carries besides its balance, in `accounts.details`, as Sure's
 * `Loan` columns. Every scalar is nullable: the outstanding balance is all a
 * loan needs. Rates are integers in millionths of one (AD-25): 1,82 % is
 * 18200, 0,2917 % is 2917, so the four decimals an insurance rate is quoted
 * with stay exact without a float. Dates are ISO dates. `rateChanges` is
 * sorted by date, one row per date, and kept whatever the rate type, as
 * Sure's `rate_changes=`. `endDate` survives only on a loan not saved since
 * Story 24.1 replaced it with `termMonths`; every save writes it null.
 */
export type LoanDetails = {
	originalAmount: MinorUnits | null;
	downPayment: MinorUnits | null;
	startDate: string | null;
	termMonths: number | null;
	rateType: LoanRateType | null;
	interestRate: number | null;
	insuranceRate: number | null;
	insuranceRateType: LoanInsuranceType | null;
	rateChanges: LoanRateChange[];
	endDate: string | null;
};

/**
 * What a credit card carries besides its balance, in `accounts.details`, as
 * Sure's `CreditCard` columns, every one optional. Amounts are minor units in
 * the account's currency; the APR is in millionths of one, as a loan's rates
 * (AD-25), so 15,99 % is 159900. `availableCredit` holds the card's limit
 * while its bank account treats the balance as available credit, and the
 * credit left otherwise, as Sure's processor writes it.
 */
export type CreditCardDetails = {
	availableCredit: MinorUnits | null;
	minimumPayment: MinorUnits | null;
	apr: number | null;
	expirationDate: string | null;
	annualFee: MinorUnits | null;
};

/** Sure's `area_unit` values, square feet and square metres. */
export const AREA_UNITS = ["sqft", "sqm"] as const;

export type AreaUnit = (typeof AREA_UNITS)[number];

/** Sure's `mileage_unit` values, miles and kilometres. */
export const MILEAGE_UNITS = ["mi", "km"] as const;

export type MileageUnit = (typeof MILEAGE_UNITS)[number];

/**
 * What a property carries besides its value, in `accounts.details`, as
 * Sure's `Property` columns and its `Address`, less the `line2` and `county`
 * its form never asks for. Every value is optional; the unit always has one,
 * square metres unless chosen, where Sure defaults to square feet.
 */
export type PropertyDetails = {
	yearBuilt: number | null;
	areaValue: number | null;
	areaUnit: AreaUnit;
	addressLine1: string | null;
	locality: string | null;
	region: string | null;
	postalCode: string | null;
	country: string | null;
};

/**
 * What a vehicle carries besides its value, in `accounts.details`, as Sure's
 * `Vehicle` columns. Every value is optional; the unit always has one,
 * kilometres unless chosen, where Sure defaults to miles.
 */
export type VehicleDetails = {
	make: string | null;
	model: string | null;
	year: number | null;
	mileageValue: number | null;
	mileageUnit: MileageUnit;
};

/** What a crypto account carries besides its balance, as Sure's `Crypto` columns. */
export type CryptoDetails = { taxTreatment: TaxTreatment };

/** What `accounts.details` holds: its own type's details, never another type's. */
export type AccountDetails =
	| LoanDetails
	| CreditCardDetails
	| PropertyDetails
	| VehicleDetails
	| CryptoDetails;

/** A loan's details, null for any other account or a loan without them. */
export function loanDetailsOf(account: {
	type: AccountType;
	details: AccountDetails | null;
}): LoanDetails | null {
	return account.type === "loan" && account.details !== null && "rateChanges" in account.details
		? account.details
		: null;
}

/** A credit card's details, null for any other account or a card without them. */
export function creditCardDetailsOf(account: {
	type: AccountType;
	details: AccountDetails | null;
}): CreditCardDetails | null {
	return account.type === "credit_card" &&
		account.details !== null &&
		"availableCredit" in account.details
		? account.details
		: null;
}

/** A property's details, null for any other account or a property saved before it had them. */
export function propertyDetailsOf(account: {
	type: AccountType;
	details: AccountDetails | null;
}): PropertyDetails | null {
	return account.type === "property" && account.details !== null && "areaUnit" in account.details
		? account.details
		: null;
}

/** A vehicle's details, null for any other account or a vehicle saved before it had them. */
export function vehicleDetailsOf(account: {
	type: AccountType;
	details: AccountDetails | null;
}): VehicleDetails | null {
	return account.type === "vehicle" && account.details !== null && "mileageUnit" in account.details
		? account.details
		: null;
}

/** A crypto account's details, null for any other account or one without them. */
export function cryptoDetailsOf(account: {
	type: AccountType;
	details: AccountDetails | null;
}): CryptoDetails | null {
	return account.type === "crypto" && account.details !== null && "taxTreatment" in account.details
		? account.details
		: null;
}
