import type { IsoDate } from "../dates.ts";
import type { AmortizationSchedule } from "./amortization-schedule.ts";
import type { Insurance } from "./insurance.ts";

import type { LoanDetails, LoanRateType } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import { addMonths } from "../dates.ts";
import { roundHalfUp } from "./amortization-math.ts";
import { amortizationSchedule } from "./amortization-schedule.ts";
import { insurance as insuranceOf } from "./insurance.ts";
import { originalBalance } from "./original-balance.ts";
import { rateResolver } from "./rate-resolver.ts";

/** Sure's `Loan::LEVERAGE_BANDS`, inclusive and searched in this order. */
type LeverageBand = "conservative" | "moderate" | "high";

export type Leverage = {
	/** The amount borrowed per unit put down, in tenths: 4,0x is 40. */
	tenths: number;
	band: LeverageBand;
};

type Shares = { principal: number; interest: number; insurance: number };

export type Instalment = {
	number: number;
	date: IsoDate;
	principal: bigint;
	interest: bigint;
	/** Zero without insurance. */
	insurance: bigint;
	total: bigint;
	/** Each part as an integer percent of `total`; zeros for a zero total. */
	shares: Shares;
};

export type LoanOverview = {
	/** Sure's `original_balance`: the amount borrowed, else the opening balance. */
	originalAmount: bigint;
	/** The account's balance: what happened, where the schedule says what was promised. */
	remainingBalance: bigint;
	/** In millionths, the rate in force on the day asked. */
	interestRate: number | null;
	/** `"not_applicable"` once a variable loan's schedule has run out, Sure's « N/A ». */
	monthlyPayment: bigint | "not_applicable" | null;
	termMonths: number | null;
	rateType: LoanRateType | null;
	payoffDate: IsoDate | null;
	/** A premium is charged against a schedule, as Sure's `insurance.present?`. */
	insured: boolean;
	totalCost: bigint | null;
	/** The premiums' total when insured, else the bare rate when one is recorded. */
	insurance: { total: bigint } | { rate: number } | null;
	leverage: Leverage | null;
	repaidPercent: number | null;
	instalment: Instalment | null;
};

/**
 * Sure's `Loan#months_elapsed`: the months fully served since origination. A
 * loan originated on the 15th is one month in on the 15th of the next month,
 * and never further in than its term.
 */
export function monthsElapsed(origination: IsoDate, asOf: IsoDate, termMonths: number): number {
	if (asOf < origination) {
		return 0;
	}

	const calendarMonths =
		Number(asOf.slice(0, 4)) * 12 +
		Number(asOf.slice(5, 7)) -
		(Number(origination.slice(0, 4)) * 12 + Number(origination.slice(5, 7)));
	const served =
		addMonths(origination, calendarMonths) > asOf ? calendarMonths - 1 : calendarMonths;

	return Math.min(Math.max(served, 0), termMonths);
}

/**
 * Sure's `initial_leverage_ratio` and `leverage_band`, in integers: `null`
 * without a down payment, since a loan with none recorded is not infinitely
 * leveraged, only one whose leverage nobody has told us.
 */
export function leverage(originalAmount: bigint, downPayment: bigint | null): Leverage | null {
	if (downPayment === null || downPayment <= 0n || originalAmount <= 0n) {
		return null;
	}

	const band: LeverageBand =
		originalAmount <= 4n * downPayment
			? "conservative"
			: originalAmount <= 8n * downPayment
				? "moderate"
				: "high";

	return { tenths: Number(roundHalfUp(originalAmount * 10n, downPayment)), band };
}

/**
 * Sure's `balance_paid_ratio` as a whole percent: measured against the
 * account's balance rather than the schedule, so an early repayment shows.
 * The balance counts by its size, as Sure's `abs`. `null` when nothing above
 * zero was borrowed, which leaves the ring out.
 */
export function repaidPercent(originalAmount: bigint, balance: bigint): number | null {
	if (originalAmount <= 0n) {
		return null;
	}

	const owed = balance < 0n ? -balance : balance;
	const percent = Number(roundHalfUp(100n * (originalAmount - owed), originalAmount));

	return Math.min(Math.max(percent, 0), 100);
}

const shareOf = (part: bigint, total: bigint) =>
	total > 0n ? Number(roundHalfUp(100n * part, total)) : 0;

/**
 * Sure's `Loan#payment_breakdown`: the instalment after the months fully
 * served, split into what it repays, what it costs and what it insures. A
 * finished loan is on none, and neither is a schedule that rounding cleared
 * before its term.
 */
