import type { PriceDeps } from "../services/securities.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { securitySearchSchema } from "../schemas/prices.ts";
import { searchSecurities } from "../services/securities.ts";
import { requireRole } from "./middleware/roles.ts";

/**
 * The provider's search for Story 22.2's trade form. The role is checked
 * before the query is read, so a viewer gets its refusal, never a 400.
 */
export function securitiesRoutes(deps: PriceDeps) {
	return new Hono().get(
		"/",
		requireRole("admin"),
		validated("query", securitySearchSchema),
		async (c) => c.json({ data: await searchSecurities(deps, c.req.valid("query").q) }, 200),
	);
}
