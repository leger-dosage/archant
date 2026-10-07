import type { MinorUnits } from "@archant/data/money";

/**
 * Sure's `Loan#original_balance`: the amount borrowed when one above zero is
 * recorded, else the account's first valuation, its opening balance. Every
 * figure measured against what was borrowed reads it: the schedule's
 * principal, the insurance base, the share repaid and the leverage. A bank
 * links a loan without its amount borrowed, and Sure's imports write a zero or
 * a negative, so neither counts as recorded.
 */
export function originalBalance(recorded: MinorUnits | null, openingBalance: bigint): bigint {
	return recorded !== null && recorded > 0 ? BigInt(recorded) : openingBalance;
}
