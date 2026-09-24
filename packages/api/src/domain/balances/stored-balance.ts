import type { AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/**
 * A statement balance, signed as the bank prints it, as a stored balance
 * (AD-5): an asset's value is the bank's figure, a liability's amount owed is
 * its opposite, so a card at `-512,30` owes 512,30. The only place a
 * statement balance changes sign; no connector negates one.
 */
export function toStoredBalance(account: { type: AccountType }, signed: MinorUnits): MinorUnits {
	return classificationOf(account.type) === "asset" ? signed : toMinorUnits(0 - signed);
}

/**
 * A bank's balance as a stored balance, as Sure's Enable Banking import
 * does: an asset's is the signed figure, a liability's the absolute value.
 * Banks disagree on the sign of what a card or a loan owes, where a file
 * statement follows OFX; only its size is certain.
 */
export function toStoredBankBalance(
	account: { type: AccountType },
	signed: MinorUnits,
): MinorUnits {
	return classificationOf(account.type) === "asset" ? signed : toMinorUnits(Math.abs(signed));
}
