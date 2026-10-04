import type { IsoDate } from "./dates.ts";

import type { Micros } from "@archant/data/micros";

import { addDays, addMonths, maxDate } from "./dates.ts";

/**
 * Sure's `PROVISIONAL_LOOKBACK_DAYS`: a price dated this close to today may
 * still move, a late close or a carried weekend, so the next fetch writes it
 * again. Also how far before its first day a request reaches, for a price to
 * carry into it.
 */
const PROVISIONAL_DAYS = 7;

/** Sure's `MAX_LOOKBACK_WINDOW`: no request reaches further back. */
const MAX_HISTORY_MONTHS = 120;

/** What a security's stored prices say about where the next fetch starts. */
export type StoredRange = {
	first: IsoDate;
	last: IsoDate;
	/** The earliest provisional row, `null` when none is. */
	earliestProvisional: IsoDate | null;
};

/** The days a fetch writes from, and the days it asks the provider for, to today. */
export type PriceWindow = { start: IsoDate; requestFrom: IsoDate };

/**
 * Sure's `Security::Price::Importer` window. The first day to write is the
 * day the security is held from, when nothing is stored or that day comes
 * before the first stored one, never before the provider's first day; else
 * the earliest provisional row, or the day after the last one. The request
 * starts seven days earlier, for a price to carry into that first day, and
 * reaches back ten years at most. `null` when there is nothing to fetch: the
 * first day would come after today.
 */
export function priceWindow({
	from,
	firstPriceOn,
	stored,
	today,
}: {
	from: IsoDate;
	firstPriceOn: IsoDate | null;
	stored: StoredRange | null;
	today: IsoDate;
}): PriceWindow | null {
	const held = firstPriceOn === null ? from : maxDate(from, firstPriceOn);
	const resume =
		stored === null || held < stored.first
			? held
			: (stored.earliestProvisional ?? addDays(stored.last, 1));
	const oldest = addMonths(today, -MAX_HISTORY_MONTHS);
	const start = maxDate(resume, oldest);

	if (start > today) {
		return null;
	}

	return { start, requestFrom: maxDate(addDays(start, -PROVISIONAL_DAYS), oldest) };
}

/** A day's price to write. */
export type FilledPrice = { date: IsoDate; price: Micros; provisional: boolean };

/**
 * Every calendar day from `start` to `today`, as Sure's gap fill: the
 * provider's close, else the last price carried, from the provider's days
 * before `start`, else from the last stored row. Days before any known price
 * are left out, and `firstPriceOn` is then the provider's first day; `null`
 * when a price was known from the start. A typed price is never written over,
 * and carries as any other. Rows within seven days of today are provisional.
 */
export function fillPrices({
	start,
	today,
	closes,
	storedBefore,
	manual,
}: {
	start: IsoDate;
	today: IsoDate;
	/** The provider's closes, sorted by date, from the request's first day. */
	closes: readonly { date: IsoDate; price: Micros }[];
	/** The last stored price before `start`, `null` when there is none. */
	storedBefore: Micros | null;
	/** The typed prices from `start` on, by day. */
	manual: ReadonlyMap<IsoDate, Micros>;
}): { rows: FilledPrice[]; firstPriceOn: IsoDate | null } {
	const byDate = new Map(closes.map(({ date, price }) => [date, price]));
	const lookback = closes.findLast(({ date }) => date < start)?.price ?? storedBefore;
	const provisionalFrom = addDays(today, -PROVISIONAL_DAYS);
	const rows: FilledPrice[] = [];
	let carried = lookback;

	for (let date = start; date <= today; date = addDays(date, 1)) {
		const typed = manual.get(date);

		if (typed !== undefined) {
			carried = typed;
			continue;
		}

		const price = byDate.get(date) ?? carried;

		if (price !== null) {
			rows.push({ date, price, provisional: date >= provisionalFrom });
			carried = price;
		}
	}

	return {
		rows,
		firstPriceOn:
			lookback === null ? (closes.find(({ date }) => date >= start)?.date ?? null) : null,
	};
}
