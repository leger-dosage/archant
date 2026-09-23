/**
 * The comparable form of a label: lower case, no accents, single spaces. Used
 * by fingerprints (AD-7), and later by merchants and recurring detection, so
 * two sources that print « Électricité » and « ELECTRICITE » agree.
 */
export function normalizeLabel(label: string): string {
	return label
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * A label with its ends trimmed and every run of whitespace turned into one
 * space, as Sure's `squish`. Case and accents stay: a rule compares with them.
 */
export function squishLabel(label: string): string {
	return label.replace(/\s+/gu, " ").trim();
}
