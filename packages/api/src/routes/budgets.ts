import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import {
	budgetBodySchema,
	budgetCategoryBodySchema,
	budgetCategoryParamSchema,
	budgetMoveBodySchema,
	budgetParamSchema,
} from "../schemas/budgets.ts";
import {
	copyBudget,
	getBudget,
	moveCategoryBudget,
	saveBudget,
	saveCategoryBudget,
} from "../services/budgets.ts";

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
		)
		.put(
			"/:month/categories/:categoryId",
			validated("param", budgetCategoryParamSchema),
			validated("json", budgetCategoryBodySchema),
			async (c) => {
				const { month, categoryId } = c.req.valid("param");

				return c.json(
					{ data: await saveCategoryBudget(deps, month, categoryId, c.req.valid("json")) },
					200,
				);
			},
		)
		.post("/:month/copy", validated("param", budgetParamSchema), async (c) =>
			c.json({ data: await copyBudget(deps, c.req.valid("param").month) }, 200),
		)
		.post(
			"/:month/move",
			validated("param", budgetParamSchema),
			validated("json", budgetMoveBodySchema),
			async (c) =>
				c.json(
					{
						data: await moveCategoryBudget(deps, c.req.valid("param").month, c.req.valid("json")),
					},
					200,
				),
		);
}
