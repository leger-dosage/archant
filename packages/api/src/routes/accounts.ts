import type { ImportDeps } from "../services/imports.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { createAccountSchema, updateAccountSchema } from "../schemas/accounts.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { MAX_IMPORT_BODY_BYTES, importUploadSchema } from "../schemas/imports.ts";
import { snapshotBodySchema } from "../schemas/snapshots.ts";
import { pageQuerySchema, transactionBodySchema } from "../schemas/transactions.ts";
import {
	createAccount,
	deleteAccount,
	getAccount,
	listAccounts,
	updateAccount,
} from "../services/accounts.ts";
import { getBalanceHistory } from "../services/balances.ts";
import { createImport, listImports } from "../services/imports.ts";
import { createSnapshot, listAccountSnapshots } from "../services/snapshots.ts";
import { createTransaction, listAccountTransactions } from "../services/transactions.ts";

export function accountsRoutes(deps: ImportDeps) {
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
		.patch(
			"/:id",
			zValidator("json", updateAccountSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await updateAccount(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteAccount(deps, c.req.param("id")) }, 200),
		)
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
		)
		.get(
			"/:id/imports",
			zValidator("query", pageQuerySchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await listImports(deps, c.req.param("id"), c.req.valid("query")) }, 200),
		)
		.post(
			"/:id/imports",
			// Refused before the body is read, so a 50 MB upload costs nothing.
			bodyLimit({
				maxSize: MAX_IMPORT_BODY_BYTES,
				onError: () => {
					throw new AppError("INVALID_IMPORT_FILE", "The file is larger than 5 MB.");
				},
			}),
			zValidator("form", importUploadSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => {
				const { file } = c.req.valid("form");
				const bytes = new Uint8Array(await file.arrayBuffer());

				return c.json(
					{ data: await createImport(deps, c.req.param("id"), { name: file.name, bytes }) },
					201,
				);
			},
		);
}
