import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { categorySetOnOutflow } from "@archant/data/transfer-kinds";

import { AppError } from "../lib/errors.ts";
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
	getTransaction,
	listAllTransactions,
	listDuplicateCandidates,
	mergeDuplicate,
	splitTransaction,
	transactionTotals,
	unlockTransaction,
	unsplitTransaction,
	updateTransaction,
} from "../services/transactions.ts";
import { listTransferCandidates } from "../services/transfers.ts";

/**
 * Refuses a category on the inflow of a loan payment or a contribution, as
 * Sure's `7e1d93613`: its category belongs to the outflow, which budgets
 * count once, and one picked here would look saved but count nowhere. The
 * interface's route only: an assistant's `update_transaction`, as Sure's,
 * goes through the service unguarded.
 */
async function refuseCategoryOnInflow(deps: ServiceDeps, id: string): Promise<void> {
	const { amount, transfer } = await getTransaction(deps, id);

	if (categorySetOnOutflow(amount, transfer)) {
		throw new AppError("VALIDATION_ERROR", "This category is set on the transfer's outflow.", [
			{ path: "categoryId", code: "set_on_outflow" },
		]);
	}
}

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
			// Sure's `unlock_for_sync!`: every lock at once, none per field.
			.post("/:id/unlock", async (c) =>
				c.json({ data: await unlockTransaction(deps, c.req.param("id")) }, 200),
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
			.patch("/:id", validated("json", transactionPatchBodySchema), async (c) => {
				const id = c.req.param("id");
				const input = c.req.valid("json");

				if (input.categoryId !== undefined) {
					await refuseCategoryOnInflow(deps, id);
				}

				return c.json({ data: await updateTransaction(deps, id, input) }, 200);
			})
			.delete("/:id", async (c) => {
				const id = c.req.param("id");
				await deleteTransaction(deps, id);

				return c.json({ data: { id } }, 200);
			})
	);
}
