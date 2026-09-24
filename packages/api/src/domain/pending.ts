import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { daysBetween } from "./dates.ts";

/** How far apart a booked line and its pending entry may be dated and still meet (AD-17). */
export const PENDING_WINDOW_DAYS = 5;

/** Consecutive successful syncs without its line after which a pending entry goes (AD-17). */
export const MAX_MISSED_SYNCS = 2;

/** A pending entry a booked line may absorb. */
export type PendingCandidate = {
	id: string;
	date: IsoDate;
	amount: MinorUnits;
	createdAt: number;
};

/**
 * Step 3 of the pipeline for booked lines no key recognised (AD-17): each
 * line, in statement order, takes the unused pending entry of the same amount
 * at the nearest date within 5 days, the oldest one first on a tie. A bank
 * books a card payment days after the purchase, often under a new label and
 * without the pending line's reference, so the amount is the only thing
 * that holds. Returns every line with the entry it absorbs, `null` for none,
 * in the order given.
 */
export function absorbPending<Line extends { date: IsoDate; amount: MinorUnits }>(
	lines: readonly Line[],
	candidates: readonly PendingCandidate[],
): { line: Line; survivorId: string | null }[] {
	const used = new Set<string>();

	return lines.map((line) => {
		const [best] = candidates
			.filter((candidate) => candidate.amount === line.amount && !used.has(candidate.id))
			.map((candidate) => ({
				candidate,
				distance: Math.abs(daysBetween(line.date, candidate.date)),
			}))
			.filter(({ distance }) => distance <= PENDING_WINDOW_DAYS)
			.toSorted(
				(a, b) =>
					a.distance - b.distance ||
					a.candidate.createdAt - b.candidate.createdAt ||
					a.candidate.id.localeCompare(b.candidate.id),
			);

		if (best === undefined) {
			return { line, survivorId: null };
		}

		used.add(best.candidate.id);

		return { line, survivorId: best.candidate.id };
	});
}
