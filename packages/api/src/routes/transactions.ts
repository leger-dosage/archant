import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { convertTradeBodySchema } from "../schemas/trades.ts";
import {
	bulkDeleteBodySchema,
	bulkUpdateBodySchema,
	mergeDuplicateBodySchema,
	splitBodySchema,
	transactionFilterSchema,
	transactionPatchBodySchema,
	transactionTotalsSchema,
} from "../schemas/transactions.ts";
import {
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	convertTransaction,
	deleteTransaction,
	dismissDuplicate,
	editSplit,
	getSplit,
	listAllTransactions,
	listDuplicateCandidates,
	mergeDuplicate,
	splitTransaction,
	transactionTotals,
	unsplitTransaction,
	updateTransaction,
} from "../services/transactions.ts";
import { listTransferCandidates } from "../services/transfers.ts";

export function transactionsRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", validated("query", transactionFilterSchema), async (c) =>
				c.json({ data: await listAllTransactions(deps, c.req.valid("query")) }, 200),
			)
			// Before `/:id`. Apart from the page, so turning a page reruns
			// neither the count nor the sums.
			.get("/totals", validated("query", transactionTotalsSchema), async (c) =>
				c.json({ data: await transactionTotals(deps, c.req.valid("query")) }, 200),
			)
			// Before `/:id`, and POST rather than PATCH or DELETE: a body with a
			// filter is not a resource path, and a DELETE body is often dropped.
			.post("/bulk-update", validated("json", bulkUpdateBodySchema), async (c) =>
				c.json({ data: await bulkUpdateTransactions(deps, c.req.valid("json")) }, 200),
			)
			.post("/bulk-delete", validated("json", bulkDeleteBodySchema), async (c) =>
				c.json({ data: await bulkDeleteTransactions(deps, c.req.valid("json")) }, 200),
			)
			.get("/:id/transfer-candidates", async (c) =>
				c.json({ data: await listTransferCandidates(deps, c.req.param("id")) }, 200),
			)
			.get("/:id/duplicate-candidates", async (c) =>
				c.json({ data: await listDuplicateCandidates(deps, c.req.param("id")) }, 200),
			)
			.post("/:id/merge", validated("json", mergeDuplicateBodySchema), async (c) =>
				c.json({ data: await mergeDuplicate(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.post("/:id/dismiss-duplicate", async (c) =>
				c.json({ data: await dismissDuplicate(deps, c.req.param("id")) }, 200),
			)
			// From the parent or a child, as Sure's `resolve_to_parent!`.
			.get("/:id/split", async (c) =>
				c.json({ data: await getSplit(deps, c.req.param("id")) }, 200),
			)
			.post("/:id/split", validated("json", splitBodySchema), async (c) =>
				c.json({ data: await splitTransaction(deps, c.req.param("id"), c.req.valid("json")) }, 201),
			)
			.put("/:id/split", validated("json", splitBodySchema), async (c) =>
				c.json({ data: await editSplit(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.delete("/:id/split", async (c) =>
				c.json({ data: await unsplitTransaction(deps, c.req.param("id")) }, 200),
			)
			// Sure's « Convertir en ordre »: the trade it makes, in the account's « Ordres ».
			.post("/:id/trade", validated("json", convertTradeBodySchema), async (c) =>
				c.json(
					{ data: await convertTransaction(deps, c.req.param("id"), c.req.valid("json")) },
					201,
				),
			)
			.patch("/:id", validated("json", transactionPatchBodySchema), async (c) =>
				c.json(
					{ data: await updateTransaction(deps, c.req.param("id"), c.req.valid("json")) },
					200,
				),
			)
			.delete("/:id", async (c) =>
				c.json({ data: await deleteTransaction(deps, c.req.param("id")) }, 200),
			)
	);
}
