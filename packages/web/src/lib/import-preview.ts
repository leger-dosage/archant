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

/** What step 7 does with the file's closing balance; `null` when it has none. */
export type BalanceStatus = "recorded" | "present" | "kept" | "skipped" | null;

/**
 * Whether confirming writes anything: a line, or the closing balance, which
 * counts as something to write as in Sure, where an import without new rows
 * still publishes.
 */
export function canConfirm(counts: ImportCounts, balance: BalanceStatus): boolean {
	return importedCount(counts) > 0 || balance === "recorded";
}

/** Whether confirming writes the closing balance alone, labelled « Enregistrer le solde ». */
export function isBalanceOnly(counts: ImportCounts, balance: BalanceStatus): boolean {
	return importedCount(counts) === 0 && balance === "recorded";
}

/**
 * Whether the file brings nothing because the account already holds every
 * readable line and nothing else would be written. A file whose lines are
 * all rejected, or empty, is not that.
 */
export function isNothingNew(counts: ImportCounts, balance: BalanceStatus): boolean {
	return !canConfirm(counts, balance) && counts.present > 0;
}

/** How many records the Colonnes step shows under its header. */
export const CSV_TABLE_ROWS = 10;

const isEmptyRecord = (record: readonly string[]) => record.every((cell) => cell.trim() === "");

/**
 * The sample split with another delimiter, for display only. The server split
 * it with the one it last read the file with; until a valid mapping lets it
 * read the file again, rejoining and splitting is close enough to show the
 * columns the user is choosing from. Quotes are lost on the way, which only a
 * delimiter inside a quoted cell would notice.
 */
export function resplit(records: string[][], from: string, to: string): string[][] {
	return from === to ? records : records.map((record) => record.join(from).split(to));
}

export type CsvTable = { header: string[] | null; rows: string[][]; width: number };

/**
 * What the Colonnes step shows, read as the parser reads the file: the record
 * right after `skipRows` is the header when there is one, then the first
 * non-empty records.
 */
export function csvTable(
	sample: string[][],
	sampleDelimiter: string,
	mapping: { delimiter: string; skipRows: number; hasHeader: boolean },
): CsvTable {
	const records = resplit(sample, sampleDelimiter, mapping.delimiter).slice(mapping.skipRows);
	const header = mapping.hasHeader ? (records[0] ?? null) : null;
	const rows = records
		.slice(mapping.hasHeader ? 1 : 0)
		.filter((record) => !isEmptyRecord(record))
		.slice(0, CSV_TABLE_ROWS);
	const width = [...(header === null ? [] : [header]), ...rows].reduce(
		(widest, record) => Math.max(widest, record.length),
		0,
	);

	return { header, rows, width };
}

/** The roles padded with `ignore` up to `width`; a role beyond it is kept. */
export function fitColumns<Role extends string>(
	columns: readonly Role[],
	width: number,
	ignore: Role,
): Role[] {
	return Array.from(
		{ length: Math.max(width, columns.length) },
		(_, index) => columns[index] ?? ignore,
	);
}

/** Whether two mappings read a file the same way. */
export function sameMapping(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
