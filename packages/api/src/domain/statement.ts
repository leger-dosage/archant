import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { addDays } from "./dates.ts";

/**
 * One line of a statement, as every source hands it to the ledger (AD-3).
 * Narrowed to the fields this story stores: Epic 2 adds `externalId`,
 * `originalAmount`, `reference` and `pending` together with their columns, so
 * no source ever sets a field the ledger silently drops.
 */
export type NormalizedTransaction = {
	date: IsoDate;
	/** Booked on the account, in the account currency, signed per AD-5. */
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
};

/**
 * Why the ledger refused a line. `BEFORE_OPENING_DATE` covers the opening day
 * too: the opening balance is that day's end-of-day balance, as in Sure.
 */
export type RejectionCode = "BEFORE_OPENING_DATE" | "DATE_TOO_LATE" | "CURRENCY_MISMATCH";

/** Epic 2 adds the statement balance and the source's own rejections. */
export type ParsedStatement = { transactions: NormalizedTransaction[] };

/**
 * How far ahead a line may be dated. Every day up to the latest entry gets a
 * balance row, written under the write lock: a year typo such as 2062 would
 * otherwise write tens of thousands of rows in one transaction.
 */
export const MAX_DAYS_AHEAD = 366;

export type LineContext = { openingDate: IsoDate; currency: string; today: IsoDate };

/** Step 1 of the ingestion pipeline (AD-4) for one line; `null` when it may go in. */
export function rejectionFor(
	line: Pick<NormalizedTransaction, "date" | "currency">,
	context: LineContext,
): RejectionCode | null {
	if (line.date <= context.openingDate) {
		return "BEFORE_OPENING_DATE";
	}

	if (line.date > addDays(context.today, MAX_DAYS_AHEAD)) {
		return "DATE_TOO_LATE";
	}

	// AD-6: an entry's currency always equals its account's.
	if (line.currency !== context.currency) {
		return "CURRENCY_MISMATCH";
	}

	return null;
}
