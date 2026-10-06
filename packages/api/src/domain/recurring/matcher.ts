import type { CashFlowTransaction } from "../cash-flow.ts";
import type { IsoDate } from "../dates.ts";
import type { Schedule } from "./schedule.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { BillType } from "@archant/data/recurring";
import type { MatchSignals } from "@archant/data/schema/recurring-occurrences";

import { direction } from "../cash-flow.ts";
import { addDays, daysBetween, maxDate } from "../dates.ts";
import { normalizeLabel } from "../normalize-label.ts";
import {
	AMOUNT_TOLERANCE,
	MAX_LEARNED_TOLERANCE,
	derivedState,
	effectiveDueOn,
	resolvedExpected,
	roundHalfUp,
} from "./occurrences.ts";
import { DAYS_PER_YEAR, occurrencesPerYear } from "./schedule.ts";

/** Sure's `EXACT_TIER`, 0.85 in ten-thousandths: a payment this sure confirms itself. */
const EXACT_TIER = 8500;

/** Sure's `HIGH_TIER`, 0.60: a payment this sure is suggested. */
const HIGH_TIER = 6000;

/** Sure's `AMBIGUITY_MARGIN`, 0.15: how far ahead of the entry's next best occurrence a confirmation must be. */
const AMBIGUITY_MARGIN = 1500;

// Sure's `match_days_early` and `match_days_late`, which no Sure screen sets.
const DAYS_EARLY = 2;
const DAYS_LATE = 7;

// Sure's signals, in ten-thousandths.
const MERCHANT_SCORE = 4000;
const NAME_SCORE = 3500;
const EXACT_AMOUNT_SCORE = 3000;
const NEAR_AMOUNT_SCORE = 2500;
const AMOUNT_DECAY = 1000;
const DATE_SCORE = 2000;
const DATE_DECAY = 1500;
const ACCOUNT_SCORE = 1000;

/** A series as the matcher reads it. */
export type MatchSeries = {
	id: string;
	accountId: string;
	currency: string;
	/** Signed as its transactions (AD-5). */
	amount: MinorUnits;
	merchantId: string | null;
	labelKey: string | null;
	name: string | null;
	nameAliases: readonly string[];
	/** Per mille, `null` when nothing was learned. */
	learnedTolerance: number | null;
	billType: BillType;
	schedule: Schedule;
};

/** An open occurrence as the matcher reads it. */
export type MatchOccurrence = {
	id: string;
	seriesId: string;
	dueOn: IsoDate;
	snoozedUntil: IsoDate | null;
	expectedAmount: MinorUnits | null;
};

/** A transaction as the matcher reads it. */
export type MatchEntry = CashFlowTransaction & {
	id: string;
	accountId: string;
	currency: string;
	date: IsoDate;
	merchantId: string | null;
	label: string;
	pending: boolean;
	excluded: boolean;
	/** A split's parent (AD-20): its lines carry the money. */
	splitParent: boolean;
};

/** A payment the matcher writes. */
export type MatchDecision = {
	occurrenceId: string;
	entryId: string;
	state: "suggested" | "confirmed";
	score: number;
	signals: MatchSignals;
};

/** What one run knows beyond the rows it scores. */
export type MatchContext = {
	today: IsoDate;
	/** `seriesId entryId` pairs the owner rejected. */
	rejected: ReadonlySet<string>;
	/** Transactions already in a confirmed payment. */
	confirmedEntryIds: ReadonlySet<string>;
};

/** The key `MatchContext.rejected` holds for a pair. */
export const rejectionKey = (seriesId: string, entryId: string) => `${seriesId} ${entryId}`;

type Window = { start: IsoDate; end: IsoDate };

/**
 * Sure's `window_for`: 2 days before the effective due date to 7 after, each
 * side under half the series' cycle so two occurrences never share a
 * transaction; an overdue occurrence stays open to today.
 */
export function windowOf(series: MatchSeries, occurrence: MatchOccurrence, today: IsoDate): Window {
	const cycleDays = Math.floor(DAYS_PER_YEAR / occurrencesPerYear(series.schedule));
	const halfCycle = Math.max(Math.floor((cycleDays - 1) / 2), 1);
	const effective = effectiveDueOn(occurrence);
	const end = addDays(effective, Math.min(DAYS_LATE, halfCycle));

	return {
		start: addDays(effective, -Math.min(DAYS_EARLY, halfCycle)),
		end:
			derivedState({ ...occurrence, status: "scheduled" }, today) === "overdue"
				? maxDate(end, today)
				: end,
	};
}

