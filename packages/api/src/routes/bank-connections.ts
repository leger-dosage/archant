import type { BankConnectionDeps } from "../services/bank-connections.ts";

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { validated } from "../lib/validated.ts";
import {
	completeConnectionSchema,
	connectionParamSchema,
	institutionsQuerySchema,
	linkBankAccountsSchema,
	saveBankCredentialsSchema,
	startConnectionSchema,
} from "../schemas/bank-connections.ts";
import {
	completeConnection,
	disconnectConnection,
	linkBankAccounts,
	listBankAccounts,
	listConnections,
	listInstitutions,
	renewConnection,
	startConnection,
} from "../services/bank-connections.ts";
import {
	bankSetup,
	resolveBankConnector,
	saveBankCredentials,
} from "../services/bank-credentials.ts";
import { syncConnection } from "../services/sync.ts";
import { requireRole } from "./middleware/roles.ts";

export function bankConnectionsRoutes(deps: BankConnectionDeps) {
	return (
		new Hono()
			// Always answers an administrator: the page reads it to name what is
			// missing. Nobody else: it says which credentials are stored.
			.get("/setup", requireRole("admin"), async (c) =>
				c.json({ data: await bankSetup(deps) }, 200),
			)
			// Before the guard: it is how credentials come to exist at all.
			.put("/credentials", validated("json", saveBankCredentialsSchema), async (c) =>
				c.json({ data: await saveBankCredentials(deps, c.req.valid("json")) }, 200),
			)
			// Registered after `/setup` and `/credentials`, which answer without
			// reaching it: every other route is refused before its input is even read.
			.use(
				createMiddleware(async (_c, next) => {
					await resolveBankConnector(deps);
					await next();
				}),
			)
			.get("/", async (c) => c.json({ data: await listConnections(deps) }, 200))
			.get("/institutions", validated("query", institutionsQuerySchema), async (c) =>
				c.json({ data: await listInstitutions(deps, c.req.valid("query").country) }, 200),
			)
			.post("/", validated("json", startConnectionSchema), async (c) =>
				c.json({ data: await startConnection(deps, c.req.valid("json")) }, 200),
			)
			.post("/callback", validated("json", completeConnectionSchema), async (c) =>
				c.json({ data: await completeConnection(deps, c.req.valid("json")) }, 200),
			)
			.get("/:id/accounts", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await listBankAccounts(deps, c.req.valid("param").id) }, 200),
			)
			.post("/:id/sync", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await syncConnection(deps, c.req.valid("param").id) }, 200),
			)
			.post("/:id/renew", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await renewConnection(deps, c.req.valid("param").id) }, 200),
			)
			.delete("/:id", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await disconnectConnection(deps, c.req.valid("param").id) }, 200),
			)
			.post(
				"/:id/accounts",
				validated("param", connectionParamSchema),
				validated("json", linkBankAccountsSchema),
				async (c) =>
					c.json(
						{
							data: await linkBankAccounts(deps, c.req.valid("param").id, c.req.valid("json")),
						},
						200,
					),
			)
	);
}
