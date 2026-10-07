/**
 * Sure's `Provenance::Citation`, the grammar an assistant's recorded balance
 * cites its source in:
 *
 *   source := ["estimated: "] citation [" (grade: " ("A"|"B"|"C") ")"]
 *
 * Parsed rather than trusted: a free-styled string would land in the ledger
 * looking authoritative, and an estimate could lose its marker on the way in.
 */

export const CITATION_GRADES = ["A", "B", "C"] as const;

type CitationGrade = (typeof CITATION_GRADES)[number];

export const ESTIMATED_PREFIX = "estimated: ";
export const CITATION_MAX_LENGTH = 500;
const MIN_TEXT_LENGTH = 3;

// Spacing around the grade is tolerated the same way in both patterns: were
// FORMAT the stricter, "Doc (grade:A)" would pass the suffix check, then fold
// its grade into the text and come out ungraded.
const FORMAT = /^(?<estimated>estimated:\s)?(?<text>.+?)(?:\s?\(grade:\s*(?<grade>[ABC])\))?$/u;
// Apart, so "(grade: D)" fails loudly instead of passing as ungraded text.
const GRADE_SUFFIX = /\(grade:\s*(?<grade>[^)]*)\)\s*$/u;
const ESTIMATED_MARKER = /^estimated\s*:/iu;

/** What Sure's `to_h` answers: the source as given, its text, and its markers. */
export type Citation = {
	source: string;
	citation: string;
	estimated: boolean;
	grade: CitationGrade | null;
};

/** Why a source was refused: the field code under `source`. */
export type CitationRejection =
	| "source_required"
	| "source_too_long"
	| "estimated_prefix"
	| "unknown_grade"
	| "source_invalid"
	| "no_document_named"
	| "estimate_without_grade";

/** Code points, as Ruby's `String#length` counts them, not UTF-16 units. */
function lengthOf(value: string): number {
	return Array.from(value).length;
}

function isGrade(value: string | undefined): value is CitationGrade {
	return CITATION_GRADES.some((grade) => grade === value);
}

/** Sure's `Provenance::Citation.parse!`, its refusals in the same order. */
export function parseCitation(
	raw: string,
): { ok: true; citation: Citation } | { ok: false; code: CitationRejection } {
	const value = raw.trim();

	if (value === "") {
		return { ok: false, code: "source_required" };
	}

	if (lengthOf(value) > CITATION_MAX_LENGTH) {
		return { ok: false, code: "source_too_long" };
	}

	if (ESTIMATED_MARKER.test(value) && !value.startsWith(ESTIMATED_PREFIX)) {
		return { ok: false, code: "estimated_prefix" };
	}

	const suffix = GRADE_SUFFIX.exec(value);

	if (suffix !== null && !isGrade(suffix.groups?.["grade"])) {
		return { ok: false, code: "unknown_grade" };
	}

	// A line break fails it, as Ruby's `.` matches none either.
	const match = FORMAT.exec(value);

	if (match === null) {
		return { ok: false, code: "source_invalid" };
	}

	// `text` takes at least one character whenever the pattern matches.
	const text = String(match.groups?.["text"]).trim();

	if (lengthOf(text) < MIN_TEXT_LENGTH) {
		return { ok: false, code: "no_document_named" };
	}

	const estimated = match.groups?.["estimated"] !== undefined;
	const grade = match.groups?.["grade"];

	if (estimated && grade === undefined) {
		return { ok: false, code: "estimate_without_grade" };
	}

	return {
		ok: true,
		citation: { source: value, citation: text, estimated, grade: isGrade(grade) ? grade : null },
	};
}

/**
 * Sure's `merged_notes`: re-recording a date keeps what the notes hold and
 * appends the citation below it, since a line the tool wrote cannot be told
 * from one the owner wrote, and guessing wrong would destroy the only copy.
 * A citation already on one of its lines is not added twice.
 */
export function mergedNotes(existing: string | null, source: string): string {
	const kept = (existing ?? "").trim();

	if (kept === "") {
		return source;
	}

	if (kept.split("\n").some((line) => line.trim() === source)) {
		return kept;
	}

	return `${kept}\n\n${source}`;
}
