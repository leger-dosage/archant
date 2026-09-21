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
] as const satisfies readonly { id: string; type: AccountType; subtype: AccountSubtype | null }[];

export type AccountKindId = (typeof ACCOUNT_KINDS)[number]["id"];

export function kindOf(type: AccountType, subtype: AccountSubtype | null): AccountKindId {
	return (
		ACCOUNT_KINDS.find((kind) => kind.type === type && kind.subtype === subtype)?.id ?? "checking"
	);
}
