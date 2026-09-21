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
