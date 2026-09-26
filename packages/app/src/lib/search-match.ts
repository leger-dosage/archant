function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

/** Whether a text matches what is typed, case and accents aside, word by word. */
export function matchesSearch(text: string, query: string): boolean {
	const haystack = fold(text);

	return fold(query)
		.split(/\s+/u)
		.filter((word) => word !== "")
		.every((word) => haystack.includes(word));
}
