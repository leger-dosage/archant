import type { PriceDeps } from "../services/securities.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { securitySearchSchema, typedPriceBodySchema } from "../schemas/prices.ts";
import { typePrice } from "../services/prices.ts";
import { searchSecurities } from "../services/securities.ts";
import { requireRole } from "./middleware/roles.ts";

/**
 * The provider's search for Story 22.2's trade form, and « Saisir un cours »
 * for a security no provider prices. The search's role is checked before the
 * query is read, so a viewer gets its refusal, never a 400; the write is a
 * viewer's to be refused by `viewerReadOnly` (AD-21).
 */
export function securitiesRoutes(deps: PriceDeps) {
	return new Hono()
		.get("/", requireRole("admin"), validated("query", securitySearchSchema), async (c) =>
			c.json({ data: await searchSecurities(deps, c.req.valid("query").q) }, 200),
		)
		.post("/:id/prices", validated("json", typedPriceBodySchema), async (c) =>
			c.json({ data: await typePrice(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		);
}
