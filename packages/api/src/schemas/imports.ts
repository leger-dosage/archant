import { z } from "zod";

import { EARLIEST_OPENING_DATE } from "./accounts.ts";

/**
 * The largest file an import accepts: far above a decade of a household's
 * statements, and a hard stop before `ofx-js`, whose SGML conversion slows
 * down exponentially on long tag names.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// A multipart body carries its boundaries and headers besides the file; the
// file's own size is checked against MAX_IMPORT_BYTES after parsing.
export const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_BYTES + 64 * 1024;

/** `multipart/form-data` with one `file` field (AD-15). */
export const importUploadSchema = z.object({ file: z.instanceof(File) });

/**
 * A new preview of a stored import. `moveOpeningDate` accepts the offer to
 * move the account's opening date back; `null` withdraws it.
 */
export const importPreviewSchema = z.object({
	// As at account creation: an opening in year 1 would write a balance row
	// for every day since.
	moveOpeningDate: z.iso
		.date()
		.refine((date) => date >= EARLIEST_OPENING_DATE, "date_too_early")
		.nullable(),
});

export type ImportPreviewInput = z.input<typeof importPreviewSchema>;
