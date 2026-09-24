import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { detectRecurring } from "../services/recurring.ts";

export function recurringRoutes(deps: ServiceDeps) {
	return new Hono().post("/detect", async (c) =>
		c.json({ data: await detectRecurring(deps) }, 200),
	);
}
