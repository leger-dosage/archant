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
 * `direction` and the list's SQL filter are both built from it.
 */
export const EXPENSE_TRANSFER_KINDS = [
	"loan_payment",
	"investment_contribution",
] as const satisfies readonly TransferKind[];
