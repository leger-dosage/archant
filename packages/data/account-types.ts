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

export const ACCOUNT_SUBTYPES: readonly AccountSubtype[] = ACCOUNT_TYPE_IDS.flatMap(
	(type): readonly AccountSubtype[] => ACCOUNT_TYPES[type].subtypes,
);

export function classificationOf(type: AccountType): Classification {
	return ACCOUNT_TYPES[type].classification;
}

export function isSubtypeOf(type: AccountType, subtype: string | null): boolean {
	const allowed: readonly string[] = ACCOUNT_TYPES[type].subtypes;

	return subtype === null ? allowed.length === 0 : allowed.includes(subtype);
}
