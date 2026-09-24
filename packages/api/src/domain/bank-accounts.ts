import type { AccountType, BankAccountTarget } from "@archant/data/account-types";

/**
 * Sure's `EnableBankingAccount::CASH_ACCOUNT_TYPE_MAP`: the ISO 20022 cash
 * account type a bank reports, and the account it most likely is. `LOAN`
 * becomes an other loan, where Sure leaves the subtype empty.
 */
const CASH_ACCOUNT_TYPE_MAP = new Map<string, BankAccountTarget>(
	Object.entries({
		CACC: { type: "depository", subtype: "checking" },
		TRAN: { type: "depository", subtype: "checking" },
		SALA: { type: "depository", subtype: "checking" },
		ODFT: { type: "depository", subtype: "checking" },
		NREX: { type: "depository", subtype: "checking" },
		TAXE: { type: "depository", subtype: "checking" },
		TRAS: { type: "depository", subtype: "checking" },
		CASH: { type: "depository", subtype: "checking" },
		SVGS: { type: "depository", subtype: "savings" },
		MOMA: { type: "depository", subtype: "savings" },
		ONDP: { type: "depository", subtype: "savings" },
		CARD: { type: "credit_card", subtype: null },
		CRCD: { type: "credit_card", subtype: null },
		LOAN: { type: "loan", subtype: "other" },
		MORT: { type: "loan", subtype: "mortgage" },
	} satisfies Record<string, BankAccountTarget>),
);

/** The account a bank account should become, `null` when its type says nothing: skip it. */
export function suggestedTarget(cashAccountType: string | null): BankAccountTarget | null {
	return cashAccountType === null ? null : (CASH_ACCOUNT_TYPE_MAP.get(cashAccountType) ?? null);
}

const LINKABLE_TYPES: ReadonlySet<AccountType> = new Set(["depository", "credit_card", "loan"]);

/**
 * Whether an existing account can take a bank account's data: active, fed
 * by no other bank account, in the same currency, of a type that holds a
 * bank's cash and, when the bank's type is known, of that type.
 */
export function isLinkCandidate(
	account: { type: AccountType; currency: string; active: boolean; bankAccountId: string | null },
	bankAccount: { currency: string; cashAccountType: string | null },
): boolean {
	const suggestion = suggestedTarget(bankAccount.cashAccountType);

	return (
		account.active &&
		account.bankAccountId === null &&
		account.currency === bankAccount.currency &&
		LINKABLE_TYPES.has(account.type) &&
		(suggestion === null || suggestion.type === account.type)
	);
}
