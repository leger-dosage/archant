function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

/**
 * A combobox filter, case and accents aside, in list order: `Enter` picks the
 * first match as the user reads it. cmdk matches on an item's value, an id
 * here, so the name is read from the keywords; the `pinned` values, such as
 * « Créer », name exactly what was typed and always match.
 */
export function filterByName(
	pinned: readonly string[],
): (value: string, search: string, keywords?: string[]) => number {
	return (value, search, keywords = []) =>
		pinned.includes(value) || matchesSearch(keywords.join(" "), search) ? 1 : 0;
}

/** Whether a text matches what is typed, case and accents aside, word by word. */
export function matchesSearch(text: string, query: string): boolean {
	const haystack = fold(text);

	return fold(query)
		.split(/\s+/u)
		.filter((word) => word !== "")
		.every((word) => haystack.includes(word));
}
