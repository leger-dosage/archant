import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange } from "../domain/balances/history.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { AmortizationSchedule } from "../domain/loans/amortization-schedule.ts";
import type { Instalment, LoanOverview } from "../domain/loans/overview.ts";
import type { PayoffProjection } from "../domain/loans/payoff-projection.ts";
import type { RateResolver } from "../domain/loans/rate-resolver.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { AccountDetail } from "./accounts.ts";
import type { ServiceDeps } from "./deps.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { balanceChange, sampleSeries } from "../domain/balances/history.ts";
import { minDate, today } from "../domain/dates.ts";
import { amortizationSchedule } from "../domain/loans/amortization-schedule.ts";
import { originalBalance } from "../domain/loans/original-balance.ts";
import { loanOverview as overviewOf } from "../domain/loans/overview.ts";
import {
	chartDomain,
	payoffChartSeries,
	projectedSeries,
	scheduledSeries,
} from "../domain/loans/payoff-chart.ts";
import { payoffProjection } from "../domain/loans/payoff-projection.ts";
import { rateResolver } from "../domain/loans/rate-resolver.ts";
import { getAccount } from "./accounts.ts";
import { PERIOD_MONTHS } from "./balances.ts";
import { balancesBetween, openingAnchorOf } from "./ledger/balances.ts";

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
	/** Where today's balance leads, Sure's « Forecasted Payoff Date ». */
	projectedPayoff: ProjectedPayoff;
};

/**
 * The projection's payoff date; `not_converged` when the contract's payments
 * no longer clear the balance by maturity, `not_applicable` with nothing to
 * project.
 */
type ProjectedPayoff =
	| { status: "paid_off"; date: IsoDate }
	| { status: "not_converged" }
	| { status: "not_applicable" };

const minor = (value: bigint) => toMinorUnits(Number(value));

type Contract = {
	schedule: AmortizationSchedule;
	/** A variable or adjustable rate, which the schedule warns about. */
	variable: boolean;
	rates: RateResolver;
	originalAmount: bigint;
};

type Opening = { date: IsoDate; balance: bigint };

/**
 * The account's opening anchor, Sure's first valuation: a loan's origination
 * without a start date, and its principal without an amount borrowed.
 */
async function openingOf(deps: ServiceDeps, accountId: string): Promise<Opening> {
	// `getAccount` already refused an account without one.
	const anchor = (await openingAnchorOf(deps, accountId))!;

	return { date: anchor.date, balance: BigInt(anchor.balance) };
}

/**
 * A loan's schedule, the rates it runs on and its principal; `null` for
 * another type of account, or a loan that cannot be amortised, as Sure's
 * `amortizable?`. The principal is Sure's `original_balance`, the amount
 * borrowed else the opening balance; origination is the start date, else the
 * opening date, as Sure's `origination_date`.
 */
function contractOf(account: AccountDetail, opening: Opening): Contract | null {
	const { details } = account;

	if (account.type !== "loan" || details === null) {
		return null;
	}

	const { rateType, interestRate, rateChanges } = details;
	const originalAmount = originalBalance(details.originalAmount, opening.balance);
	const schedule = amortizationSchedule({
		...details,
		originalAmount: toMinorUnits(Number(originalAmount)),
		originationDate: details.startDate ?? opening.date,
	});

	// `amortizationSchedule` has none without these; asked again for their types.
	if (schedule === null || rateType === null || interestRate === null) {
		return null;
	}

	return {
		schedule,
		variable: rateType !== "fixed",
		rates: rateResolver({ rateType, interestRate, rateChanges }),
		originalAmount,
	};
}

/** Sure's `Loan::PayoffProjection` for today's balance (AD-5). */
function projectionOf({ schedule, rates }: Contract, balance: MinorUnits, asOf: IsoDate) {
	return payoffProjection({ schedule, rates, balance: BigInt(balance), asOf });
}

