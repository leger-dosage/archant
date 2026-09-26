/**
 * A name folded as the API compares names: `name_taken` ignores case but not
 * accents, so « Été » and « Ete » are two tags.
 */
export function nameKey(name: string): string {
	return name.trim().normalize("NFC").toLocaleLowerCase("fr");
}

/**
 * Whether a combobox offers « Créer » for what is typed: a name no row holds
 * yet, within the length the API accepts.
 */
export function isNewName(typed: string, names: readonly string[], maxLength: number): boolean {
	const trimmed = typed.trim();
	const key = nameKey(trimmed);

	return (
		trimmed !== "" &&
		trimmed.normalize("NFC").length <= maxLength &&
		!names.some((name) => nameKey(name) === key)
	);
}
