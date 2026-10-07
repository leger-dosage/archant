import type { MinorUnits } from "./money.ts";

export const CLASSIFICATIONS = ["asset", "liability"] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * The one list of account types. A type's classification decides which group
 * it is listed under and the sign of its balance updates (AD-5); its subtypes
 * are the only values `accounts.subtype` accepts for it.
 */
export const ACCOUNT_TYPES = {
	depository: { classification: "asset", subtypes: ["checking", "savings"] },
	credit_card: { classification: "liability", subtypes: [] },
	// Sure's `Loan::SUBTYPES` keys, in its order.
	loan: {
		classification: "liability",
		subtypes: ["mortgage", "student", "auto", "home_equity", "line_of_credit", "business", "other"],
	},
	// Sure's `Investment::SUBTYPES` keys: `brokerage` is the compte-titres.
	investment: {
		classification: "asset",
		subtypes: ["pea", "assurance_vie", "brokerage", "other"],
	},
	// A French-relevant subset of Sure's `Property::SUBTYPES` keys.
	property: {
		classification: "asset",
		subtypes: [
			"single_family_home",
			"apartment",
			"second_home",
			"investment_property",
			"plot",
			"commercial",
		],
	},
	// Sure's `Vehicle` has no subtypes.
	vehicle: { classification: "asset", subtypes: [] },
} as const satisfies Record<
	string,
	{ classification: Classification; subtypes: readonly string[] }
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

export function isSubtypeOf(type: AccountType, subtype: string | null): boolean {
	const allowed: readonly string[] = ACCOUNT_TYPES[type].subtypes;

	return subtype === null ? allowed.length === 0 : allowed.includes(subtype);
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
