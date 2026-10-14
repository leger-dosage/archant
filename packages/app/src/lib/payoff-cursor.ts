/** A day on the axis: milliseconds at UTC midnight, so the line to a far date keeps its slope. */
export const atMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export const isoOf = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

/** The date among `dates` nearest `date`; `date` itself when there is none. */
export function nearestDate(dates: readonly string[], date: string): string {
	const day = atMidnight(date);

	return dates.reduce<string>(
		(best, candidate) =>
			Math.abs(atMidnight(candidate) - day) < Math.abs(atMidnight(best) - day) ? candidate : best,
		dates.at(0) ?? date,
	);
}

/**
 * The dates Sure's tooltip stops at: the scheduled payments inside the window,
 * else every plotted date in it, since the recorded line's own points would
 * repeat a month several times over.
 */
export function payoffStops(
	scheduled: readonly string[],
	plotted: readonly string[],
	window: { from: string; to: string },
): string[] {
	const inside = (date: string) => date >= window.from && date <= window.to;
	const payments = scheduled.filter(inside);

	return payments.length > 0 ? payments : plotted.filter(inside);
}

/**
 * Where Sure's loan chart splits the recorded line, in UTC-midnight
 * milliseconds: the stop the tooltip snaps to, or the window's end when
 * nothing is hovered or focused, so the whole line is coloured at rest.
 */
export function splitDay(
	label: string | number | undefined,
	stops: readonly string[],
	end: number,
): number {
	return typeof label === "number" ? atMidnight(nearestDate(stops, isoOf(label))) : end;
}
