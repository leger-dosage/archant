import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { daysBetween } from "./dates.ts";

/**
 * How many days before a booked line its pending entry may be dated, as
 * Sure's `find_pending_transaction` `date_window: 8` (AD-17).
 */
const PENDING_WINDOW_DAYS = 8;

/** A pending entry a booked line may absorb. */
export type PendingCandidate = {
	id: string;
	date: IsoDate;
	amount: MinorUnits;
	createdAt: number;
};

/**
 * Step 3 of the pipeline for booked lines no key recognised (AD-17), as
 * Sure's `find_pending_transaction`: each line, in statement order, takes the
 * unused pending entry of the same amount dated on its day or up to 8 days
 * before, the latest date first, as Sure's `order(date: :desc)`; the oldest
 * created, then the id, only break a tie Sure leaves to the database. A
 * pending entry dated after the line is never taken: the authorisation comes
 * before the booking. A bank books a card payment days after the purchase,
 * often under a new label and without the pending line's reference, so the
 * amount is the only thing that holds. Returns every line with the entry it
 * absorbs, `null` for none, in the order given.
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
				distance: daysBetween(candidate.date, line.date),
			}))
			.filter(({ distance }) => distance >= 0 && distance <= PENDING_WINDOW_DAYS)
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

/**
 * How many days before a new booked line a pending entry it may repeat at
 * another amount is dated, as Sure's fuzzy `date_window: 3`: a tip is added
 * within days, not a week later.
 */
export const SUGGESTION_WINDOW_DAYS = 3;

/** A pending entry a new booked line may repeat at another amount. */
export type SuggestionCandidate = {
	id: string;
	date: IsoDate;
	amount: MinorUnits;
	merchantId: string | null;
	label: string;
};

export type PostedMatchSuggestion = { id: string; confidence: "medium" | "low" };

/**
 * The first three words of a label, as Sure's
 * `downcase.gsub(/[^a-z0-9\s]/, "").split.first(3).join(" ")`: every
 * character but an ASCII letter, a digit or ASCII whitespace goes, accented
 * letters included, so « Café » reads `caf`.
 */
export function labelWords(label: string): string {
	return label
		.toLowerCase()
		.replaceAll(/[^a-z0-9 \t\n\v\f\r]/g, "")
		.split(/[ \t\n\v\f\r]+/)
		.filter((word) => word !== "")
		.slice(0, 3)
		.join(" ");
}

/** `items` when it holds exactly one, as Sure's `size == 1`; else `undefined`. */
function single<Item>(items: readonly Item[]): Item | undefined {
	return items.length === 1 ? items[0] : undefined;
}

/**
 * The pending entry a new booked line may repeat at another amount, as Sure's
 * `find_pending_transaction_fuzzy`, then `find_pending_transaction_low_confidence`
 * when the first finds none. Both keep to entries dated on the line's day or
 * up to 3 days before, and compare amounts without their sign, as Sure's
 * `ABS`, in minor units. Medium: the line at most 30 % above the pending amount, the one
 * sharing its merchant, else the one sharing its first three label words.
 * Low: the line from about 30 % above to double the pending amount, the one sharing both, the line having a
 * merchant and words. Two candidates equally fit are no suggestion: a
 * café visited twice must not have its tip pinned on the wrong visit.
 */
export function suggestPostedMatch(
	line: { date: IsoDate; amount: MinorUnits; merchantId: string | null; label: string },
	candidates: readonly SuggestionCandidate[],
): PostedMatchSuggestion | null {
	const booked = Math.abs(line.amount);
	const near = candidates.filter((candidate) => {
		const distance = daysBetween(candidate.date, line.date);

		return distance >= 0 && distance <= SUGGESTION_WINDOW_DAYS;
	});
	// `abs / 1.3 ≤ p ≤ abs`, and `abs / 2 ≤ p ≤ abs × 0.77`, in integers.
	const medium = near.filter(({ amount }) => {
		const pending = Math.abs(amount);

		return pending * 13 >= booked * 10 && pending <= booked;
	});
	const low = near.filter(({ amount }) => {
		const pending = Math.abs(amount);

		return pending * 2 >= booked && pending * 100 <= booked * 77;
	});
	const words = labelWords(line.label);
	const sameWords = (candidate: SuggestionCandidate) => labelWords(candidate.label) === words;
	const sameMerchant = (candidate: SuggestionCandidate) => candidate.merchantId === line.merchantId;
	const fuzzy =
		(line.merchantId === null ? undefined : single(medium.filter(sameMerchant))) ??
		(words === "" ? undefined : single(medium.filter(sameWords)));

	if (fuzzy !== undefined) {
		return { id: fuzzy.id, confidence: "medium" };
	}

	const loose =
		line.merchantId === null || words === ""
			? undefined
			: single(low.filter((candidate) => sameMerchant(candidate) && sameWords(candidate)));

	return loose === undefined ? null : { id: loose.id, confidence: "low" };
}
