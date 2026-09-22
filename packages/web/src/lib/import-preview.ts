/** The groups of an import preview, in the order of its tabs. */
export const IMPORT_GROUPS = ["created", "present", "matched", "duplicates", "rejected"] as const;

export type ImportGroup = (typeof IMPORT_GROUPS)[number];

export type ImportCounts = Record<ImportGroup, number>;

export function countsOf(groups: Record<ImportGroup, readonly unknown[]>): ImportCounts {
	return {
		created: groups.created.length,
		present: groups.present.length,
		matched: groups.matched.length,
		duplicates: groups.duplicates.length,
		rejected: groups.rejected.length,
	};
}

/**
 * The lines confirming writes something for: the new ones, the possible
 * duplicates, and the matched ones, whose keys it attaches so the next import
 * recognises them.
 */
export function importedCount(counts: ImportCounts): number {
	return counts.created + counts.duplicates + counts.matched;
}

/** The tab a preview opens on: the first group holding a line, « À créer » when none does. */
export function firstTab(counts: ImportCounts): ImportGroup {
	return IMPORT_GROUPS.find((group) => counts[group] > 0) ?? "created";
}

/**
 * Whether the file brings nothing because the account already holds every
 * readable line. A file whose lines are all rejected, or empty, is not that.
 */
export function isNothingNew(counts: ImportCounts): boolean {
	return importedCount(counts) === 0 && counts.present > 0;
}
