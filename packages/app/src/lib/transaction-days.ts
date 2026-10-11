import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

type DayRow = {
	id: string;
	date: string;
	amount: MinorUnits;
	currency: string;
	/** The split this row is a line of, `null` for any other row. */
	parentEntryId: string | null;
	/** The transfer this row is a side of, pending included, `null` for any other row. */
	transfer: { counterpartTransactionId: string } | null;
};

/**
 * One line of a day: a row on its own, or a split's parent with the lines
 * of it that the page holds, in the order they were created.
 */
type DayEntry<Row extends DayRow> =
	| { kind: "row"; row: Row }
	| { kind: "split"; parent: Row; children: Row[] };

export type TransactionDay<Row extends DayRow> = {
	date: string;
	/**
	 * The page's rows of the day shown, in the page's order: what the count
	 * reads. A transfer's inflow whose outflow the page holds is not among them.
	 */
	items: Row[];
	/** The day's rows as the list shows them, each split's lines under their parent. */
	entries: DayEntry<Row>[];
	/**
	 * The signed sum of the day's rows on this page but its transfer sides, one
	 * per currency in order of appearance; none for a day of transfers alone.
	 */
	subtotals: { currency: string; amount: MinorUnits }[];
};

/**
 * The day's rows with each split's lines grouped under its parent, as Sure's
 * `group_split_entries`: the first line of a parent in `parents` puts the
 * parent there, followed by every line of it that day holds. The page sorts
 * them newest first and a split creates its lines in order, so reversing
 * them gives the order the split's dialog lists them in. A line whose parent
 * is missing stays a row on its own.
 */
function entriesOf<Row extends DayRow>(
	items: readonly Row[],
	parents: ReadonlyMap<string, Row>,
): DayEntry<Row>[] {
	const grouped = new Set<string>();
	const entries: DayEntry<Row>[] = [];

	for (const item of items) {
		const parent = item.parentEntryId === null ? undefined : parents.get(item.parentEntryId);

		if (parent === undefined) {
			entries.push({ kind: "row", row: item });
		} else if (!grouped.has(parent.id)) {
			grouped.add(parent.id);
			entries.push({
				kind: "split",
				parent,
				children: items.filter((child) => child.parentEntryId === parent.id).toReversed(),
			});
		}
	}

	return entries;
}

/**
 * The page's rows but the inflow of each transfer whose outflow the page
 * holds, as Sure's `entries_by_date`: a transfer whose two sides are on the
 * page shows once, as its outflow. Archant's outflow is the negative side.
 */
function withoutShownInflows<Row extends DayRow>(items: readonly Row[]): Row[] {
	const ids = new Set(items.map((item) => item.id));

	return items.filter(
		(item) =>
			item.transfer === null ||
			item.amount <= 0 ||
			!ids.has(item.transfer.counterpartTransactionId),
	);
}

/**
 * The page's rows under one entry per day, as Sure's `_entry_group`: the
 * subtotal sums the rows shown, pending and excluded included as the filter
 * total counts them, so a day split across two pages shows two partial
 * subtotals rather than a figure the rows beneath it contradict. A transfer
 * side, pending proposal included, is never summed, as Sure's
 * `calculate_total` leaves transfers out: money moved between two accounts
 * is neither spent nor earned that day. A split's parent, from
 * `splitParents`, is shown above its lines and never summed: the lines
 * already count its money.
 */
export function groupByDay<Row extends DayRow>(
	items: readonly Row[],
	splitParents: readonly Row[] = [],
): TransactionDay<Row>[] {
	const days: TransactionDay<Row>[] = [];
	const parents = new Map(splitParents.map((parent) => [parent.id, parent]));

	for (const item of withoutShownInflows(items)) {
		let day = days.at(-1);

		// The API sorts by date first, so a day's rows are always adjacent.
		if (day?.date !== item.date) {
			day = { date: item.date, items: [], entries: [], subtotals: [] };
			days.push(day);
		}

		day.items.push(item);

		if (item.transfer !== null) {
			continue;
		}

		const subtotal = day.subtotals.find((candidate) => candidate.currency === item.currency);

		if (subtotal === undefined) {
			day.subtotals.push({ currency: item.currency, amount: item.amount });
		} else {
			subtotal.amount = toMinorUnits(subtotal.amount + item.amount);
		}
	}

	for (const day of days) {
		day.entries = entriesOf(day.items, parents);
	}

	return days;
}

/** The page's rows in the order the list shows them, for a `Shift`+click range. */
export function shownOrder<Row extends DayRow>(
	items: readonly Row[],
	splitParents: readonly Row[],
): Row[] {
	return groupByDay(items, splitParents).flatMap((day) =>
		day.entries.flatMap((entry) => (entry.kind === "row" ? [entry.row] : entry.children)),
	);
}
