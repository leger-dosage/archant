import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import {
	bulkDeleteBodySchema,
	bulkUpdateBodySchema,
	transactionFilterSchema,
	transactionPatchBodySchema,
} from "../schemas/transactions.ts";
import {
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	deleteTransaction,
	listAllTransactions,
	updateTransaction,
} from "../services/transactions.ts";

export function transactionsRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get(
				"/",
				zValidator("query", transactionFilterSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await listAllTransactions(deps, c.req.valid("query")) }, 200),
			)
			// Before `/:id`, and POST rather than PATCH or DELETE: a body with a
			// filter is not a resource path, and a DELETE body is often dropped.
			.post(
				"/bulk-update",
				zValidator("json", bulkUpdateBodySchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await bulkUpdateTransactions(deps, c.req.valid("json")) }, 200),
			)
			.post(
				"/bulk-delete",
				zValidator("json", bulkDeleteBodySchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await bulkDeleteTransactions(deps, c.req.valid("json")) }, 200),
			)
			.patch(
				"/:id",
				zValidator("json", transactionPatchBodySchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) =>
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
