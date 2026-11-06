// Apart from the `users` table, so the interface reads the periods without
// bundling Drizzle, and the page's arrows and the server's sums agree.

import { daysInMonth, shiftMonth } from "./months.ts";

/** Sure's report period types, in the order its tabs show them. */
export const REPORT_PERIOD_TYPES = [
	"monthly",
	"quarterly",
	"ytd",
	"last_6_months",
	"custom",
] as const;

export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];

/** Sure's `params[:period_type] || :monthly`, and the fallback for an unknown type. */
export const DEFAULT_REPORT_PERIOD_TYPE: ReportPeriodType = "monthly";

/** Two `YYYY-MM-DD` days, both inclusive. */
export type ReportRange = { from: string; to: string };

export type ReportPeriod = ReportRange & {
	type: ReportPeriodType;
	/** The range came reversed and was swapped, Sure's `invalid_date_range` alert. */
	swapped: boolean;
	/** Sure's `build_previous_period`: the same day count, ending the day before `from`. */
	previous: ReportRange;
};

/** What the period's title names, the interface's to word in the user's language. */
export type ReportPeriodLabel =
	| { kind: "monthly"; month: string }
	| { kind: "quarterly"; quarter: number; year: number }
	| { kind: "ytd"; year: number }
	| { kind: "past_year"; year: number }
	| { kind: "last_6_months"; from: string; to: string };

/** Sure's `build_period_navigation`: where the arrows lead, and whether « Période suivante » is off. */
export type ReportNavigation = {
	previous: ReportRange;
	next: ReportRange;
	atLatest: boolean;
	label: ReportPeriodLabel;
};

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const yearOf = (date: string) => Number(date.slice(0, 4));

const monthNumberOf = (date: string) => Number(date.slice(5, 7));

const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

function endOfMonth(date: string): string {
	const last = daysInMonth(yearOf(date), monthNumberOf(date));

	return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** The first of the month `months` after `date`'s, Rails' `beginning_of_month + n.months`. */
const monthsAfter = (date: string, months: number) => `${shiftMonth(date.slice(0, 7), months)}-01`;

/** The same day `months` later, clamped to the target month's last day, as Rails' `n.months`. */
function sameDayMonthsAfter(date: string, months: number): string {
	const month = shiftMonth(date.slice(0, 7), months);
	const last = daysInMonth(yearOf(`${month}-01`), monthNumberOf(`${month}-01`));

	return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** The quarter `date` falls in, 1 to 4, Rails' `Date#quarter`. */
export const quarterOf = (date: string) => Math.ceil(monthNumberOf(date) / 3);

function startOfQuarter(date: string): string {
	const month = (quarterOf(date) - 1) * 3 + 1;

	return `${date.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
}

const endOfQuarter = (date: string) => endOfMonth(monthsAfter(startOfQuarter(date), 2));

/** Sure's `default_start_date` and `default_end_date` on `today`. */
export function defaultReportRange(type: ReportPeriodType, today: string): ReportRange {
	const ranges: Record<ReportPeriodType, () => ReportRange> = {
		monthly: () => ({ from: startOfMonth(today), to: endOfMonth(today) }),
		quarterly: () => ({ from: startOfQuarter(today), to: endOfQuarter(today) }),
		ytd: () => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
		last_6_months: () => ({ from: monthsAfter(today, -5), to: endOfMonth(today) }),
		custom: () => ({ from: sameDayMonthsAfter(today, -1), to: today }),
	};

	return ranges[type]();
}

/**
 * Sure's `setup_report_data`: each date given, else the type's default on
 * `today`, a reversed range swapped, and the comparison period before it.
 */
export function reportPeriod(
	type: ReportPeriodType,
	start: string | undefined,
	end: string | undefined,
	today: string,
): ReportPeriod {
	const defaults = defaultReportRange(type, today);
	const given = { from: start ?? defaults.from, to: end ?? defaults.to };
	const swapped = given.from > given.to;
	const range = swapped ? { from: given.to, to: given.from } : given;
	const previousTo = addDays(range.from, -1);

	return {
		type,
		...range,
		swapped,
		previous: {
			from: addDays(previousTo, -daysBetween(range.from, range.to)),
			to: previousTo,
		},
	};
}

type SteppedType = Exclude<ReportPeriodType, "custom">;

/** Sure's `period_label`'s inputs, for each type with arrows. */
function labelOf(type: SteppedType, period: ReportRange, today: string): ReportPeriodLabel {
	const year = yearOf(period.from);
	const labels: Record<SteppedType, () => ReportPeriodLabel> = {
		monthly: () => ({ kind: "monthly", month: period.from.slice(0, 7) }),
		quarterly: () => ({ kind: "quarterly", quarter: quarterOf(period.from), year }),
		ytd: () => (year === yearOf(today) ? { kind: "ytd", year } : { kind: "past_year", year }),
		last_6_months: () => ({ kind: "last_6_months", from: period.from, to: period.to }),
	};

	return labels[type]();
}

/** Sure's `build_period_navigation`'s steps, for each type with arrows. */
function neighbours(
	type: SteppedType,
	period: ReportRange,
	today: string,
): Omit<ReportNavigation, "label"> {
	const steps: Record<SteppedType, () => Omit<ReportNavigation, "label">> = {
		monthly: () => {
			const previous = monthsAfter(period.from, -1);
			const next = monthsAfter(period.from, 1);

			return {
				previous: { from: previous, to: endOfMonth(previous) },
				next: { from: next, to: endOfMonth(next) },
				atLatest: startOfMonth(period.from) >= startOfMonth(today),
			};
		},
		quarterly: () => {
			const previous = startOfQuarter(addDays(startOfQuarter(period.from), -1));
			const next = addDays(endOfQuarter(period.to), 1);

			return {
				previous: { from: previous, to: endOfQuarter(previous) },
				next: { from: next, to: endOfQuarter(next) },
				atLatest: startOfQuarter(period.from) >= startOfQuarter(today),
			};
		},
		ytd: () => {
			const previousYear = yearOf(period.from) - 1;
			const nextYear = yearOf(period.from) + 1;

			return {
				previous: { from: `${previousYear}-01-01`, to: `${previousYear}-12-31` },
				next: {
					from: `${nextYear}-01-01`,
					to: nextYear === yearOf(today) ? today : `${nextYear}-12-31`,
				},
				atLatest: yearOf(period.from) >= yearOf(today),
			};
		},
		last_6_months: () => {
			const previous = monthsAfter(period.from, -6);
			const candidate = monthsAfter(period.from, 6);
			// Sure snaps a step that would reach the current month onto the
			// six months ending with it, so the last step never runs past today's month.
			const snapped = monthsAfter(candidate, 6) >= startOfMonth(today);
			const nextTo = snapped ? endOfMonth(today) : addDays(monthsAfter(candidate, 6), -1);

			return {
				previous: { from: previous, to: addDays(monthsAfter(previous, 6), -1) },
				next: { from: snapped ? monthsAfter(today, -5) : candidate, to: nextTo },
				atLatest: period.to >= endOfMonth(today),
			};
		},
	};

	return steps[type]();
}

/** Sure's `build_period_navigation`: `null` for a custom range, which has no arrows. */
export function reportNavigation(period: ReportPeriod, today: string): ReportNavigation | null {
	if (period.type === "custom") {
		return null;
	}

	return {
		...neighbours(period.type, period, today),
		label: labelOf(period.type, period, today),
	};
}
