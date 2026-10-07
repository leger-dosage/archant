import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { allBillsQuerySchema, candidatesQuerySchema, declareBodySchema } from "../schemas/bills.ts";
import {
	addPaymentSchema,
	addRecurringSchema,
	markPaidSchema,
	occurrencePatchSchema,
	recurringPatchSchema,
} from "../schemas/recurring.ts";
import {
	allBills,
	billCandidates,
	billDetail,
	billsOverview,
	declareBill,
	occurrenceDetail,
	patchRecurring,
	upcomingRecurring,
} from "../services/recurring/bills.ts";
import {
	addPayment,
	confirmPayment,
	editOccurrence,
	markPaid,
	paymentCandidates,
	rejectPayment,
	removePayment,
	reopenOccurrence,
	skipOccurrence,
} from "../services/recurring/payments.ts";
import { runRecurring } from "../services/recurring/pipeline.ts";
import {
	addRecurringFromEntry,
	cleanupRecurring,
	deleteRecurring,
	listRecurring,
	recurringOfEntry,
} from "../services/recurring/series.ts";

// `GET /:id` comes last: registered before them, it would answer `/bills`
// and `/upcoming`.
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
		.delete("/payments/:id", async (c) =>
			c.json({ data: await removePayment(deps, c.req.param("id")) }, 200),
		)
		.get("/bills", async (c) => c.json({ data: await billsOverview(deps) }, 200))
		.get("/bills/all", validated("query", allBillsQuerySchema), async (c) =>
			c.json({ data: await allBills(deps, c.req.valid("query")) }, 200),
		)
		.get("/upcoming", async (c) => c.json({ data: await upcomingRecurring(deps) }, 200))
		.get("/occurrences/:id", async (c) =>
			c.json({ data: await occurrenceDetail(deps, c.req.param("id")) }, 200),
		)
		.get("/occurrences/:id/candidates", async (c) =>
			c.json({ data: await paymentCandidates(deps, c.req.param("id")) }, 200),
		)
		.patch("/occurrences/:id", validated("json", occurrencePatchSchema), async (c) =>
			c.json({ data: await editOccurrence(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.post("/occurrences/:id/paid", validated("json", markPaidSchema), async (c) =>
			c.json({ data: await markPaid(deps, c.req.param("id"), c.req.valid("json").paidOn) }, 200),
		)
		.post("/occurrences/:id/skip", async (c) =>
			c.json({ data: await skipOccurrence(deps, c.req.param("id")) }, 200),
		)
		.post("/occurrences/:id/reopen", async (c) =>
			c.json({ data: await reopenOccurrence(deps, c.req.param("id")) }, 200),
		)
		.post("/occurrences/:id/payments", validated("json", addPaymentSchema), async (c) =>
			c.json({ data: await addPayment(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		)
		.get("/:id", async (c) => c.json({ data: await billDetail(deps, c.req.param("id")) }, 200));
}
