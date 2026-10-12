import type { MinorUnits } from "./money.ts";

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
 * `countsInCashFlow` and its SQL twin are built from it.
 */
export const EXPENSE_TRANSFER_KINDS = [
	"loan_payment",
	"investment_contribution",
] as const satisfies readonly TransferKind[];

const expenseKinds: ReadonlySet<TransferKind> = new Set(EXPENSE_TRANSFER_KINDS);

/**
 * Whether a row is the inflow of a loan payment or an investment
 * contribution, whose category belongs to its outflow, as Sure's
 * `7e1d93613`: the interface shows the outflow's, disabled, and the API
 * refuses one, since a category picked here would look saved but count in
 * no budget.
 */
export function categorySetOnOutflow(
	amount: MinorUnits,
	transfer: { kind: TransferKind } | null,
): boolean {
	return transfer !== null && amount > 0 && expenseKinds.has(transfer.kind);
}

/**
 * Sure's `Transfer#status`: the matcher proposes a transfer `pending`, the
 * owner confirms it or pairs two lines by hand, `confirmed`. Both count the
 * same everywhere; only the list reads it, to offer the proposal.
 */
export const TRANSFER_STATUSES = ["pending", "confirmed"] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