/** The normalised names a series without a merchant recognises: its key, its name and its aliases. */
export function knownNames(
	series: Pick<MatchSeries, "labelKey" | "name" | "nameAliases">,
): Set<string> {
	return new Set(
		[series.labelKey, series.name, ...series.nameAliases]
			.filter((name): name is string => name !== null)
			.map(normalizeLabel),
	);
}

/**
 * Sure's `identity_matches?` and the filters around it: the series' currency,
 * account and sign, its merchant or else a name it knows, not excluded, not a
 * split parent, not a transfer side but for the outflow of a loan payment or
 * an investment contribution, as detection reads it.
 */
function identityMatches(series: MatchSeries, entry: MatchEntry, names: Set<string>): boolean {
	if (
		entry.currency !== series.currency ||
		entry.accountId !== series.accountId ||
		series.amount < 0 !== entry.amount < 0 ||
		entry.excluded ||
		entry.splitParent ||
		direction(entry) === "transfer"
	) {
		return false;
	}

	return series.merchantId === null
		? names.has(normalizeLabel(entry.label))
		: entry.merchantId === series.merchantId;
}

/**
 * Sure's `amount_score`: 3000 for the exact amount, else 2500 down to 1500 at
 * the band's edge, the band being the larger of 7.5 % and the learned
 * tolerance, never past 25 %; `null` outside it.
 */
function amountScore(series: MatchSeries, expected: MinorUnits, actual: MinorUnits): number | null {
	if (actual === expected) {
		return EXACT_AMOUNT_SCORE;
	}

	const tolerance = Math.min(
		Math.max(AMOUNT_TOLERANCE, series.learnedTolerance ?? 0),
		MAX_LEARNED_TOLERANCE,
	);
	const distance = Math.abs(actual - expected);
	// `band = expected × tolerance / 1000`, kept as a fraction.
	const band = Math.abs(expected) * tolerance;

	if (band === 0 || distance * 1000 > band) {
		return null;
	}

	// 2500 − 1000 × distance / (band / 1000), rounded half up.
	return roundHalfUp(NEAR_AMOUNT_SCORE * band - AMOUNT_DECAY * 1000 * distance, band);
}

/** Sure's `date_score`: 2000 on the effective due date, down to 500 at the window's far end. */
function dateScore(occurrence: MatchOccurrence, window: Window, date: IsoDate): number {
	const span = Math.max(daysBetween(window.start, window.end), 1);
	const distance = Math.min(Math.abs(daysBetween(effectiveDueOn(occurrence), date)), span);

	return roundHalfUp(DATE_SCORE * span - DATE_DECAY * distance, span);
}

/** Sure's `score`: the sum of the signals, 0 with the amount outside the band. */
function score(
	series: MatchSeries,
	occurrence: MatchOccurrence,
	entry: MatchEntry,
	window: Window,
): { score: number; signals: MatchSignals } {
	const identity = series.merchantId === null ? NAME_SCORE : MERCHANT_SCORE;
	const signals: MatchSignals =
		series.merchantId === null ? { name: identity } : { merchant: identity };
	const amount = amountScore(
		series,
		resolvedExpected(occurrence, series.amount),
		toMinorUnits(Math.abs(entry.amount)),
	);

	if (amount === null) {
		return { score: 0, signals };
	}

	const date = dateScore(occurrence, window, entry.date);

	return {
		score: identity + amount + date + ACCOUNT_SCORE,
		signals: { ...signals, amount, date, account: ACCOUNT_SCORE },
	};
}

const covers = (window: Window, date: IsoDate) => date >= window.start && date <= window.end;

/**
 * Sure's `explain`: how `entry` scores against `occurrence`, or `null` when it
 * could never belong to the series, lies outside the window or falls outside
 * the amount band. Read-only, for the sheet of Story 23.4.
 */
export function explain(
	series: MatchSeries,
	occurrence: MatchOccurrence,
	entry: MatchEntry,
	today: IsoDate,
): { score: number; signals: MatchSignals } | null {
	const window = windowOf(series, occurrence, today);

	if (!identityMatches(series, entry, knownNames(series)) || !covers(window, entry.date)) {
		return null;
	}

	const scored = score(series, occurrence, entry, window);

	return scored.score > 0 ? scored : null;
}

/**
 * The span of dates a run reads transactions from: every open occurrence's
 * window together, up to today for a live run. `null` without an occurrence.
 */
export function entryWindow(
	series: ReadonlyMap<string, MatchSeries>,
	occurrences: readonly MatchOccurrence[],
	today: IsoDate,
	backfill: boolean,
): Window | null {
	const windows = occurrences.map((occurrence) =>
		windowOf(series.get(occurrence.seriesId)!, occurrence, today),
	);

	if (windows.length === 0) {
		return null;
	}

	const start = windows.map((window) => window.start).toSorted()[0]!;
	const end = windows
		.map((window) => window.end)
		.toSorted()
		.at(-1)!;

	return { start, end: !backfill && end > today ? today : end };
}

