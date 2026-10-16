import type { AccountOrder } from "@archant/data/account-orders";
import type { MinorUnits } from "@archant/data/money";
import { isCurrencyCode, minorUnitsOf } from "@archant/data/money";

/** What the order reads of an account. */
export type Orderable = { id: string; name: string; balance: MinorUnits; currency: string };

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** A code outside ISO 4217 counts two decimals, as `formatMoney` shows it. */
function decimalsOf(currency: string): number {
	return isCurrencyCode(currency) ? minorUnitsOf(currency) : 2;
}

/**
 * Sure's `account.balance` comparison, a decimal in each account's own
 * currency, without conversion: 100,00 EUR against 50 JPY is 100 against 50.
 * Each side is scaled to the other's decimals as a `BigInt`, so the
 * comparison stays exact where a division would round.
 */
function compareBalances(a: Orderable, b: Orderable): number {
	const left = BigInt(a.balance) * 10n ** BigInt(decimalsOf(b.currency));
	const right = BigInt(b.balance) * 10n ** BigInt(decimalsOf(a.currency));

	return left === right ? 0 : left < right ? -1 : 1;
}

function compareNames(a: Orderable, b: Orderable): number {
	return byName.compare(a.name, b.name);
}

const PRIMARY: Record<AccountOrder, (a: Orderable, b: Orderable) => number> = {
	name_asc: compareNames,
	name_desc: (a, b) => compareNames(b, a),
	balance_asc: compareBalances,
	balance_desc: (a, b) => compareBalances(b, a),
};

/**
 * Sure's `BalanceSheet#sorted` for one classification group: name A-Z or
 * Z-A, balance lowest or highest first. Names compare with the French
 * collator rather than Sure's byte order, so « Épargne » sits beside « E ».
 * Sure leaves ties to chance; here they fall back to name A-Z, then id, so
 * the list never shuffles between two reads.
 */
export function sortAccounts<Account extends Orderable>(
	accounts: readonly Account[],
	order: AccountOrder,
): Account[] {
	const primary = PRIMARY[order];

	return accounts.toSorted(
		(a, b) => primary(a, b) || compareNames(a, b) || Number(a.id > b.id) - Number(a.id < b.id),
	);
}
