import type { CsvImportPreviewData } from "@/hooks/useCsvImport";

type Preview = Pick<CsvImportPreviewData, "clean" | "errors">;

/** The refusals « Mapper » settles, not « Nettoyer ». */
const MAPPING_CODES = new Set(["unmapped_account_type", "unmapped_account"]);

/** The refusals of the file itself: no line to fix them on, and none « Mapper » settles. */
export const fileIssuesOf = (preview: Preview) =>
	preview.errors.filter(
		(issue) => issue.params.line === undefined && !MAPPING_CODES.has(issue.code),
	);

/**
 * Sure's `cleaned?`: every row valid and the file read whole. « Étape
 * suivante » waits for it, and « Confirmer » sends the user back without it.
 */
export const isCleaned = (preview: Preview) =>
	preview.clean.rows.every((row) => row.issues.length === 0) && fileIssuesOf(preview).length === 0;
