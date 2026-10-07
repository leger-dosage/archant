import type { IsoDate } from "../dates.ts";

import type { LoanDetails } from "@archant/data/account-types";
import { MAX_LOAN_TERM_MONTHS } from "@archant/data/account-types";

import { addMonths } from "../dates.ts";
import { rateResolver } from "./rate-resolver.ts";
import { simulate } from "./simulator.ts";

/** What a schedule is computed from: a loan's terms and the day it started. */
export type ScheduleTerms = Pick<
	LoanDetails,
	"originalAmount" | "termMonths" | "rateType" | "interestRate" | "rateChanges"
> & {
	/** The start date, else the account's opening date; `null` when neither is known. */
	originationDate: IsoDate | null;
};

type SchedulePayment = {
	number: number;
	date: IsoDate;
	payment: bigint;
	principal: bigint;
	interest: bigint;
	endingBalance: bigint;
};

export type AmortizationSchedule = {
	originationDate: IsoDate;
	/** Oldest first; shorter than the term when rounding clears the balance early. */
	payments: SchedulePayment[];
	/**
	 * Whether the payment is re-sized after the first, so that no single
	 * figure is « the » monthly payment. Asked of the run rather than of the
	 * recorded changes: a change to the same rate, or one effective on the
	 * first payment, moves nothing in-term.
	 */
	reAmortising: boolean;
	/** The first payment, which a change effective on its date already sizes. */
	periodicPayment: bigint;
	totalInterest: bigint;
	/** Every payment: the amount borrowed plus `totalInterest`. */
	totalPaid: bigint;
};

/**
 * Sure's `Loan::AmortizationSchedule`: the constant-payment (« French »)
 * schedule of a loan, payment n falling n months after origination, clamped to
 * the month's end as Ruby's `>>`. `null` when the loan is not amortizable, as
 * Sure's `amortizable?`: no amount borrowed above zero, no rate type, no rate,
 * no term within the simulator's 1 200 periods, or no origination date. The
 * principal is Sure's `original_balance`, which `originalBalance` resolves
 * for the caller, and the down payment is not subtracted.
 */
export function amortizationSchedule(terms: ScheduleTerms): AmortizationSchedule | null {
	const { originalAmount, termMonths, rateType, interestRate, rateChanges, originationDate } =
		terms;

	if (
		originalAmount === null ||
		termMonths === null ||
		rateType === null ||
		interestRate === null ||
		originationDate === null ||
		termMonths < 1 ||
		termMonths > MAX_LOAN_TERM_MONTHS
	) {
		return null;
	}

	const resolver = rateResolver({ rateType, interestRate, rateChanges });
	const { payments, totalInterest } = simulate({
		startingBalance: BigInt(originalAmount),
		accrualStartDate: originationDate,
		paymentSchedule: Array.from({ length: termMonths }, (_, index) =>
			addMonths(originationDate, index + 1),
		),
		accrualRateFor: resolver.accrualRateFor,
		reAmortisationEvents: resolver.reAmortisationEvents,
	});
	const [first] = payments;

	// A balance of zero or less walks no period: nothing to amortise.
	if (first === undefined) {
		return null;
	}

	return {
		originationDate,
		payments: payments.map(({ number, date, payment, principal, interest, endingBalance }) => ({
			number,
			date,
			payment,
			principal,
			interest,
			endingBalance,
		})),
		reAmortising: new Set(payments.map((row) => row.sizingRate)).size > 1,
		periodicPayment: first.payment,
		totalInterest,
		totalPaid: payments.reduce((sum, row) => sum + row.payment, 0n),
	};
}
