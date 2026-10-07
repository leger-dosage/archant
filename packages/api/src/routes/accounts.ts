import type { ImportDeps } from "../services/imports.ts";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { AppError } from "../lib/errors.ts";
import { validated } from "../lib/validated.ts";
import { createAccountSchema, updateAccountSchema } from "../schemas/accounts.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { costBasisBodySchema } from "../schemas/holdings.ts";
import { MAX_IMPORT_BODY_BYTES, importUploadSchema } from "../schemas/imports.ts";
import { snapshotBodySchema } from "../schemas/snapshots.ts";
import { tradeBodySchema, tradePageQuerySchema } from "../schemas/trades.ts";
import { pageQuerySchema, transactionBodySchema } from "../schemas/transactions.ts";
import {
	createAccount,
	deleteAccount,
	getAccount,
	listAccounts,
	updateAccount,
} from "../services/accounts.ts";
import { getBalanceHistory } from "../services/balances.ts";
import { listPositions, setCostBasis, unlockCostBasis } from "../services/holdings.ts";
import { createImport, listImports } from "../services/imports.ts";
import { loanSchedule } from "../services/loans.ts";
import { createSnapshot, listAccountSnapshots } from "../services/snapshots.ts";
import { createTrade, listAccountTrades } from "../services/trades.ts";
import { createTransaction, listAccountTransactions } from "../services/transactions.ts";

export function accountsRoutes(deps: ImportDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listAccounts(deps) }, 200))
		.post("/", validated("json", createAccountSchema), async (c) =>
			c.json({ data: await createAccount(deps, c.req.valid("json")) }, 201),
		)
		.get("/:id", async (c) => c.json({ data: await getAccount(deps, c.req.param("id")) }, 200))
		.patch("/:id", validated("json", updateAccountSchema), async (c) =>
			c.json({ data: await updateAccount(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteAccount(deps, c.req.param("id")) }, 200),
		)
		.get("/:id/balances", validated("query", balanceQuerySchema), async (c) =>
			c.json(
				{
					data: await getBalanceHistory(deps, c.req.param("id"), c.req.valid("query").period),
				},
				200,
			),
		)
		.get("/:id/transactions", validated("query", pageQuerySchema), async (c) =>
			c.json(
				{
					data: await listAccountTransactions(deps, c.req.param("id"), c.req.valid("query")),
				},
				200,
			),
		)
		.post("/:id/transactions", validated("json", transactionBodySchema), async (c) =>
			c.json({ data: await createTransaction(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		)
		.get("/:id/snapshots", validated("query", pageQuerySchema), async (c) =>
			c.json(
				{ data: await listAccountSnapshots(deps, c.req.param("id"), c.req.valid("query")) },
				200,
			),
		)
		.post("/:id/snapshots", validated("json", snapshotBodySchema), async (c) =>
			c.json({ data: await createSnapshot(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		)
		.get("/:id/trades", validated("query", tradePageQuerySchema), async (c) =>
			c.json({ data: await listAccountTrades(deps, c.req.param("id"), c.req.valid("query")) }, 200),
		)
		.post("/:id/trades", validated("json", tradeBodySchema), async (c) =>
			c.json({ data: await createTrade(deps, c.req.param("id"), c.req.valid("json")) }, 201),
		)
		.get("/:id/holdings", async (c) =>
			c.json({ data: await listPositions(deps, c.req.param("id")) }, 200),
		)
		.get("/:id/schedule", async (c) =>
			c.json({ data: await loanSchedule(deps, c.req.param("id")) }, 200),
		)
		.put(
			"/:id/holdings/:securityId/cost-basis",
			validated("json", costBasisBodySchema),
			async (c) =>
				c.json(
					{
						data: await setCostBasis(
							deps,
							c.req.param("id"),
							c.req.param("securityId"),
							c.req.valid("json"),
						),
					},
					200,
				),
		)
		.delete("/:id/holdings/:securityId/cost-basis", async (c) =>
			c.json(
				{ data: await unlockCostBasis(deps, c.req.param("id"), c.req.param("securityId")) },
				200,
			),
		)
		.get("/:id/imports", validated("query", pageQuerySchema), async (c) =>
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
			validated("form", importUploadSchema),
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
