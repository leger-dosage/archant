import type { MinorUnits } from "@archant/data/money";
import type { TransferKind } from "@archant/data/transfer-kinds";
import { EXPENSE_TRANSFER_KINDS } from "@archant/data/transfer-kinds";

/** DESIGN.md's `transfer` colour, also `--transfer` in styles.css. */
export const TRANSFER_COLOR = "#5e6ad2";

type TransferSide = {
	amount: MinorUnits;
	transfer: { counterpartAccountName: string } | null;
};

/**
 * « Vers {compte} » on the outflow, « Depuis {compte} » on the inflow, as in
 * Sure; `null` for a standard transaction. The outflow is the negative side,
 * on a card as on a checking account.
 */
export function transferCaption(
	transaction: TransferSide,
): { key: "transactions.transfer.to" | "transactions.transfer.from"; account: string } | null {
	if (transaction.transfer === null) {
		return null;
	}

	return {
		key: transaction.amount < 0 ? "transactions.transfer.to" : "transactions.transfer.from",
		account: transaction.transfer.counterpartAccountName,
	};
}

const expenseKinds: ReadonlySet<TransferKind> = new Set(EXPENSE_TRANSFER_KINDS);

/**
 * Whether a row shows, and lets the user change, its category: not a transfer
 * side, or a spent one, the outflow of a loan payment or an investment
 * contribution. The dashboard counts that outflow in its category (`direction`
 * in the API), so the list shows what it counts; recurring detection groups it
 * too. Sure lets a loan payment keep a category as well (`Transfer#categorizable?`).
 */
export function showsCategory(
	amount: MinorUnits,
	transfer: { kind: TransferKind } | null,
): boolean {
	return transfer === null || (amount < 0 && expenseKinds.has(transfer.kind));
}
