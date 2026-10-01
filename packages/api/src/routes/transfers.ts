import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { transferBodySchema } from "../schemas/transfers.ts";
import { createTransfer, deleteTransfer, rejectTransfer } from "../services/transfers.ts";

export function transfersRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.post("/", validated("json", transferBodySchema), async (c) =>
				c.json({ data: await createTransfer(deps, c.req.valid("json")) }, 201),
			)
			.delete("/:id", async (c) =>
				c.json({ data: await deleteTransfer(deps, c.req.param("id")) }, 200),
			)
			// Answered as the delete: the pair is gone either way, and the interface
			// refreshes the same rows.
			.post("/:id/reject", async (c) =>
				c.json({ data: await rejectTransfer(deps, c.req.param("id")) }, 200),
			)
	);
}