export function paymentBreakdown(
	schedule: Pick<AmortizationSchedule, "originationDate" | "payments">,
	policy: Pick<Insurance, "premiums"> | null,
	termMonths: number,
	asOf: IsoDate,
): Instalment | null {
	const elapsed = monthsElapsed(schedule.originationDate, asOf, termMonths);
	const payment = elapsed >= termMonths ? undefined : schedule.payments[elapsed];

	if (payment === undefined) {
		return null;
	}

	const premium =
		policy?.premiums.find((candidate) => candidate.number === payment.number)?.amount ?? 0n;
	const total = payment.principal + payment.interest + premium;

	return {
		number: payment.number,
		date: payment.date,
		principal: payment.principal,
		interest: payment.interest,
		insurance: premium,
		total,
		shares: {
			principal: shareOf(payment.principal, total),
			interest: shareOf(payment.interest, total),
			insurance: shareOf(premium, total),
		},
	};
}

export type OverviewInput = {
	details: LoanDetails | null;
	balance: bigint;
	/**
	 * The account's opening anchor, Sure's first valuation: origination when no
	 * start date is recorded, the principal when no amount borrowed is.
	 */
	opening: { date: IsoDate; balance: bigint };
	/** One day for every figure, as Sure's `_overview` passes one `as_of`. */
	asOf: IsoDate;
};

/** A loan whose terms nobody has told: Sure's `Loan` with every column blank. */
const UNKNOWN_TERMS: LoanDetails = {
	originalAmount: null,
	downPayment: null,
	startDate: null,
	termMonths: null,
	rateType: null,
	interestRate: null,
	insuranceRate: null,
	insuranceRateType: null,
	rateChanges: [],
	endDate: null,
};

/**
 * Sure's `loans/tabs/_overview` and `_repayment_progress`, computed on read.
 * The schedule and the premiums are read off `amortizationSchedule` and
 * `insurance`, never re-derived, so the two tabs cannot disagree.
 */
export function loanOverview({ details, balance, opening, asOf }: OverviewInput): LoanOverview {
	const terms = details ?? UNKNOWN_TERMS;
	const originalAmount = originalBalance(terms.originalAmount, opening.balance);
	const downPayment = terms.downPayment === null ? null : BigInt(terms.downPayment);
	const schedule = amortizationSchedule({
		...terms,
		originalAmount: toMinorUnits(Number(originalAmount)),
		originationDate: terms.startDate ?? opening.date,
	});
	const policy =
		schedule === null ? null : insuranceOf(schedule, { ...terms, principal: originalAmount });

	return {
		originalAmount,
		remainingBalance: balance,
		interestRate:
			terms.interestRate === null
				? null
				: rateResolver({
						rateType: terms.rateType ?? "fixed",
						interestRate: terms.interestRate,
						rateChanges: terms.rateChanges,
					}).accrualRateFor(asOf),
		monthlyPayment: monthlyPaymentOf(terms, originalAmount, schedule, asOf),
		termMonths: terms.termMonths,
		rateType: terms.rateType,
		payoffDate: schedule?.payments.at(-1)?.date ?? null,
		insured: policy !== null,
		totalCost: schedule === null ? null : schedule.totalPaid + (policy?.total ?? 0n),
		insurance:
			policy !== null
				? { total: policy.total }
				: terms.insuranceRate !== null && terms.insuranceRate > 0
					? { rate: terms.insuranceRate }
					: null,
		leverage: leverage(originalAmount, downPayment),
		repaidPercent: repaidPercent(originalAmount, balance),
		instalment:
			schedule === null || terms.termMonths === null
				? null
				: paymentBreakdown(schedule, policy, terms.termMonths, asOf),
	};
}

/**
 * Sure's `monthly_payment` and `payment_in_force`. A variable loan has no
 * single payment, so it quotes the one in force: the next on or after the day
 * asked. A fixed loan with nothing above zero borrowed pays zero.
 */
function monthlyPaymentOf(
	{ rateType, interestRate, termMonths }: LoanDetails,
	originalAmount: bigint,
	schedule: AmortizationSchedule | null,
	asOf: IsoDate,
): LoanOverview["monthlyPayment"] {
	if (rateType === null) {
		return null;
	}

	if (rateType === "fixed") {
		if (interestRate === null || termMonths === null) {
			return null;
		}

		return originalAmount <= 0n ? 0n : (schedule?.periodicPayment ?? null);
	}

	return schedule?.payments.find((payment) => payment.date >= asOf)?.payment ?? "not_applicable";
}
