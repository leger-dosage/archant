import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { snapshotPatchBodySchema } from "../schemas/snapshots.ts";
import { deleteSnapshot, updateSnapshot } from "../services/snapshots.ts";

export function snapshotsRoutes(deps: ServiceDeps) {
	return new Hono()
		.patch(
			"/:id",
			zValidator("json", snapshotPatchBodySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await updateSnapshot(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteSnapshot(deps, c.req.param("id")) }, 200),
		);
}
