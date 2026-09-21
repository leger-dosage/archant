import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { transactionPatchBodySchema } from "../schemas/transactions.ts";
import { deleteTransaction, updateTransaction } from "../services/transactions.ts";

export function transactionsRoutes(deps: ServiceDeps) {
	return new Hono()
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
		);
}
