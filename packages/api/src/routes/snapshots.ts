import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { snapshotPatchBodySchema } from "../schemas/snapshots.ts";
import { deleteSnapshot, updateSnapshot } from "../services/snapshots.ts";

export function snapshotsRoutes(deps: ServiceDeps) {
	return new Hono()
		.patch("/:id", validated("json", snapshotPatchBodySchema), async (c) =>
			c.json({ data: await updateSnapshot(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteSnapshot(deps, c.req.param("id")) }, 200),
		);
}
