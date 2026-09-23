const pad = (value: number) => String(value).padStart(2, "0");

/** A calendar day in the browser's own time zone, as `YYYY-MM-DD`; today by default. */
export function toIsoDate(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isoToDate(iso: string): Date | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);

	if (match === null) {
		return undefined;
	}

	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** `2026-09-15` as `15/09/2026`, the format French users type. */
export function isoToFrench(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);

	return match === null ? iso : `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Reads `15/09/2026` (or `15/9/2026`) into `2026-09-15`. Returns `null` for
 * anything else, including dates that do not exist such as 31/02.
 */
export function frenchToIso(text: string): string | null {
	const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));

	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	return `${year}-${pad(month)}-${pad(day)}`;
}

const sameYear = new Intl.DateTimeFormat("fr-FR", {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});
const otherYear = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

export type DayHeading = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; text: string };

/**
 * The header of a day in a list (EXPERIENCE.md): today, yesterday, then
 * « lundi 15 septembre », with the year instead of the weekday for another
 * year. Formatted at UTC midnight so the browser's zone cannot shift the day.
 */
export function dayHeading(iso: string, today: string = toIsoDate()): DayHeading {
	const date = new Date(`${iso}T00:00:00Z`);
	const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
		.toISOString()
		.slice(0, 10);

	if (iso === today) {
		return { kind: "today" };
	}

	if (iso === yesterday) {
		return { kind: "yesterday" };
	}

	return {
		kind: "date",
		text: (iso.slice(0, 4) === today.slice(0, 4) ? sameYear : otherYear).format(date),
	};
}

/** The calendar month in the browser's own time zone, as `YYYY-MM`; this month by default. */
export function toIsoMonth(now: Date = new Date()): string {
	return toIsoDate(now).slice(0, 7);
}

/** The month `months` later, or earlier when negative, across years. */
export function addMonthsTo(month: string, months: number): string {
	const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
	const year = Math.floor(index / 12);

	return `${String(year).padStart(4, "0")}-${pad(index - year * 12 + 1)}`;
}

const monthYear = new Intl.DateTimeFormat("fr-FR", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

/** `2026-08` as « Août 2026 », capitalised as a heading. */
export function monthHeading(month: string): string {
	const text = monthYear.format(new Date(`${month}-01T00:00:00Z`));

	return text.charAt(0).toLocaleUpperCase("fr-FR") + text.slice(1);
}
