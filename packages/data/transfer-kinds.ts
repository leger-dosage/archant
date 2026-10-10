/**
 * What a transfer is, derived from the two accounts' types as in Sure. Kept out
 * of the schema module so the pure domain and the interface can read it
 * without reaching for the table.
 */
export const TRANSFER_KINDS = [
	"internal_move",
	"credit_card_payment",
	"loan_payment",
	"investment_contribution",
] as const;

export type TransferKind = (typeof TRANSFER_KINDS)[number];

/**
 * Kinds whose outflow still counts as an expense: a loan repayment or an
 * investment contribution leaves the household's spending money for good.
 * `countsInCashFlow`, `recurringDirection` and their SQL twins are built from it.
 */
export const EXPENSE_TRANSFER_KINDS = [
	"loan_payment",
	"investment_contribution",
] as const satisfies readonly TransferKind[];

/**
 * Sure's `Transfer#status`: the matcher proposes a transfer `pending`, the
 * owner confirms it or pairs two lines by hand, `confirmed`. Both count the
 * same everywhere; only the list reads it, to offer the proposal.
 */
export const TRANSFER_STATUSES = ["pending", "confirmed"] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
