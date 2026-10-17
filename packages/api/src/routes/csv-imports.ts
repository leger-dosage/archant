import type { CsvImportDeps, CsvImportRequest } from "../services/csv-import.ts";
import type { z } from "zod";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { validated } from "../lib/validated.ts";
import { MAX_CSV_BYTES, csvImportUploadSchema } from "../schemas/csv-imports.ts";
import { importCsv, previewCsvImport } from "../services/csv-import.ts";
import { tooLarge } from "../services/sure-import-preflight.ts";

/** A multipart body carries its boundary, its headers and the choices besides the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

async function requestOf(form: z.output<typeof csvImportUploadSchema>): Promise<CsvImportRequest> {
	return {
		type: form.type,
		file: { name: form.file.name, bytes: new Uint8Array(await form.file.arrayBuffer()) },
		configuration: form.configuration,
		mappings: form.mappings,
	};
}

/**
 * « Importer les comptes », « les catégories », « des marchands », « les
 * règles » and « les investissements »: one CSV file with its choices, sent
 * by the page at each step. The preview writes nothing; the import writes
 * everything or nothing. A viewer's post is refused before either runs (AD-21).
 */
export function csvImportsRoutes(deps: CsvImportDeps) {
	// Refused before the body is read, so a file over the limit costs nothing.
	const limit = bodyLimit({
		maxSize: MAX_CSV_BYTES + MULTIPART_OVERHEAD_BYTES,
		onError: () => {
			throw tooLarge({ maxBytes: MAX_CSV_BYTES, maxRows: 0 });
		},
	});

	return new Hono()
		.post("/preview", limit, validated("form", csvImportUploadSchema), async (c) =>
			c.json({ data: await previewCsvImport(deps, await requestOf(c.req.valid("form"))) }, 200),
		)
		.post("/", limit, validated("form", csvImportUploadSchema), async (c) =>
			c.json({ data: await importCsv(deps, await requestOf(c.req.valid("form"))) }, 201),
		);
}
