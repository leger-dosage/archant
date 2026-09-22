import type { IsoDate } from "./dates.ts";

import { createHash } from "node:crypto";

import type { MinorUnits } from "@archant/data/money";

import { daysBetween } from "./dates.ts";
import { normalizeLabel } from "./normalize-label.ts";

/** How far apart a line and an entry from another source may be dated and still pair (AD-7). */
export const MATCH_WINDOW_DAYS = 3;

export type KeyedLine = {
	date: IsoDate;
	amount: MinorUnits;
	label: string;
	externalId: string | null;
};

/** The keys a line is stored and recognised under (AD-7). */
export type LineKeys = { fingerprint: string; external: string | null };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Every line with its keys, in statement order. The fingerprint hashes the
 * date, the amount, the normalised label and the line's rank among identical
 * lines of the same statement, so two identical coffees on one day both go
 * in, and both are recognised on re-import. A bank re-export with new
 * `FITID`s keeps its fingerprints.
 */
export function lineKeys<Line extends KeyedLine>(
	lines: readonly Line[],
): { line: Line; keys: LineKeys }[] {
	const seen = new Map<string, number>();

	return lines.map((line) => {
		const label = normalizeLabel(line.label);
		const triple = `${line.date}|${line.amount}|${label}`;
		const occurrence = seen.get(triple) ?? 0;
		seen.set(triple, occurrence + 1);

		return {
			line,
			keys: {
				fingerprint: `fp:${sha256(`${triple}|${occurrence}`)}`,
				external: line.externalId === null ? null : `ext:${line.externalId}`,
			},
		};
	});
}

export type PairCandidate = { id: string; date: IsoDate; amount: MinorUnits };

export type Pairing =
	| { kind: "matched"; candidateId: string }
	/** Two candidates at the same nearest distance: created, flagged as a possible duplicate. */
	| { kind: "tie" }
	| { kind: "none" };

/**
 * Pairs lines with entries another source already wrote, one to one (AD-7).
 * Each line takes the unused candidate of the same amount at the nearest date
 * within 3 days. Lines closest to a candidate choose first, then by amount and
 * date: otherwise a line on the 1st would take the only entry of the 3rd from
 * the file's own line of the 3rd. Returns every line with its pairing, in the
 * order given.
 */
export function pairLines<Line extends { date: IsoDate; amount: MinorUnits }>(
	lines: readonly Line[],
	candidates: readonly PairCandidate[],
): { line: Line; pairing: Pairing }[] {
	const byAmount = new Map<number, PairCandidate[]>();

	for (const candidate of candidates) {
		const group = byAmount.get(candidate.amount);

		if (group === undefined) {
			byAmount.set(candidate.amount, [candidate]);
		} else {
			group.push(candidate);
		}
	}

	const within = (line: Line) =>
		(byAmount.get(line.amount) ?? [])
			.map((candidate) => ({
				candidate,
				distance: Math.abs(daysBetween(line.date, candidate.date)),
			}))
			.filter(({ distance }) => distance <= MATCH_WINDOW_DAYS);
	const used = new Set<string>();
	const paired = lines.map(
		(line, index): { line: Line; index: number; closest: number; pairing: Pairing } => ({
			line,
			index,
			closest: Math.min(...within(line).map(({ distance }) => distance)),
			pairing: { kind: "none" },
		}),
	);
	const order = paired.toSorted(
		(a, b) =>
			a.closest - b.closest ||
			a.line.amount - b.line.amount ||
			a.line.date.localeCompare(b.line.date) ||
			a.index - b.index,
	);

	for (const item of order) {
		const near = within(item.line).filter(({ candidate }) => !used.has(candidate.id));
		const nearest = Math.min(...near.map(({ distance }) => distance));
		const closest = near.filter(({ distance }) => distance === nearest);
		const [only] = closest;

		if (closest.length > 1) {
			item.pairing = { kind: "tie" };
		} else if (only !== undefined) {
			used.add(only.candidate.id);
			item.pairing = { kind: "matched", candidateId: only.candidate.id };
		}
	}

	return paired.map(({ line, pairing }) => ({ line, pairing }));
}

export type DigestEntry = { group: string; ref: string; entryId: string | null };

/**
 * What a preview promised, reduced to a hash: which group each line fell in
 * and which entry it pairs with. Confirm recomputes it under the write lock;
 * a different hash means the account changed since the preview.
 */
export function previewDigest(entries: readonly DigestEntry[]): string {
	return sha256(
		entries
			.map((entry) => JSON.stringify([entry.group, entry.ref, entry.entryId]))
			.toSorted()
			.join("\n"),
	);
}
