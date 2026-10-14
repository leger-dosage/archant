import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/** What a card's bank account says about how to read its balance. */
export type CreditCardBankSide = {
	/** The limit the bank listed, in the bank account's currency; null when none. */
	creditLimit: MinorUnits | null;
	treatBalanceAsAvailableCredit: boolean;
};

/**
 * A card's bank balance read as Sure's
 * `EnableBankingAccount::Processor#interpret_credit_card_balance`. `balance`
 * is the debt to store, null when it cannot be known and the stored balance
 * stays; `availableCredit` is what « Crédit disponible » becomes.
 */
export type CreditCardBalance = {
	balance: MinorUnits | null;
	availableCredit: MinorUnits | null;
};

// Sure's `positive_credit_limit`: a limit of zero or less is no limit.
const positive = (value: MinorUnits | null): MinorUnits | null =>
	value !== null && value > 0 ? value : null;

/**
 * `reported` is the bank's figure as a stored balance, already absolute for a
 * liability (`toStoredBankBalance`). With the toggle on, the bank reports the
 * credit left: the debt is the limit, the bank's else the card's own
 * « Crédit disponible », less it, never below zero, and « Crédit disponible »
 * keeps the limit so the next sync reads it again; without any limit the debt
 * is unknown and no balance is written. With it off, the bank reports the
 * debt, and a bank limit refreshes the credit left. No bank side at all reads
 * as the toggle off without a limit.
 */
export function interpretCreditCardBalance(
	reported: MinorUnits,
	bank: CreditCardBankSide | undefined,
	availableCredit: MinorUnits | null,
): CreditCardBalance {
	const bankLimit = positive(bank?.creditLimit ?? null);

	if (bank?.treatBalanceAsAvailableCredit === true) {
		const limit = bankLimit ?? positive(availableCredit);

		return limit === null
			? { balance: null, availableCredit: null }
			: {
					balance: toMinorUnits(Math.max(limit - reported, 0)),
					availableCredit: limit,
				};
	}

	return {
		balance: reported,
		availableCredit:
			bankLimit === null ? availableCredit : toMinorUnits(Math.max(bankLimit - reported, 0)),
	};
}
