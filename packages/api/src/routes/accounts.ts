import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { createAccountSchema } from "../schemas/accounts.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { snapshotBodySchema } from "../schemas/snapshots.ts";
import { pageQuerySchema, transactionBodySchema } from "../schemas/transactions.ts";
import { createAccount, getAccount, listAccounts } from "../services/accounts.ts";
import { getBalanceHistory } from "../services/balances.ts";
import { createSnapshot, listAccountSnapshots } from "../services/snapshots.ts";
import { createTransaction, listAccountTransactions } from "../services/transactions.ts";

export function accountsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listAccounts(deps) }, 200))
		.post(
			"/",
			zValidator("json", createAccountSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => c.json({ data: await createAccount(deps, c.req.valid("json")) }, 201),
		)
		.get("/:id", async (c) => c.json({ data: await getAccount(deps, c.req.param("id")) }, 200))
		.get(
			"/:id/balances",
			zValidator("query", balanceQuerySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{
						data: await getBalanceHistory(deps, c.req.param("id"), c.req.valid("query").period),
					},
					200,
				),
		)
		.get(
			"/:id/transactions",
			zValidator("query", pageQuerySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{
						data: await listAccountTransactions(deps, c.req.param("id"), c.req.valid("query")),
					},
					200,
				),
		)
		.post(
			"/:id/transactions",
			zValidator("json", transactionBodySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{ data: await createTransaction(deps, c.req.param("id"), c.req.valid("json")) },
					201,
				),
		)
		.get(
			"/:id/snapshots",
			zValidator("query", pageQuerySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{ data: await listAccountSnapshots(deps, c.req.param("id"), c.req.valid("query")) },
					200,
				),
		)
		.post(
			"/:id/snapshots",
			zValidator("json", snapshotBodySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await createSnapshot(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		);
}
