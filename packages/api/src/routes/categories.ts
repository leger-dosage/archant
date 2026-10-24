import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import {
	createCategorySchema,
	deleteCategoryQuerySchema,
	mergeCategoriesSchema,
	updateCategorySchema,
} from "../schemas/categories.ts";
import {
	bootstrapCategories,
	createCategory,
	deleteAllCategories,
	deleteCategory,
	listCategories,
	mergeCategories,
	updateCategory,
} from "../services/categories.ts";

export function categoriesRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", async (c) => c.json({ data: await listCategories(deps) }, 200))
			.post("/", validated("json", createCategorySchema), async (c) =>
				c.json({ data: await createCategory(deps, c.req.valid("json")) }, 201),
			)
			// Sure's `destroy_all` and `bootstrap`, the empty list's way back.
			.delete("/", async (c) => c.json({ data: await deleteAllCategories(deps) }, 200))
			.post("/bootstrap", async (c) => c.json({ data: await bootstrapCategories(deps) }, 200))
			.post("/merge", validated("json", mergeCategoriesSchema), async (c) => {
				const { targetId, sourceIds } = c.req.valid("json");

				return c.json({ data: await mergeCategories(deps, targetId, sourceIds) }, 200);
			})
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
	);
}
