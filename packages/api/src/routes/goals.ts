import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { goalBodySchema } from "../schemas/goals.ts";
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from "../services/goals.ts";

export function goalsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listGoals(deps) }, 200))
		.get("/:id", async (c) => c.json({ data: await getGoal(deps, c.req.param("id")) }, 200))
		.post("/", validated("json", goalBodySchema), async (c) =>
			c.json({ data: await createGoal(deps, c.req.valid("json")) }, 201),
		)
		.put("/:id", validated("json", goalBodySchema), async (c) =>
			c.json({ data: await updateGoal(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) => c.json({ data: await deleteGoal(deps, c.req.param("id")) }, 200));
}
