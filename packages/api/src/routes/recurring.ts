import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { addRecurringSchema, recurringStatusSchema } from "../schemas/recurring.ts";
import {
	addRecurringFromEntry,
	cleanupRecurring,
	deleteRecurring,
	detectRecurring,
	listRecurring,
	recurringOfEntry,
	setRecurringStatus,
} from "../services/recurring/series.ts";

export function recurringRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listRecurring(deps) }, 200))
		.post("/", validated("json", addRecurringSchema), async (c) =>
			c.json({ data: await addRecurringFromEntry(deps, c.req.valid("json").entryId) }, 200),
		)
		.get("/by-entry/:entryId", async (c) =>
			c.json({ data: await recurringOfEntry(deps, c.req.param("entryId")) }, 200),
		)
		.patch("/:id", validated("json", recurringStatusSchema), async (c) =>
			c.json(
				{
					data: await setRecurringStatus(deps, c.req.param("id"), c.req.valid("json").status),
				},
				200,
			),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteRecurring(deps, c.req.param("id")) }, 200),
		)
		.post("/detect", async (c) => c.json({ data: await detectRecurring(deps) }, 200))
		.post("/cleanup", async (c) => c.json({ data: await cleanupRecurring(deps) }, 200));
}
