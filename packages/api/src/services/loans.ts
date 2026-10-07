import type { IsoDate } from "../domain/dates.ts";
import type { Instalment, LoanOverview } from "../domain/loans/overview.ts";
import type { ServiceDeps } from "./deps.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { today } from "../domain/dates.ts";
import { amortizationSchedule } from "../domain/loans/amortization-schedule.ts";
import { loanOverview as overviewOf } from "../domain/loans/overview.ts";
import { getAccount } from "./accounts.ts";

type LoanSchedulePayment = {
	number: number;
	date: IsoDate;
	payment: MinorUnits;
	principal: MinorUnits;
	interest: MinorUnits;
	endingBalance: MinorUnits;
};

/** Sure's `loans/tabs/_schedule`, amounts in minor units of the account's currency. */
export type LoanScheduleData = {
	/** Today in `APP_TIMEZONE`: a payment on or before it is past. */
	asOf: IsoDate;
	currency: string;
	originationDate: IsoDate;
	/** A variable or adjustable rate, which the tab warns about. */
	variable: boolean;
	reAmortising: boolean;
	periodicPayment: MinorUnits;
	totalInterest: MinorUnits;
	totalPaid: MinorUnits;
	payments: LoanSchedulePayment[];
};

const minor = (value: bigint) => toMinorUnits(Number(value));

/**
 * A loan's amortisation schedule, computed on read from its terms: nothing
 * is stored. `null` for another type of account, or a loan that cannot be
 * amortised, as Sure's `amortizable?` hides the tab; its origination is the
 * start date, else the account's opening date, as Sure's `origination_date`.
 */
export async function loanSchedule(
	deps: ServiceDeps,
	accountId: string,
): Promise<LoanScheduleData | null> {
	const account = await getAccount(deps, accountId);
	const { details } = account;

	if (account.type !== "loan" || details === null) {
		return null;
	}

	const schedule = amortizationSchedule({
		...details,
		originationDate: details.startDate ?? account.openingDate,
	});

	if (schedule === null) {
		return null;
	}

	return {
		asOf: today(deps.timeZone),
		currency: account.currency,
		originationDate: schedule.originationDate,
		variable: details.rateType !== "fixed",
		reAmortising: schedule.reAmortising,
		periodicPayment: minor(schedule.periodicPayment),
		totalInterest: minor(schedule.totalInterest),
		totalPaid: minor(schedule.totalPaid),
		payments: schedule.payments.map((row) => ({
			number: row.number,
			date: row.date,
			payment: minor(row.payment),
			principal: minor(row.principal),
			interest: minor(row.interest),
			endingBalance: minor(row.endingBalance),
		})),
	};
}

type LoanInstalment = Omit<Instalment, "principal" | "interest" | "insurance" | "total"> & {
	principal: MinorUnits;
	interest: MinorUnits;
	insurance: MinorUnits;
	total: MinorUnits;
};

/**
 * Sure's `loans/tabs/_overview` and `_repayment_progress`, amounts in minor
 * units of the account's currency; a figure that cannot be computed is `null`.
 */
export type LoanOverviewData = Pick<
	LoanOverview,
	| "interestRate"
	| "termMonths"
	| "rateType"
	| "payoffDate"
	| "insured"
	| "leverage"
	| "repaidPercent"
> & {
	/** Today in `APP_TIMEZONE`, the one day every figure answers for. */
	asOf: IsoDate;
	currency: string;
	originalAmount: MinorUnits | null;
	remainingBalance: MinorUnits;
	monthlyPayment: MinorUnits | "not_applicable" | null;
	totalCost: MinorUnits | null;
	insurance: { total: MinorUnits } | { rate: number } | null;
	instalment: LoanInstalment | null;
};

const minorOrNull = (value: bigint | null) => (value === null ? null : minor(value));

/**
 * A loan's overview, computed on read from its terms and its balance: nothing
 * is stored. `null` for another type of account; a loan without details
 * answers every figure it cannot know as `null`.
 */
export async function loanOverview(
	deps: ServiceDeps,
	accountId: string,
): Promise<LoanOverviewData | null> {
	const account = await getAccount(deps, accountId);

	if (account.type !== "loan") {
		return null;
	}

	const asOf = today(deps.timeZone);
	const overview = overviewOf({
		details: account.details,
		balance: BigInt(account.balance),
		openingDate: account.openingDate,
		asOf,
	});
	const { instalment, insurance, monthlyPayment } = overview;

	return {
		asOf,
		currency: account.currency,
		originalAmount: minorOrNull(overview.originalAmount),
		remainingBalance: minor(overview.remainingBalance),
		interestRate: overview.interestRate,
		monthlyPayment: typeof monthlyPayment === "bigint" ? minor(monthlyPayment) : monthlyPayment,
		termMonths: overview.termMonths,
		rateType: overview.rateType,
		payoffDate: overview.payoffDate,
		insured: overview.insured,
		totalCost: minorOrNull(overview.totalCost),
		insurance:
			insurance !== null && "total" in insurance ? { total: minor(insurance.total) } : insurance,
		leverage: overview.leverage,
		repaidPercent: overview.repaidPercent,
		instalment:
			instalment === null
				? null
				: {
						...instalment,
						principal: minor(instalment.principal),
						interest: minor(instalment.interest),
						insurance: minor(instalment.insurance),
						total: minor(instalment.total),
					},
	};
}
