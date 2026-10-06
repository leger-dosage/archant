import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { candidatesQuerySchema, declareBodySchema } from "../schemas/bills.ts";
import {
	addRecurringSchema,
	attachPaymentSchema,
	recurringPatchSchema,
} from "../schemas/recurring.ts";
import { billCandidates, declareBill, patchRecurring } from "../services/recurring/bills.ts";
import { attachEntry, confirmPayment, rejectPayment } from "../services/recurring/payments.ts";
import { runRecurring } from "../services/recurring/pipeline.ts";
import {
	addRecurringFromEntry,
	cleanupRecurring,
	deleteRecurring,
	listRecurring,
	recurringOfEntry,
} from "../services/recurring/series.ts";

export function recurringRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listRecurring(deps) }, 200))
		.post("/", validated("json", addRecurringSchema), async (c) =>
			c.json({ data: await addRecurringFromEntry(deps, c.req.valid("json").entryId) }, 200),
		)
		.get("/candidates", validated("query", candidatesQuerySchema), async (c) =>
			c.json({ data: await billCandidates(deps, c.req.valid("query").kind) }, 200),
		)
		.post("/declare", validated("json", declareBodySchema), async (c) =>
			c.json({ data: await declareBill(deps, c.req.valid("json")) }, 201),
		)
		.get("/by-entry/:entryId", async (c) =>
			c.json({ data: await recurringOfEntry(deps, c.req.param("entryId")) }, 200),
		)
		.patch("/:id", validated("json", recurringPatchSchema), async (c) => {
			const data = await patchRecurring(deps, c.req.param("id"), c.req.valid("json"));

			return c.json({ data }, 200);
		})
		.delete("/:id", async (c) =>
			c.json({ data: await deleteRecurring(deps, c.req.param("id")) }, 200),
		)
		.post("/detect", async (c) =>
			c.json({ data: await runRecurring(deps, { backfill: true }) }, 200),
		)
		.post("/cleanup", async (c) => c.json({ data: await cleanupRecurring(deps) }, 200))
		.post("/payments/:id/confirm", async (c) =>
			c.json({ data: await confirmPayment(deps, c.req.param("id")) }, 200),
		)
		.post("/payments/:id/reject", async (c) =>
			c.json({ data: await rejectPayment(deps, c.req.param("id")) }, 200),
		)
		.post("/occurrences/:id/payments", validated("json", attachPaymentSchema), async (c) =>
			c.json(
				{ data: await attachEntry(deps, c.req.param("id"), c.req.valid("json").entryId) },
				201,
			),
		);
}
