import type { IsoDate } from "../dates.ts";

import { MAX_LOAN_TERM_MONTHS } from "@archant/data/account-types";

import { levelPayment, periodInterest, step } from "./amortization-math.ts";

/** A date on which the contracted repayment is re-sized, and the rate it is sized at. */
export type RateEvent = { date: IsoDate; rate: number };

/** What a `scheduled` payment is asked with, once per period walked. */
type ScheduledPeriod = {
	index: number;
	balance: bigint;
	/** Annual, in millionths: the rate in force on the payment date. */
	sizingRate: number;
	remainingPayments: number;
};

/**
 * Sure's `PAYMENT_STRATEGIES` with a caller. `reamortize` sizes the payment
 * from the balance in front of it and re-sizes it whenever the sizing rate
 * moves, what a lender does to a contracted schedule. `scheduled` asks
 * `payment` every period, whatever the balance: a projection pays the
 * contract's repayment against a balance that is no longer the contracted
 * one, so a borrower who is ahead finishes early instead of being re-sized
 * onto the original maturity. Sure's `hold`, and a seed for `reamortize`,
 * have no caller and are not ported.
 */
type PaymentStrategy =
	| { kind: "reamortize" }
	| { kind: "scheduled"; payment: (period: ScheduledPeriod) => bigint };

export type SimulatorInput = {
	startingBalance: bigint;
	/** Where the first period opens. */
	accrualStartDate: IsoDate;
	/** One payment date per period, oldest first. */
	paymentSchedule: readonly IsoDate[];
	/** The annual rate in force on a date, in millionths. */
	accrualRateFor: (date: IsoDate) => number;
	/** The re-sizing events within [from, to], both inclusive; none when omitted. */
	reAmortisationEvents?: (from: IsoDate, to: IsoDate) => readonly RateEvent[];
	/** `reamortize` when omitted. */
	strategy?: PaymentStrategy;
	/** Whether the last scheduled payment settles the balance; `true` when omitted. */
	settleAtScheduleEnd?: boolean;
};

type SimulatedPayment = {
	number: number;
	date: IsoDate;
	/** The rate the interest was charged at: the one in force when the period opened. */
	interestRate: number;
	/** The rate the payment was sized at: the one in force on its date. */
	sizingRate: number;
	payment: bigint;
	principal: bigint;
	interest: bigint;
	beginningBalance: bigint;
	endingBalance: bigint;
};

/** Sure's `SimulationResult`. */
export type SimulationResult = {
	payments: SimulatedPayment[];
	/** Whether the run cleared the balance. */
	converged: boolean;
	/** What the run left owed: zero once converged. */
	balloonAmount: bigint;
	totalInterest: bigint;
};

const byDate = (a: RateEvent, b: RateEvent) => a.date.localeCompare(b.date);

/**
 * Sure's `Loan::Simulator`: walks a payment schedule, charging interest and
 * applying payments. Accrual is monthly, one charge per period on the balance
 * it opened with, at the rate in force when it opened; the payment is sized
 * at the rate in force on its date. Reading one rate for both would bill the
 * month ending on a rate change at a rate that applied for none of its days.
 *
 * Refuses an empty schedule, and one longer than 1 200 periods rather than
 * truncating it: totals for the first 1 200 of a longer schedule describe a
 * loan nobody asked for.
 */
export function simulate({
	startingBalance,
	accrualStartDate,
	paymentSchedule,
	accrualRateFor,
	reAmortisationEvents,
	strategy = { kind: "reamortize" },
	settleAtScheduleEnd = true,
}: SimulatorInput): SimulationResult {
	const first = paymentSchedule[0];
	const last = paymentSchedule.at(-1);

	if (first === undefined || last === undefined) {
		throw new RangeError("The payment schedule must not be empty.");
	}

	if (paymentSchedule.length > MAX_LOAN_TERM_MONTHS) {
		throw new RangeError(
			`The payment schedule has ${paymentSchedule.length} periods (${first} to ${last}), more than the ${MAX_LOAN_TERM_MONTHS} allowed.`,
		);
	}

	// Latest first, so the first match is the event in force.
	const events = (reAmortisationEvents?.(first, last) ?? []).toSorted(byDate).toReversed();
	const rateOn = (date: IsoDate) =>
		events.find((event) => event.date <= date)?.rate ?? accrualRateFor(date);

	const payments: SimulatedPayment[] = [];
	let balance = startingBalance;
	let payment: bigint | undefined;
	let previousSizingRate: number | undefined;

	for (const [index, date] of paymentSchedule.entries()) {
		if (balance <= 0n) {
			break;
		}

		const periodStart = payments.at(-1)?.date ?? accrualStartDate;
		const accrualRate = accrualRateFor(periodStart);
		const sizingRate = rateOn(date);
		const remainingPayments = paymentSchedule.length - index;
		const interest = periodInterest(balance, accrualRate);

		if (strategy.kind === "scheduled") {
			payment = strategy.payment({ index, balance, sizingRate, remainingPayments });
		} else if (payment === undefined || sizingRate !== previousSizingRate) {
			// Re-sized only when the sizing rate moves: the first period has no
			// earlier rate to have moved away from.
			payment = levelPayment({
				balance,
				rate: sizingRate,
				remainingPayments,
				...(sizingRate === accrualRate ? {} : { firstPeriodInterest: interest }),
			});
		}

		previousSizingRate = sizingRate;

		const split = step({
			balance,
			payment,
			rate: accrualRate,
			final: (settleAtScheduleEnd && remainingPayments === 1) || payment >= balance + interest,
			interest,
		});

		payments.push({
			number: index + 1,
			date,
			interestRate: accrualRate,
			sizingRate,
			...split,
		});
		balance = split.endingBalance;
	}

	return {
		payments,
		converged: balance === 0n,
		balloonAmount: balance,
		totalInterest: payments.reduce((sum, row) => sum + row.interest, 0n),
	};
}
