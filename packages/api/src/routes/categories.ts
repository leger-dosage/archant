import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
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
		.post(
			"/",
			zValidator("json", createCategorySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => c.json({ data: await createCategory(deps, c.req.valid("json")) }, 201),
		)
		.patch(
			"/:id",
			zValidator("json", updateCategorySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await updateCategory(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete(
			"/:id",
			zValidator("query", deleteCategoryQuerySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{
						data: await deleteCategory(deps, c.req.param("id"), c.req.valid("query").replacementId),
					},
					200,
				),
		)
		.post(
			"/:id/merge",
			zValidator("json", mergeCategorySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{ data: await mergeCategory(deps, c.req.param("id"), c.req.valid("json").targetId) },
					200,
				),
		);
}
