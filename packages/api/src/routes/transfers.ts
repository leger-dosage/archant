import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import {
	newTransferBodySchema,
	transferBodySchema,
	transferPatchSchema,
	transferTagsSchema,
} from "../schemas/transfers.ts";
import { markTransferRecurring } from "../services/recurring/bills.ts";
import {
	confirmTransfer,
	createTransfer,
	createTransferBetweenAccounts,
	deleteTransfer,
	getTransfer,
	rejectTransfer,
	setTransferTags,
	updateTransfer,
} from "../services/transfers.ts";

export function transfersRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.post("/", validated("json", transferBodySchema), async (c) =>
				c.json({ data: await createTransfer(deps, c.req.valid("json")) }, 201),
			)
			// A transfer created from « Virement », as Sure's `transfers#create`;
			// the first transfer again, `200`, for a form sent twice.
			.post("/new", validated("json", newTransferBodySchema), async (c) => {
				const { transfer, created } = await createTransferBetweenAccounts(
					deps,
					c.req.valid("json"),
				);

				return created ? c.json({ data: transfer }, 201) : c.json({ data: transfer }, 200);
			})
			// Sure's `transfers#show`, `update` and `update_tags`: the transfer's drawer.
			.get("/:id", async (c) => c.json({ data: await getTransfer(deps, c.req.param("id")) }, 200))
			.patch("/:id", validated("json", transferPatchSchema), async (c) =>
				c.json({ data: await updateTransfer(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.put("/:id/tags", validated("json", transferTagsSchema), async (c) =>
				c.json(
					{ data: await setTransferTags(deps, c.req.param("id"), c.req.valid("json").tagIds) },
					200,
				),
			)
			.delete("/:id", async (c) =>
				c.json({ data: await deleteTransfer(deps, c.req.param("id")) }, 200),
			)
			.post("/:id/confirm", async (c) =>
				c.json({ data: await confirmTransfer(deps, c.req.param("id")) }, 200),
			)
			// Answered as the delete: the pair is gone either way, and the interface
			// refreshes the same rows.
			.post("/:id/reject", async (c) =>
				c.json({ data: await rejectTransfer(deps, c.req.param("id")) }, 200),
			)
			// Sure's `mark_as_recurring`: a recurring transfer from this one.
			.post("/:id/recurring", async (c) =>
				c.json({ data: await markTransferRecurring(deps, c.req.param("id")) }, 201),
			)
	);
}
