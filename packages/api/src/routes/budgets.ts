import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import {
	budgetBodySchema,
	budgetCategoryBodySchema,
	budgetCategoryParamSchema,
	budgetMoveBodySchema,
	budgetParamSchema,
	budgetRolloverBodySchema,
} from "../schemas/budgets.ts";
import { budgetOwnerQuery, budgetShareSchema } from "../schemas/sharing.ts";
import {
	budgetAccess,
	budgetChoices,
	budgetDeps,
	saveBudgetShare,
} from "../services/budget-access.ts";
import { getBudgetCash } from "../services/budget-cash.ts";
import {
	copyBudget,
	currentBudgetPeriod,
	getBudget,
	moveCategoryBudget,
	saveBudget,
	saveCategoryBudget,
	setCategoryRollover,
} from "../services/budgets.ts";
import { signedInUser } from "./middleware/roles.ts";

export function budgetsRoutes(deps: ServiceDeps) {
	return new Hono<SessionEnv>()
		.get("/sharing", async (c) =>
			c.json({ data: await budgetChoices(deps, signedInUser(c).id) }, 200),
		)
		.put("/sharing", validated("json", budgetShareSchema), async (c) => {
			const { userId, permission } = c.req.valid("json");
			return c.json(
				{ data: await saveBudgetShare(deps, signedInUser(c).id, userId, permission) },
				200,
			);
		})
		.get("/available-cash", validated("query", budgetOwnerQuery), async (c) =>
			c.json(
				{ data: await getBudgetCash(await budgetDeps(deps, c.req.valid("query").owner)) },
				200,
			),
		)
		.get("/current", async (c) => c.json({ data: await currentBudgetPeriod(deps) }, 200))
		.get(
			"/:month",
			validated("query", budgetOwnerQuery),
			validated("param", budgetParamSchema),
			async (c) => {
				const access = await budgetAccess(deps, c.req.valid("query").owner);
				const budget = await getBudget(
					{ ...deps, budgetOwnerId: access.ownerId },
					c.req.valid("param").month,
				);
				return c.json({ data: { ...budget, ...access } }, 200);
			},
		)
		.put(
			"/:month",
			validated("query", budgetOwnerQuery),
			validated("param", budgetParamSchema),
			validated("json", budgetBodySchema),
			async (c) =>
				c.json(
					{
						data: await saveBudget(
							await budgetDeps(deps, c.req.valid("query").owner, true),
							c.req.valid("param").month,
							c.req.valid("json"),
						),
					},
					200,
				),
		)
		.put(
			"/:month/categories/:categoryId",
			validated("query", budgetOwnerQuery),
			validated("param", budgetCategoryParamSchema),
			validated("json", budgetCategoryBodySchema),
			async (c) => {
				const { month, categoryId } = c.req.valid("param");

				return c.json(
					{
						data: await saveCategoryBudget(
							await budgetDeps(deps, c.req.valid("query").owner, true),
							month,
							categoryId,
							c.req.valid("json"),
						),
					},
					200,
				);
			},
		)
		.put(
			"/:month/categories/:categoryId/rollover",
			validated("query", budgetOwnerQuery),
			validated("param", budgetCategoryParamSchema),
			validated("json", budgetRolloverBodySchema),
			async (c) => {
				const { month, categoryId } = c.req.valid("param");

				return c.json(
					{
						data: await setCategoryRollover(
							await budgetDeps(deps, c.req.valid("query").owner, true),
							month,
							categoryId,
							c.req.valid("json"),
						),
					},
					200,
				);
			},
		)
		.post(
			"/:month/copy",
			validated("query", budgetOwnerQuery),
			validated("param", budgetParamSchema),
			async (c) =>
				c.json(
					{
						data: await copyBudget(
							await budgetDeps(deps, c.req.valid("query").owner, true),
							c.req.valid("param").month,
						),
					},
					200,
				),
		)
		.post(
			"/:month/move",
			validated("query", budgetOwnerQuery),
			validated("param", budgetParamSchema),
			validated("json", budgetMoveBodySchema),
			async (c) =>
				c.json(
					{
						data: await moveCategoryBudget(
							await budgetDeps(deps, c.req.valid("query").owner, true),
							c.req.valid("param").month,
							c.req.valid("json"),
						),
					},
					200,
				),
		);
}
