import type { ExportDeps } from "../services/export.ts";

import { Hono } from "hono";

import { exportArchive } from "../services/export.ts";
import { requireRole } from "./middleware/roles.ts";

/**
 * « Exporter mes données »: the archive, streamed as it is built. Outside
 * the `{ data }` envelope, like `/api/auth/*`, and outside compression: a ZIP
 * is deflated already. The interface downloads it through a plain link, so
 * the browser saves it under its name without holding it in memory. An
 * administrator's only (AD-21): the whole household leaves in one file.
 */
export function exportRoutes(deps: ExportDeps) {
	return new Hono().get("/", requireRole("admin"), async (c) => {
		const { fileName, body } = exportArchive(deps);

		return c.body(body, 200, {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${fileName}"`,
			// Every figure of the household: no shared cache, nor the browser's, keeps a copy.
			"Cache-Control": "no-store",
		});
	});
}
