import type { IsoDate } from "../dates.ts";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/**
 * Why the ledger refused a snapshot: dated after today, or onto a day another
 * snapshot holds.
 */
export type SnapshotRejectionCode = "DATE_IN_FUTURE" | "SNAPSHOT_EXISTS";

/**
 * Where a snapshot may be dated: any day up to today, as Sure's valuation form
 * allows, before the opening date included, where it is a reconciliation the
 * balances start from as Sure's `calculation_start_date`. `null` when the date
 * is fine. `OPENING_DATE` names the day the opening anchor holds: a new
 * snapshot there sets the anchor's amount, as Sure's `ReconciliationManager`
 * updates the valuation already on its date. Another snapshot on the same date
 * is the ledger's to check, against the database.
 */
export function snapshotRejectionFor(
	date: IsoDate,
	context: { openingDate: IsoDate; today: IsoDate },
): Exclude<SnapshotRejectionCode, "SNAPSHOT_EXISTS"> | "OPENING_DATE" | null {
	if (date > context.today) {
		return "DATE_IN_FUTURE";
	}

	return date === context.openingDate ? "OPENING_DATE" : null;
}

export type SnapshotGapInput = {
	/** Stored cash at the end of the day before the snapshot. */
	previousCash: MinorUnits;
	/** Sum of the signed transaction amounts (AD-5) dated on the snapshot day. */
	movements: MinorUnits;
	/** As `ForwardInput`'s: false, the day's movements count for nothing. */
	transactionsMoveBalance: boolean;
	/** What the account's holdings are worth on the snapshot day; zero without any. */
	holdingsValue: MinorUnits;
	/** The snapshot's stored balance. */
	recorded: MinorUnits;
	classification: Classification;
};

/**
 * The balance Archant would have computed for the snapshot day without the
 * snapshot, and how far the recorded one is from it. Mirrors `forwardBalances`,
 * the day's cash plus its holdings, so the gap is exactly what the snapshot
 * corrected.
 */
export function snapshotGap(input: SnapshotGapInput): { computed: MinorUnits; gap: MinorUnits } {
	const sign = input.classification === "asset" ? 1 : -1;
	const movements = input.transactionsMoveBalance ? input.movements : 0;
	const computed = input.previousCash + sign * movements + input.holdingsValue;

	return { computed: toMinorUnits(computed), gap: toMinorUnits(input.recorded - computed) };
}

export type SnapshotGapBackwardInput = {
	/** Stored balance at the end of the day after the snapshot. */
	next: MinorUnits;
	/** Sum of the signed transaction amounts dated on the day after the snapshot. */
	nextMovements: MinorUnits;
	/** The snapshot's stored balance. */
	recorded: MinorUnits;
	classification: Classification;
};

/**
 * `snapshotGap` for a day a bank-linked account derives backward: the
 * balance `reverseBalances` would give it without the snapshot, the next
 * day's less that day's movements.
 */
export function snapshotGapBackward(input: SnapshotGapBackwardInput): {
	computed: MinorUnits;
	gap: MinorUnits;
} {
	const sign = input.classification === "asset" ? 1 : -1;
	const computed = input.next - sign * input.nextMovements;

	return { computed: toMinorUnits(computed), gap: toMinorUnits(input.recorded - computed) };
}
