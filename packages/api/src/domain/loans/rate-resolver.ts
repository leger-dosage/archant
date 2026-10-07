import type { IsoDate } from "../dates.ts";
import type { RateEvent } from "./simulator.ts";

import type { LoanRateChange, LoanRateType } from "@archant/data/account-types";

export type RateTerms = {
	rateType: LoanRateType;
	/** Annual, in millionths: the rate the loan was written at. */
	interestRate: number;
	/** Sorted by date, one row per date, kept whatever the rate type. */
	rateChanges: readonly LoanRateChange[];
};

export type RateResolver = {
	/** The rate in force on `date`. */
	accrualRateFor: (date: IsoDate) => number;
	/** The recorded changes within [from, to], both inclusive. */
	reAmortisationEvents: (from: IsoDate, to: IsoDate) => RateEvent[];
};

/**
 * Sure's `Loan::RateResolver`: what rate applies, asked two ways because a
 * rate change moves two things on different days. `accrualRateFor` charges a
 * period from the date it opens; `reAmortisationEvents` re-sizes the payment
 * on its date. A fixed loan answers its rate for every date and ignores the
 * changes it keeps, as Sure's `variable_rate_type?`.
 */
export function rateResolver({ rateType, interestRate, rateChanges }: RateTerms): RateResolver {
	if (rateType === "fixed") {
		return { accrualRateFor: () => interestRate, reAmortisationEvents: () => [] };
	}

	const latestFirst = rateChanges.toReversed();

	return {
		accrualRateFor: (date) =>
			latestFirst.find((change) => change.effectiveDate <= date)?.rate ?? interestRate,
		reAmortisationEvents: (from, to) =>
			rateChanges
				.filter((change) => change.effectiveDate >= from && change.effectiveDate <= to)
				.map((change) => ({ date: change.effectiveDate, rate: change.rate })),
	};
}
