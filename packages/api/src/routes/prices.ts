import type { PriceDeps } from "../services/securities.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { priceSettingsSchema } from "../schemas/prices.ts";
import { priceStatus, setPricesEnabled, updatePrices } from "../services/prices.ts";
import { requireRole } from "./middleware/roles.ts";

/**
 * « Réglages › Placements ». Only an administrator manages price fetching (AD-21).
 */
export function pricesRoutes(deps: PriceDeps) {
	return (
		new Hono()
			.use(requireRole("admin"))
			.get("/", async (c) => c.json({ data: await priceStatus(deps) }, 200))
			.put("/settings", validated("json", priceSettingsSchema), async (c) =>
				c.json({ data: await setPricesEnabled(deps, c.req.valid("json").enabled) }, 200),
			)
			// A `POST`, never a read (AD-21): it writes prices, and it answers once
			// they are written, as the bank's « Synchroniser » does.
			.post("/update", async (c) => c.json({ data: await updatePrices(deps) }, 200))
	);
}
