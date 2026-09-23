import type { MinorUnits } from "@archant/data/money";

/** The transfer chip's dot, as in `key-transactions.html`: no category has it. */
export const TRANSFER_COLOR = "#7A5AF8";

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
