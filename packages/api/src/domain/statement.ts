import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { addDays } from "./dates.ts";

/**
 * One line of a statement, as every source hands it to the ledger (AD-3).
 * Narrowed to the fields stored so far: `originalAmount` and `pending` arrive
 * with Epic 10, together with their columns, so no source ever sets a field
 * the ledger silently drops.
 */
export type NormalizedTransaction = {
	/** The source's own id for the line, OFX `FITID`; `null` when it has none. */
	externalId: string | null;
	date: IsoDate;
	/** Booked on the account, in the account currency, signed per AD-5. */
	amount: MinorUnits;
	currency: string;
	label: string;
	/** A cheque or QIF `N` number the bank printed; `null` when it has none. */
	reference: string | null;
	notes: string | null;
};

/**
 * Why a line was refused. The ledger names the first three: `BEFORE_OPENING_DATE`
 * covers the opening day too, since the opening balance is that day's
 * end-of-day balance, as in Sure. A source names the others when a field of
 * the line cannot be read, or, for `OPENING_BALANCE`, when the line is the
 * starting balance a QIF file carries rather than a movement.
 */
export type RejectionCode =
	| "BEFORE_OPENING_DATE"
	| "DATE_TOO_LATE"
	| "CURRENCY_MISMATCH"
	| "INVALID_DATE"
	| "INVALID_AMOUNT"
	| "MISSING_LABEL"
	| "OPENING_BALANCE";

/**
 * The balance a statement closes on, signed as the bank prints it (AD-5): a
 * card's debt is negative. Only `toStoredBalance` turns it into a stored
 * balance.
 */
export type StatementBalance = { amount: MinorUnits; currency: string; date: IsoDate };

/**
 * What every source produces (AD-3). `rejected` holds the lines the source
 * could not read, `ref` being the line's position in the source; the file
 * stays valid. `balance` is `null` when the source gives none, or none it
 * can read.
 */
export type ParsedStatement = {
	transactions: NormalizedTransaction[];
	balance: StatementBalance | null;
	rejected: { ref: string; reason: RejectionCode }[];
};

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
