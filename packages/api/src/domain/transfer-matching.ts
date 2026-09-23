import type { IsoDate } from "./dates.ts";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import type { EntryKind } from "@archant/data/schema/entries";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { daysBetween } from "./dates.ts";

/**
 * How far apart the two sides of a transfer may be dated, inclusive: a
 * transfer between two banks can take a few working days to land. Not the
 * import's `MATCH_WINDOW_DAYS`, which pairs one line with itself.
 */
export const TRANSFER_WINDOW_DAYS = 4;

/** What the rule reads of each side. */
export type TransferSide = {
	kind: EntryKind;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	/** Already the outflow or the inflow of a transfer. */
	inTransfer: boolean;
};

/**
 * Whether `a` and `b` can be the two sides of one transfer: two transactions
 * of opposite, non-zero amounts in two accounts of one currency, dated within
 * `TRANSFER_WINDOW_DAYS`, neither already matched. Symmetric, so the manual
 * picker and the automatic matcher of Story 5.2 agree whichever side they
 * start from. No conversion: a cross-currency move is two standard rows.
 */
export function isTransferCandidate(a: TransferSide, b: TransferSide): boolean {
	return (
		a.kind === "transaction" &&
		b.kind === "transaction" &&
		a.amount !== 0 &&
		a.amount + b.amount === 0 &&
		a.accountId !== b.accountId &&
		a.currency === b.currency &&
		Math.abs(daysBetween(a.date, b.date)) <= TRANSFER_WINDOW_DAYS &&
		!a.inTransfer &&
		!b.inTransfer
	);
}

/**
 * The kind of a transfer, from the type of the account the money lands in, as
 * Sure's `Transfer#kind_for_account`. Loan and investment accounts arrive with
 * Epic 7 and will add their branches here.
 */
export function transferKindOf(inflowAccountType: AccountType): TransferKind {
	return inflowAccountType === "credit_card" ? "credit_card_payment" : "internal_move";
}
