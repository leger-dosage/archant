import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import {
	createCategorySchema,
	deleteCategoryQuerySchema,
	mergeCategorySchema,
	updateCategorySchema,
} from "../schemas/categories.ts";
import {
	createCategory,
	deleteCategory,
	listCategories,
	mergeCategory,
	updateCategory,
} from "../services/categories.ts";

export function categoriesRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listCategories(deps) }, 200))
		.post("/", validated("json", createCategorySchema), async (c) =>
			c.json({ data: await createCategory(deps, c.req.valid("json")) }, 201),
		)
		.patch("/:id", validated("json", updateCategorySchema), async (c) =>
			c.json({ data: await updateCategory(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", validated("query", deleteCategoryQuerySchema), async (c) =>
			c.json(
				{
					data: await deleteCategory(deps, c.req.param("id"), c.req.valid("query").replacementId),
				},
				200,
			),
		)
		.post("/:id/merge", validated("json", mergeCategorySchema), async (c) =>
			c.json(
				{ data: await mergeCategory(deps, c.req.param("id"), c.req.valid("json").targetId) },
				200,
			),
		);
}
