/**
 * Calendar-month arithmetic shared by the server and the interface, so the
 * month a report shows and the month the server sums are counted alike.
 */

/** The number of days in `month` (1 to 12) of `year`, in the Gregorian calendar. */
export function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

		return leap ? 29 : 28;
	}

	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The `YYYY-MM` month `months` later, or earlier when negative, across years. */
export function shiftMonth(month: string, months: number): string {
	const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
	const year = Math.floor(index / 12);

	return `${String(year).padStart(4, "0")}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}
