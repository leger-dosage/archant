import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { budgetBodySchema, budgetParamSchema } from "../schemas/budgets.ts";
import { getBudget, saveBudget } from "../services/budgets.ts";

export function budgetsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/:month", validated("param", budgetParamSchema), async (c) =>
			c.json({ data: await getBudget(deps, c.req.valid("param").month) }, 200),
		)
		.put(
			"/:month",
			validated("param", budgetParamSchema),
			validated("json", budgetBodySchema),
			async (c) =>
				c.json(
					{ data: await saveBudget(deps, c.req.valid("param").month, c.req.valid("json")) },
					200,
				),
		);
}
