import type { BalanceChange } from "../domain/balances/history.ts";
import type { AccountDetail } from "./accounts.ts";
import type { ServiceDeps } from "./deps.ts";
import type { LoanOverviewData } from "./loans.ts";

import type { MinorUnits } from "@archant/data/money";

import { balanceChange } from "../domain/balances/history.ts";
import { today } from "../domain/dates.ts";
import { getAccount } from "./accounts.ts";
import { firstValuationOf } from "./ledger/balances.ts";
import { loanOverview } from "./loans.ts";

/**
 * Sure's `properties/tabs/_overview` and `vehicles/tabs/_overview` figures
 * that need the ledger; the details themselves come with the account.
 */
export type AssetOverviewData = {
	kind: "property" | "vehicle";
	currency: string;
	/** Sure's « Valeur marchande » and « Prix actuel »: the balance. */
	balance: MinorUnits;
	/** Sure's `purchase_price`, its `first_valuation_amount`. */
	purchasePrice: MinorUnits;
	/** Sure's `Trend`: the balance against the purchase price. */
	trend: BalanceChange;
};

/**
 * Sure's `overview` tab, as `UI::AccountPage#tabs` offers it: a loan's terms,
 * a property's or a vehicle's value against its purchase price; `null` for
 * any other account.
 */
export async function accountOverview(
	deps: ServiceDeps,
	accountId: string,
): Promise<LoanOverviewData | AssetOverviewData | null> {
	const account = await getAccount(deps, accountId);

	if (account.type === "loan") {
		return loanOverview(deps, account);
	}

	return account.type === "property" || account.type === "vehicle"
		? assetOverview(deps, account, account.type)
		: null;
}

/**
 * A property's or a vehicle's value against what it was bought for, Sure's
 * `first_valuation_amount`: the amount of its earliest valuation by date, the
 * opening one included, else its balance.
 */
async function assetOverview(
	deps: ServiceDeps,
	account: AccountDetail,
	kind: AssetOverviewData["kind"],
): Promise<AssetOverviewData> {
	const purchasePrice = (await firstValuationOf(deps, account.id)) ?? account.balance;
	const asOf = today(deps.timeZone);
	// Two points always make a change.
	const trend = balanceChange([
		{ date: asOf, balance: purchasePrice },
		{ date: asOf, balance: account.balance },
	])!;

	return {
		kind,
		currency: account.currency,
		balance: account.balance,
		purchasePrice,
		trend,
	};
}
