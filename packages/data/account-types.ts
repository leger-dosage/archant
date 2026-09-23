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
	loan: { classification: "liability", subtypes: ["mortgage", "consumer", "other"] },
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
 * What a loan carries besides its balance, in `accounts.details`. Every field
 * is optional: the outstanding balance is all a loan needs. The rate is in
 * basis points (3,45 % is 345), so the two decimals lenders quote stay exact
 * without a float. `endDate` is an ISO date.
 */
export type LoanDetails = {
	originalAmount: MinorUnits | null;
	interestRate: number | null;
	endDate: string | null;
};
