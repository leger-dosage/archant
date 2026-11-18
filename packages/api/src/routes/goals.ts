import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { goalBodySchema, goalEventParamSchema, goalSpendSchema } from "../schemas/goals.ts";
import {
	createGoal,
	deleteGoal,
	getGoal,
	getGoalHistory,
	getGoalOutflows,
	getGoalsOverview,
	getGoalsSummary,
	listGoals,
	spendGoal,
	transitionGoal,
	updateGoal,
} from "../services/goals.ts";
import { requireRole } from "./middleware/roles.ts";

export function goalsRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", async (c) => c.json({ data: await listGoals(deps) }, 200))
			// Before `/:id`, which would otherwise read these as a goal's id.
			.get("/summary", async (c) => c.json({ data: await getGoalsSummary(deps) }, 200))
			.get("/overview", async (c) => c.json({ data: await getGoalsOverview(deps) }, 200))
			.get("/:id", async (c) => c.json({ data: await getGoal(deps, c.req.param("id")) }, 200))
			.get("/:id/history", async (c) =>
				c.json({ data: await getGoalHistory(deps, c.req.param("id")) }, 200),
			)
			.get("/:id/outflows", requireRole("admin"), async (c) =>
				c.json({ data: await getGoalOutflows(deps, c.req.param("id")) }, 200),
			)
			.post("/:id/consume", validated("json", goalSpendSchema), async (c) =>
				c.json({ data: await spendGoal(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.post("/", validated("json", goalBodySchema), async (c) =>
				c.json({ data: await createGoal(deps, c.req.valid("json")) }, 201),
			)
			.post("/:id/:event", validated("param", goalEventParamSchema), async (c) => {
				const { id, event } = c.req.valid("param");

				return c.json({ data: await transitionGoal(deps, id, event) }, 200);
			})
			.put("/:id", validated("json", goalBodySchema), async (c) =>
				c.json({ data: await updateGoal(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.delete("/:id", async (c) => c.json({ data: await deleteGoal(deps, c.req.param("id")) }, 200))
	);
}
