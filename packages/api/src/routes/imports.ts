import type { ImportDeps } from "../services/imports.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { importPreviewSchema } from "../schemas/imports.ts";
import { confirmImport, previewImport, revertImport } from "../services/imports.ts";

// Uploading lives under the account (`POST /accounts/:id/imports`): a file
// always targets one account.
export function importsRoutes(deps: ImportDeps) {
	return new Hono()
		.post(
			"/:id/preview",
			zValidator("json", importPreviewSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await previewImport(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.post("/:id/confirm", async (c) =>
			c.json({ data: await confirmImport(deps, c.req.param("id")) }, 200),
		)
		.post("/:id/revert", async (c) =>
			c.json({ data: await revertImport(deps, c.req.param("id")) }, 200),
		);
}
