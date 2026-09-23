import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { tagSchema } from "../schemas/tags.ts";
import { createTag, deleteTag, listTags, renameTag } from "../services/tags.ts";

export function tagsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listTags(deps) }, 200))
		.post(
			"/",
			zValidator("json", tagSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => c.json({ data: await createTag(deps, c.req.valid("json")) }, 201),
		)
		.patch(
			"/:id",
			zValidator("json", tagSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await renameTag(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) => c.json({ data: await deleteTag(deps, c.req.param("id")) }, 200));
}
