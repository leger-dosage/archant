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
