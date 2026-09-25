import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { daysBetween } from "./dates.ts";

/** How far apart a booked line and its pending entry may be dated and still meet (AD-17). */
export const PENDING_WINDOW_DAYS = 5;

/**
 * Successful syncs without its line, on different days, after which a
 * pending entry goes (AD-17).
 */
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

/**
 * The highest occurrence index, plus one, searched for among a group's
 * fingerprints (AD-17): no household lists that many identical lines on one
 * day, and the search stays cheap on a long history.
 */
export const MAX_IDENTICAL_LINES = 100;

/** A pending entry holding the fingerprint of a group of identical lines. */
export type GroupCandidate = {
	id: string;
	/** The lowest occurrence index among the group's fingerprints it holds. */
	occurrence: number;
	createdAt: number;
	/** Holds an `ext:` key: a line with a reference would have found it by that. */
	referenced: boolean;
};

/**
 * Recognises the pending lines of one group, identical by date, amount and
 * normalised label, among the pending entries holding a fingerprint of that
 * group (AD-17). A group as long as the candidates, or longer, lost no line:
 * its fingerprints did not shift, so each line first takes the candidate
 * holding its own (`holder`), and a line bought since is left over. A shorter
 * group lost a line, and an index shifts once an earlier twin is booked:
 * identical lines cannot be told apart, only counted, and the bank books the
 * oldest first, so the lines, in statement order, take the last candidates,
 * ordered by occurrence, then age, then id. A line with a reference never
 * takes a candidate with one. Returns every line with its entry, `null` for a
 * line left over, in the order given.
 */
export function assignIdentical<Line extends { referenced: boolean; holder: string | null }>(
	lines: readonly Line[],
	candidates: readonly GroupCandidate[],
): { line: Line; entryId: string | null }[] {
	const ordered = candidates.toSorted(
		(a, b) => a.occurrence - b.occurrence || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
	);
	const used = new Set<string>();
	const taken = new Map<number, string>();
	const free = (line: Line, candidate: GroupCandidate) =>
		!used.has(candidate.id) && !(line.referenced && candidate.referenced);
	const take = (index: number, candidate: GroupCandidate | undefined) => {
		if (candidate !== undefined) {
			used.add(candidate.id);
			taken.set(index, candidate.id);
		}
	};

	if (lines.length >= ordered.length) {
		for (const [index, line] of lines.entries()) {
			take(
				index,
				ordered.find((candidate) => candidate.id === line.holder && free(line, candidate)),
			);
		}
	}

	for (const [index, line] of [...lines.entries()].toReversed()) {
		if (!taken.has(index)) {
			take(
				index,
				ordered.findLast((candidate) => free(line, candidate)),
			);
		}
	}

	return lines.map((line, index) => ({ line, entryId: taken.get(index) ?? null }));
}
