import type { SureImportLimits } from "../services/sure-import-preflight.ts";
import type { SureImportDeps } from "../services/sure-import.ts";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { validated } from "../lib/validated.ts";
import { importUploadSchema } from "../schemas/imports.ts";
import { tooLarge } from "../services/sure-import-preflight.ts";
import {
	DEFAULT_SURE_IMPORT_LIMITS,
	importSureArchive,
	preflightSureImport,
} from "../services/sure-import.ts";

/** A multipart body carries its boundary and headers besides the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

async function uploaded(file: File) {
	return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * « Importer depuis Sure »: the `all.ndjson` of a Sure or an Archant export,
 * `multipart/form-data` with one `file`, sent twice by the page. The
 * preflight writes nothing; the import writes everything or nothing. A
 * viewer's post is refused before either runs (AD-21).
 */
export function sureImportsRoutes(
	deps: SureImportDeps & { sureImport?: SureImportLimits | undefined },
) {
	const limits = deps.sureImport ?? DEFAULT_SURE_IMPORT_LIMITS;
	// Refused before the body is read, so a file over the limit costs nothing.
	const limit = bodyLimit({
		maxSize: limits.maxBytes + MULTIPART_OVERHEAD_BYTES,
		onError: () => {
			throw tooLarge(limits);
		},
	});

	return new Hono()
		.post("/preflight", limit, validated("form", importUploadSchema), async (c) =>
			c.json(
				{
					data: await preflightSureImport(deps, await uploaded(c.req.valid("form").file), limits),
				},
				200,
			),
		)
		.post("/", limit, validated("form", importUploadSchema), async (c) =>
			c.json(
				{ data: await importSureArchive(deps, await uploaded(c.req.valid("form").file), limits) },
				201,
			),
		);
}
