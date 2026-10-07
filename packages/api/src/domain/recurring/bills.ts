import type { IsoDate } from "../dates.ts";
import type { ScheduledSeries } from "./series.ts";

import type { OccurrenceStatus } from "@archant/data/recurring";

import { addDays, daysBetween, maxDate } from "../dates.ts";
import { DAYS_PER_YEAR, occurrencesBetween, occurrencesPerYear } from "./schedule.ts";
import { scheduleOf } from "./series.ts";

/**
 * Sure's `next_due_date`, without its fallback for a series with nothing
 * generated yet: the current occurrence's effective date while it is open,
 * else the series' next expected date.
 */
export function nextDueDateOf(series: {
	nextExpectedDate: IsoDate;
	currentOccurrence: { status: OccurrenceStatus; effectiveDueOn: IsoDate } | null;
}): IsoDate {
	const occurrence = series.currentOccurrence;

	return occurrence !== null && occurrence.status === "scheduled"
		? occurrence.effectiveDueOn
		: series.nextExpectedDate;
}

/**
 * The next `count` due dates of a series from `from` on, never before a
 * declared bill's first due date, as the generator reads its schedule.
 */
export function nextDueDates(
	series: ScheduledSeries & { manual: boolean },
	from: IsoDate,
	count = 3,
): IsoDate[] {
	const start =
		series.manual && series.anchorDate !== null ? maxDate(from, series.anchorDate) : from;

	// Sure's 400 days: a yearly bill's next date always falls within them.
	return occurrencesBetween(scheduleOf(series), start, addDays(start, 400)).slice(0, count);
}

/**
 * Sure's `cycles_overdue`: the whole cycles of the series' own cadence since
 * `nextDueDate`, so a weekly and a yearly bill read alike. A count of
 * cycles, never money: the float of `occurrencesPerYear` is fine here.
 */
export function cyclesOverdue(series: ScheduledSeries, nextDueDate: IsoDate, day: IsoDate): number {
	const late = daysBetween(nextDueDate, day);

	return late <= 0
		? 0
		: Math.floor((late * occurrencesPerYear(scheduleOf(series))) / DAYS_PER_YEAR);
}
