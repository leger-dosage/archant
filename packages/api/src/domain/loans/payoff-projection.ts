import type { IsoDate } from "../dates.ts";
import type { AmortizationSchedule } from "./amortization-schedule.ts";
import type { RateResolver } from "./rate-resolver.ts";

import { simulate } from "./simulator.ts";

type ProjectedPayment = { date: IsoDate; endingBalance: bigint };

/**
 * Where today's balance leads. A run that clears it before the contract's
 * maturity converges, with the months and the interest it saves; one that does
 * not names what the contract's payments leave owed at maturity, Sure's
 * `balloon_amount`, and has no payoff date.
 */
export type PayoffProjection =
	| {
			converged: true;
			payments: ProjectedPayment[];
			payoffDate: IsoDate;
			/** The contract's remaining payments the run did not need: zero or more. */
			monthsSaved: number;
			/** The contract's remaining interest less the run's. */
			interestSaved: bigint;
	  }
	| { converged: false; payments: ProjectedPayment[]; balloon: bigint };

export type ProjectionInput = {
	schedule: Pick<AmortizationSchedule, "originationDate" | "payments">;
	rates: RateResolver;
	/** What the account owes today (AD-5). */
	balance: bigint;
	asOf: IsoDate;
};

/**
 * Sure's `Loan::PayoffProjection`: the contract's own payment, row by row,
 * against today's balance rather than the contracted one. Re-sizing it to the
 * balance would land a borrower who repaid early back on the original
 * maturity; paying what the contract asks against a smaller balance is how he
 * finishes sooner. It walks the contract's remaining dates and no further, an
 * extension being a term nobody agreed to, and never settles a balance left
 * at maturity, which would invent a payoff date.
 *
 * `null` when there is nothing to project, as Sure's `applicable?`: nothing
 * owed, no payment left, or a contract payment of zero.
 */
export function payoffProjection({
	schedule,
	rates,
	balance,
	asOf,
}: ProjectionInput): PayoffProjection | null {
	const remaining = schedule.payments.filter((payment) => payment.date > asOf);
	const [next] = remaining;

	if (balance <= 0n || next === undefined || next.payment <= 0n) {
		return null;
	}

	// The period in force opened on the last payment, as the schedule charges
	// it: opened today, a rate change recorded since that payment would re-rate
	// a month the contract charges at the old rate.
	const periodStart =
		schedule.payments.findLast((payment) => payment.date <= asOf)?.date ?? schedule.originationDate;
	const run = simulate({
		startingBalance: balance,
		accrualStartDate: periodStart,
		paymentSchedule: remaining.map((payment) => payment.date),
		accrualRateFor: rates.accrualRateFor,
		reAmortisationEvents: rates.reAmortisationEvents,
		// Both walks share their dates, so row `index` of the run is row `index`
		// here, which always exists, and the payment moves exactly where the
		// schedule's does.
		strategy: { kind: "scheduled", payment: ({ index }) => remaining[index]!.payment },
		settleAtScheduleEnd: false,
	});
	const payments = run.payments.map(({ date, endingBalance }) => ({ date, endingBalance }));

	if (!run.converged) {
		return { converged: false, payments, balloon: run.balloonAmount };
	}

	const contractInterest = remaining.reduce((sum, payment) => sum + payment.interest, 0n);

	return {
		converged: true,
		payments,
		// A positive balance walks at least one period, so a converged run has a last payment.
		payoffDate: payments.at(-1)!.date,
		monthsSaved: remaining.length - payments.length,
		interestSaved: contractInterest - run.totalInterest,
	};
}
