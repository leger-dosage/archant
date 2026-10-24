import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { deleteTagQuerySchema, tagSchema } from "../schemas/tags.ts";
import { createTag, deleteAllTags, deleteTag, listTags, updateTag } from "../services/tags.ts";

export function tagsRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", async (c) => c.json({ data: await listTags(deps) }, 200))
			.post("/", validated("json", tagSchema), async (c) =>
				c.json({ data: await createTag(deps, c.req.valid("json")) }, 201),
			)
			// Sure's `destroy_all`.
			.delete("/", async (c) => c.json({ data: await deleteAllTags(deps) }, 200))
			.patch("/:id", validated("json", tagSchema), async (c) =>
				c.json({ data: await updateTag(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.delete("/:id", validated("query", deleteTagQuerySchema), async (c) =>
				c.json(
					{
						data: await deleteTag(deps, c.req.param("id"), c.req.valid("query").replacementId),
					},
					200,
				),
			)
	);
}
