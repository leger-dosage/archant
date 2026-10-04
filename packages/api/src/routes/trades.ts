import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { tradePatchBodySchema } from "../schemas/trades.ts";
import { deleteTrade, updateTrade } from "../services/trades.ts";

export function tradesRoutes(deps: ServiceDeps) {
	return new Hono()
		.patch("/:id", validated("json", tradePatchBodySchema), async (c) =>
			c.json({ data: await updateTrade(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) => c.json({ data: await deleteTrade(deps, c.req.param("id")) }, 200));
}
