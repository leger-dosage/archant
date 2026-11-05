import type { AccountChoice } from "@/components/TransactionForm";
import type { AccountListData } from "@/hooks/useAccounts";

import { eligibleForTransactionDefault } from "@archant/data/account-types";
import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { intlLocale } from "@/lib/locale";

const byName = new Intl.Collator(intlLocale, { sensitivity: "base", numeric: true });

/**
 * What « Ajouter une opération » offers, as Sure's `set_new_transaction_form_options`:
 * the active accounts no bank feeds, sorted by name, starting on the user's default
 * while it is eligible, as `default_account_for_transactions`. The list of
 * operations and the dashboard's empty cash flow open the same sheet.
 */
export function accountChoiceOf(list: AccountListData): AccountChoice {
	const accounts = list.groups
		.flatMap((group) => group.accounts)
		.filter((account) => account.active && !account.linked)
		.toSorted((a, b) => byName.compare(a.name, b.name))
		.flatMap(({ id, name, currency, type, subtype }) =>
			isCurrencyCode(currency) ? [{ id, name, currency, type, subtype }] : [],
		);
	// Looked up among the options, so the select never starts on one it does not offer.
	const stored = list.groups
		.flatMap((group) => group.accounts)
		.find((account) => account.id === list.defaultAccountId);
	const offered = accounts.some((account) => account.id === stored?.id);

	return {
		accounts,
		initialAccountId:
			stored !== undefined && offered && eligibleForTransactionDefault(stored) ? stored.id : null,
		fallbackCurrency: isCurrencyCode(list.reportingCurrency)
			? list.reportingCurrency
			: DEFAULT_CURRENCY,
	};
}
