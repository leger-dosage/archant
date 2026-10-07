import type { DailyBalance } from "../balances/forward.ts";
import type { DateRange } from "../balances/history.ts";
import type { IsoDate } from "../dates.ts";
import type { AmortizationSchedule } from "./amortization-schedule.ts";
import type { PayoffProjection } from "./payoff-projection.ts";

import { toMinorUnits } from "@archant/data/money";

import { addDays, addMonths, maxDate } from "../dates.ts";

/** Sure's `Loan::PayoffChart::SERIES`, in the order its legend lists them. */
const PAYOFF_SERIES = ["actual", "scheduled", "projected"] as const;

type PayoffSeriesKey = (typeof PAYOFF_SERIES)[number];

type PayoffSeries = Record<PayoffSeriesKey, DailyBalance[]>;

type DomainInput = {
	/** The account chart's period: calendar months back from today, or the whole life. */
	months: number | "all";
	asOf: IsoDate;
	originationDate: IsoDate;
	scheduledPayoffDate: IsoDate;
	/** `null` when the projection has no payoff date. */
	projectedPayoffDate: IsoDate | null;
};

/**
 * The dates the chart spans, as Sure's `domain_start` and `domain_end`. A
 * period opens where it would on any account chart, never before the loan:
 * a lead-in before origination would read as a balance that was not there.
 * It ends today, so the forecasts draw under « Tout » alone; « Tout » runs
 * from origination to the later payoff, and never ends before today. A
 * window is at least a day wide, so a loan originated today still has an
 * axis.
 */
export function chartDomain({
	months,
	asOf,
	originationDate,
	scheduledPayoffDate,
	projectedPayoffDate,
}: DomainInput): DateRange {
	if (months === "all") {
		return {
			from: originationDate,
			to: [scheduledPayoffDate, projectedPayoffDate ?? asOf].reduce(maxDate, asOf),
		};
	}

	const from = maxDate(addMonths(asOf, -months), originationDate);

	return { from, to: maxDate(asOf, addDays(from, 1)) };
}

const point = (date: IsoDate, balance: bigint): DailyBalance => ({
	date,
	balance: toMinorUnits(Number(balance)),
});

/**
 * The contract, from origination at the amount borrowed: starting at the
 * first payment would leave the amount borrowed out, and a one-payment loan
 * with a single point and no line.
 */
export function scheduledSeries(
	schedule: Pick<AmortizationSchedule, "originationDate" | "payments">,
	originalAmount: bigint,
): DailyBalance[] {
	return [
		point(schedule.originationDate, originalAmount),
		...schedule.payments.map((payment) => point(payment.date, payment.endingBalance)),
	];
}

/**
 * The projection, from today at today's balance, so the line starts where the
 * balance is rather than where its first payment leaves it; none when there
 * is nothing to project.
 */
export function projectedSeries(
	asOf: IsoDate,
	balance: bigint,
	projection: PayoffProjection | null,
): DailyBalance[] {
	if (projection === null) {
		return [];
	}

	return [
		point(asOf, balance),
		...projection.payments.map((payment) => point(payment.date, payment.endingBalance)),
	];
}

const inside = (date: IsoDate, domain: DateRange) => date >= domain.from && date <= domain.to;

/**
 * Sure's `visible?`: a series draws a line when two of its points fall inside
 * the domain, or it enters on one side and leaves on the other. One point on
 * the boundary, as the projection's opening point on every period but « Tout »,
 * is not a line, and the legend must not promise one.
 */
function visible(points: readonly DailyBalance[], domain: DateRange): boolean {
	const first = points.at(0);
	const last = points.at(-1);

	if (first === undefined || last === undefined) {
		return false;
	}

	return (
		points.filter((candidate) => inside(candidate.date, domain)).length >= 2 ||
		(first.date < domain.from && last.date > domain.to)
	);
}

/**
 * The points inside the domain, plus the last before and the first after it,
 * so a line that crosses an edge is cut there rather than stopping short.
 */
function cut(points: readonly DailyBalance[], domain: DateRange): DailyBalance[] {
	const before = points.findLast((candidate) => candidate.date < domain.from);
	const after = points.find((candidate) => candidate.date > domain.to);

	return [
		...(before === undefined ? [] : [before]),
		...points.filter((candidate) => inside(candidate.date, domain)),
		...(after === undefined ? [] : [after]),
	];
}

/** Each series cut to the domain, and those that draw a line in it, in the legend's order. */
export function payoffChartSeries(
	series: PayoffSeries,
	domain: DateRange,
): PayoffSeries & { visible: PayoffSeriesKey[] } {
	return {
		actual: cut(series.actual, domain),
		scheduled: cut(series.scheduled, domain),
		projected: cut(series.projected, domain),
		visible: PAYOFF_SERIES.filter((key) => visible(series[key], domain)),
	};
}
