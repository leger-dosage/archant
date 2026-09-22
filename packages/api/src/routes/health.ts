import type { HealthDeps } from "../services/health.ts";

import { Hono } from "hono";

import { checkHealth } from "../services/health.ts";

export function healthRoutes(deps: HealthDeps) {
	return new Hono().get("/", async (c) => c.json({ data: await checkHealth(deps) }, 200));
}