function projectedPayoffOf(projection: PayoffProjection | null): ProjectedPayoff {
	if (projection === null) {
		return { status: "not_applicable" };
	}

	return projection.converged
		? { status: "paid_off", date: projection.payoffDate }
		: { status: "not_converged" };
}

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
	const contract =
		account.type === "loan" ? contractOf(account, await openingOf(deps, accountId)) : null;

	if (contract === null) {
		return null;
	}

	const { schedule } = contract;
	const asOf = today(deps.timeZone);

	return {
		asOf,
		currency: account.currency,
		originationDate: schedule.originationDate,
		variable: contract.variable,
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
		projectedPayoff: projectedPayoffOf(projectionOf(contract, account.balance, asOf)),
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
	/** Sure's `original_balance`: the amount borrowed, else the opening balance. */
	originalAmount: MinorUnits;
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
 * answers every figure it cannot know as `null`, and measures what it
 * borrowed by its opening balance.
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
		opening: await openingOf(deps, accountId),
		asOf,
	});
	const { instalment, insurance, monthlyPayment } = overview;

	return {
		asOf,
		currency: account.currency,
		originalAmount: minor(overview.originalAmount),
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

/** Sure's `Loan::PayoffChart` payload, amounts in minor units of the account's currency. */
export type LoanPayoffChartData = {
	/** Today in `APP_TIMEZONE`, where the « Aujourd'hui » marker stands. */
	asOf: IsoDate;
	currency: string;
	period: BalancePeriod;
	/** The dates the chart spans. */
	from: IsoDate;
	to: IsoDate;
	/** What the account owes today, where the projection starts. */
	balance: MinorUnits;
	/**
	 * Today's balance against the amount borrowed, Sure's change line « since
	 * the loan started », whatever the period.
	 */
	change: BalanceChange;
	/** The recorded balances, thinned as the account chart's `sampleSeries`. */
	actual: DailyBalance[];
	scheduled: DailyBalance[];
	projected: DailyBalance[];
	/** The series that draw a line between `from` and `to`, in the legend's order. */
	visible: ("actual" | "scheduled" | "projected")[];
	scheduledPayoffDate: IsoDate;
	projectedPayoff: ProjectedPayoff;
	/** Both `null` unless the projection converges. */
	monthsSaved: number | null;
	interestSaved: MinorUnits | null;
	/** What the contract's payments leave owed at maturity; `null` unless the projection runs short. */
	balloon: MinorUnits | null;
};

/**
 * A loan's chart, as Sure's `Loan::PayoffChart`: the recorded balance, the
 * contract and the projection from today, over the account chart's period
 * clamped to the loan's life; computed on read, nothing stored. `null` for
 * another type of account or a loan without a schedule, whose page keeps the
 * balance chart. Recorded balances are never read past today: carried
 * forward, they would draw a balance that never moves again.
 */
export async function loanPayoffChart(
	deps: ServiceDeps,
	accountId: string,
	period: BalancePeriod,
): Promise<LoanPayoffChartData | null> {
	const account = await getAccount(deps, accountId);
	const contract =
		account.type === "loan" ? contractOf(account, await openingOf(deps, accountId)) : null;

	if (contract === null) {
		return null;
	}

	const { schedule, originalAmount } = contract;
	const asOf = today(deps.timeZone);
	const projection = projectionOf(contract, account.balance, asOf);
	const projectedPayoff = projectedPayoffOf(projection);
	const converged = projection?.converged === true ? projection : null;
	// `amortizationSchedule` has none without a payment.
	const scheduledPayoffDate = schedule.payments.at(-1)!.date;
	const domain = chartDomain({
		months: PERIOD_MONTHS[period],
		asOf,
		originationDate: schedule.originationDate,
		scheduledPayoffDate,
		projectedPayoffDate: converged?.payoffDate ?? null,
	});
	const recorded = sampleSeries(
		await balancesBetween(deps, accountId, domain.from, minDate(domain.to, asOf)),
	).points;
	const series = payoffChartSeries(
		{
			actual: recorded,
			scheduled: scheduledSeries(schedule, originalAmount),
			projected: projectedSeries(asOf, BigInt(account.balance), projection),
		},
		domain,
	);

	return {
		asOf,
		currency: account.currency,
		period,
		...domain,
		balance: account.balance,
		// Two points always give a change.
		change: balanceChange([
			{ date: schedule.originationDate, balance: minor(originalAmount) },
			{ date: asOf, balance: account.balance },
		])!,
		...series,
		scheduledPayoffDate,
		projectedPayoff,
		monthsSaved: converged?.monthsSaved ?? null,
		interestSaved: converged === null ? null : minor(converged.interestSaved),
		balloon: projection?.converged === false ? minor(projection.balloon) : null,
	};
}
