import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";
import type { TransactionExtra } from "@archant/data/schema/transactions";

import { addDays } from "./dates.ts";

/**
 * One line of a statement, as every source hands it to the ledger (AD-3).
 * Narrowed to the fields stored so far: `originalAmount` arrives with its
 * column, so no source ever sets a field the ledger silently drops.
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
	/**
	 * Not booked by the bank yet (FR51). Only a bank connector sets it: a file
	 * lists booked lines.
	 */
	pending: boolean;
	/**
	 * The merchant the line names, found or created by name when the line is
	 * written (AD-18); `null` or absent when it names none. Only a bank
	 * connector sets it.
	 */
	merchant?: string | null | undefined;
	/**
	 * What the bank sent beside the line, Sure's `extra`; `null` or absent
	 * when nothing. Only a bank connector sets it.
	 */
	extra?: TransactionExtra | null | undefined;
	/**
	 * What the fingerprint hashes instead of `label` (AD-7): a bank line's
	 * label as read before Sure's clean-ups, so a label that changes with the
	 * household's merchants keeps the line's key. Only a bank connector sets it.
	 */
	keyLabel?: string | undefined;
	/**
	 * The category the line is filed under, an id of the household's. Only
	 * the CSV transaction import sets it, from « Attribuez vos catégories ».
	 */
	categoryId?: string | null | undefined;
	/** The line's tags, ids of the household's; only the CSV transaction import sets them. */
	tagIds?: readonly string[] | undefined;
	/**
	 * The lines the line is split into, summing to its amount exactly
	 * (AD-20). Only a QIF import sets them, from a split record.
	 */
	splitLines?: readonly ImportedSplitLine[] | undefined;
};

/** One line of an imported split: its own label, amount, notes, category and tags. */
export type ImportedSplitLine = {
	label: string;
	amount: MinorUnits;
	notes: string | null;
	categoryId: string | null;
	tagIds: readonly string[];
};

/**
 * Why a line was refused. The ledger names the first two; no date before the
 * opening date is among them, since balances start at the oldest entry, as
 * Sure's `Balance::BaseCalculator#calculation_start_date`. A source names the
 * others when a field of the line cannot be read, or, for `OPENING_BALANCE`,
 * when the line is the starting balance a QIF file carries rather than a
 * movement.
 */
export type RejectionCode =
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
const MAX_DAYS_AHEAD = 366;

/** Whether `date` is further ahead of `today` than any entry may be dated. */
export function isTooFarAhead(date: IsoDate, today: IsoDate): boolean {
	return date > addDays(today, MAX_DAYS_AHEAD);
}

export type LineContext = { currency: string; today: IsoDate };

/** Step 1 of the ingestion pipeline (AD-4) for one line; `null` when it may go in. */
export function rejectionFor(
	line: Pick<NormalizedTransaction, "date" | "currency">,
	context: LineContext,
): RejectionCode | null {
	if (isTooFarAhead(line.date, context.today)) {
		return "DATE_TOO_LATE";
	}

	// AD-6: an entry's currency always equals its account's.
	if (line.currency !== context.currency) {
		return "CURRENCY_MISMATCH";
	}

	return null;
}
