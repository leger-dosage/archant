import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { transferBodySchema } from "../schemas/transfers.ts";
import { createTransfer, deleteTransfer } from "../services/transfers.ts";

export function transfersRoutes(deps: ServiceDeps) {
	return new Hono()
		.post(
			"/",
			zValidator("json", transferBodySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => c.json({ data: await createTransfer(deps, c.req.valid("json")) }, 201),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteTransfer(deps, c.req.param("id")) }, 200),
		);
}
