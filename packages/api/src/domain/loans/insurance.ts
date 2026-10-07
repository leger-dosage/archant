import type { IsoDate } from "../dates.ts";
import type { AmortizationSchedule } from "./amortization-schedule.ts";

import type { LoanDetails } from "@archant/data/account-types";

import { periodInterest } from "./amortization-math.ts";

export type InsuranceTerms = Pick<LoanDetails, "insuranceRate" | "insuranceRateType"> & {
	/** The amount borrowed, which a level premium is charged on. */
	principal: bigint;
};

type Premium = { number: number; date: IsoDate; amount: bigint };

export type Insurance = {
	/** One per scheduled payment, oldest first. */
	premiums: Premium[];
	total: bigint;
};

/**
 * Sure's `Loan::Insurance`: the borrower's premium, charged beside the
 * instalment, never inside it, so the schedule's rows still agree with the
 * lender's table. A twelfth of the annual rate each month: a level policy on
 * the amount borrowed, any other, decreasing or untyped, on the balance owed
 * when the period opened, the conservative reading that never overstates a
 * policy the borrower has not described. `null` without a rate above zero.
 */
export function insurance(
	schedule: Pick<AmortizationSchedule, "payments">,
	{ insuranceRate, insuranceRateType, principal }: InsuranceTerms,
): Insurance | null {
	if (insuranceRate === null || insuranceRate <= 0) {
		return null;
	}

	let opening = principal;
	const premiums = schedule.payments.map((payment) => {
		const base = insuranceRateType === "level_term" ? principal : opening;
		opening = payment.endingBalance;

		return {
			number: payment.number,
			date: payment.date,
			amount: periodInterest(base, insuranceRate),
		};
	});

	return { premiums, total: premiums.reduce((sum, premium) => sum + premium.amount, 0n) };
}
