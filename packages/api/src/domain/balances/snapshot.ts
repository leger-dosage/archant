import type { IsoDate } from "../dates.ts";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/**
 * Why the ledger refused a snapshot. `BEFORE_OPENING_DATE` covers the opening
 * day too: a snapshot there would compete with the opening anchor for that
 * day's balance, and changing the opening balance is another feature.
 */
export type SnapshotRejectionCode = "BEFORE_OPENING_DATE" | "DATE_IN_FUTURE" | "SNAPSHOT_EXISTS";

/**
 * Where a snapshot may be dated: after the opening date and not after today,
 * as Sure's valuation form allows. `null` when the date is fine. Another
 * snapshot on the same date is the ledger's to check, against the database.
 */
export function snapshotRejectionFor(
	date: IsoDate,
	context: { openingDate: IsoDate; today: IsoDate },
): Exclude<SnapshotRejectionCode, "SNAPSHOT_EXISTS"> | null {
	if (date <= context.openingDate) {
		return "BEFORE_OPENING_DATE";
	}

	if (date > context.today) {
		return "DATE_IN_FUTURE";
	}

	return null;
}

export type SnapshotGapInput = {
	/** Stored balance at the end of the day before the snapshot. */
	previous: MinorUnits;
	/** Sum of the signed transaction amounts (AD-5) dated on the snapshot day. */
	movements: MinorUnits;
	/** The snapshot's stored balance. */
	recorded: MinorUnits;
	classification: Classification;
};

/**
 * The balance Archant would have computed for the snapshot day without the
 * snapshot, and how far the recorded one is from it. Mirrors the sign rule of
 * `forwardBalances`, so the gap is exactly what the snapshot corrected.
 */
export function snapshotGap(input: SnapshotGapInput): { computed: MinorUnits; gap: MinorUnits } {
	const sign = input.classification === "asset" ? 1 : -1;
	const computed = input.previous + sign * input.movements;

	return { computed: toMinorUnits(computed), gap: toMinorUnits(input.recorded - computed) };
}
