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
