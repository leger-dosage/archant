import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { addRecurringSchema, recurringStatusSchema } from "../schemas/recurring.ts";
import {
	addRecurringFromEntry,
	detectRecurring,
	listRecurring,
	setRecurringStatus,
} from "../services/recurring.ts";

export function recurringRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listRecurring(deps) }, 200))
		.post(
			"/",
			zValidator("json", addRecurringSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await addRecurringFromEntry(deps, c.req.valid("json").entryId) }, 200),
		)
		.patch(
			"/:id",
			zValidator("json", recurringStatusSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{
						data: await setRecurringStatus(deps, c.req.param("id"), c.req.valid("json").status),
					},
					200,
				),
		)
		.post("/detect", async (c) => c.json({ data: await detectRecurring(deps) }, 200));
}
