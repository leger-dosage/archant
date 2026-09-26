import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

type DayRow = { date: string; amount: MinorUnits; currency: string };

export type TransactionDay<Row extends DayRow> = {
	date: string;
	items: Row[];
	/** The signed sum of the day's rows on this page, one per currency in order of appearance. */
	subtotals: { currency: string; amount: MinorUnits }[];
};

/**
 * The page's rows under one entry per day, as Sure's `_entry_group`: the
 * subtotal sums the rows shown, pending and excluded included as the filter
 * total counts them, so a day split across two pages shows two partial
 * subtotals rather than a figure the rows beneath it contradict.
 */
export function groupByDay<Row extends DayRow>(items: readonly Row[]): TransactionDay<Row>[] {
	const days: TransactionDay<Row>[] = [];

	for (const item of items) {
		let day = days.at(-1);

		// The API sorts by date first, so a day's rows are always adjacent.
		if (day?.date !== item.date) {
			day = { date: item.date, items: [], subtotals: [] };
			days.push(day);
		}

		day.items.push(item);

		const subtotal = day.subtotals.find((candidate) => candidate.currency === item.currency);

		if (subtotal === undefined) {
			day.subtotals.push({ currency: item.currency, amount: item.amount });
		} else {
			subtotal.amount = toMinorUnits(subtotal.amount + item.amount);
		}
	}

	return days;
}
