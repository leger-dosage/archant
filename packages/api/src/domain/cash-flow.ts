import type { MinorUnits } from "@archant/data/money";
import type { TransferKind } from "@archant/data/transfer-kinds";
import { EXPENSE_TRANSFER_KINDS } from "@archant/data/transfer-kinds";

export const DIRECTIONS = ["income", "expense", "transfer"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** What `direction` reads of a transaction; anything else it carries is ignored. */
export type CashFlowTransaction = {
	/** Signed from the account's point of view: negative leaves the account. */
	amount: MinorUnits;
	transfer: { kind: TransferKind } | null;
};

const expenseKinds: ReadonlySet<TransferKind> = new Set(EXPENSE_TRANSFER_KINDS);

/**
 * Income, expense or transfer, the one rule the list's filter and the future
 * dashboard share; `ledger.ts` holds its SQL twin, tied by a parity test. A
 * side of a transfer is a transfer, except the outflow of a loan payment or an
 * investment contribution: that money is spent. The outflow is the negative
 * side, on assets and liabilities alike. Exclusion and account settings leave
 * the direction alone; they decide whether a row counts, not which way it goes.
 */
export function direction(tx: CashFlowTransaction): Direction {
	const spentOutflow = tx.transfer !== null && tx.amount < 0 && expenseKinds.has(tx.transfer.kind);

	if (tx.transfer !== null && !spentOutflow) {
		return "transfer";
	}

	return tx.amount > 0 ? "income" : "expense";
}