type Candidate = {
	occurrence: MatchOccurrence;
	entry: MatchEntry;
	score: number;
	signals: MatchSignals;
};

/**
 * Sure's `collect_candidates`: every entry against every open occurrence of
 * every series it could belong to, within the window, from 6000 up. Within
 * one series an entry keeps only its nearest occurrence, the first on a tie,
 * as Sure's `prune_to_nearest_per_series`.
 */
function candidatesOf(
	series: ReadonlyMap<string, MatchSeries>,
	occurrences: readonly MatchOccurrence[],
	entries: readonly MatchEntry[],
	context: MatchContext,
): Candidate[] {
	const bySeries = new Map<string, MatchOccurrence[]>();

	for (const occurrence of occurrences) {
		bySeries.set(occurrence.seriesId, [...(bySeries.get(occurrence.seriesId) ?? []), occurrence]);
	}

	const names = new Map([...series.values()].map((one) => [one.id, knownNames(one)]));
	const kept: Candidate[] = [];

	for (const entry of entries) {
		if (context.confirmedEntryIds.has(entry.id)) {
			continue;
		}

		for (const [seriesId, own] of bySeries) {
			const one = series.get(seriesId)!;

			if (
				context.rejected.has(rejectionKey(seriesId, entry.id)) ||
				!identityMatches(one, entry, names.get(seriesId)!)
			) {
				continue;
			}

			let nearest: { candidate: Candidate; distance: number } | null = null;

			for (const occurrence of own) {
				const window = windowOf(one, occurrence, context.today);

				if (!covers(window, entry.date)) {
					continue;
				}

				const scored = score(one, occurrence, entry, window);

				if (scored.score < HIGH_TIER) {
					continue;
				}

				const distance = Math.abs(daysBetween(effectiveDueOn(occurrence), entry.date));

				if (nearest === null || distance < nearest.distance) {
					nearest = { candidate: { occurrence, entry, ...scored }, distance };
				}
			}

			if (nearest !== null) {
				kept.push(nearest.candidate);
			}
		}
	}

	return kept;
}

/**
 * Sure's `tier_for`: confirmed from 8500 for a booked transaction no other
 * occurrence scores within 1500 of; else suggested from 6000, never for an
 * income, whose deposit either confirms itself or waits.
 */
function tierOf(
	candidate: Candidate,
	ordered: readonly Candidate[],
	series: MatchSeries,
): MatchDecision["state"] | null {
	const runnerUp = ordered.find(
		(other) =>
			other.entry.id === candidate.entry.id && other.occurrence.id !== candidate.occurrence.id,
	);

	if (
		candidate.score >= EXACT_TIER &&
		!candidate.entry.pending &&
		(runnerUp === undefined || candidate.score - runnerUp.score >= AMBIGUITY_MARGIN)
	) {
		return "confirmed";
	}

	return candidate.score >= HIGH_TIER && series.billType !== "income" ? "suggested" : null;
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sure's `Matcher#run!` and `run_backfill!`, as decisions: the highest score
 * claims first, each entry and occurrence once per run, ties broken by
 * occurrence then entry id. A backfill writes confirmed payments only, so
 * history never buries the review queue.
 */
export function matchPayments(
	series: ReadonlyMap<string, MatchSeries>,
	occurrences: readonly MatchOccurrence[],
	entries: readonly MatchEntry[],
	context: MatchContext,
	{ backfill }: { backfill: boolean },
): MatchDecision[] {
	const ordered = candidatesOf(series, occurrences, entries, context).toSorted(
		(a, b) =>
			b.score - a.score ||
			compareIds(a.occurrence.id, b.occurrence.id) ||
			compareIds(a.entry.id, b.entry.id),
	);
	const takenEntries = new Set<string>();
	const takenOccurrences = new Set<string>();
	const decisions: MatchDecision[] = [];

	for (const candidate of ordered) {
		if (takenEntries.has(candidate.entry.id) || takenOccurrences.has(candidate.occurrence.id)) {
			continue;
		}

		const state = tierOf(candidate, ordered, series.get(candidate.occurrence.seriesId)!);

		if (state === null || (state === "suggested" && backfill)) {
			continue;
		}

		decisions.push({
			occurrenceId: candidate.occurrence.id,
			entryId: candidate.entry.id,
			state,
			score: candidate.score,
			signals: candidate.signals,
		});
		takenEntries.add(candidate.entry.id);
		takenOccurrences.add(candidate.occurrence.id);
	}

	return decisions;
}
