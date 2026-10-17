import type { BankConnectionDeps } from "../services/bank-connections.ts";

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { validated } from "../lib/validated.ts";
import {
	bankSyncSettingsSchema,
	completeConnectionSchema,
	connectionParamSchema,
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
	removeBankCredentials,
	renewConnection,
	startConnection,
} from "../services/bank-connections.ts";
import {
	bankSetup,
	resolveBankConnector,
	saveBankCredentials,
} from "../services/bank-credentials.ts";
import { bankSyncSettings, saveBankSyncSettings } from "../services/bank-settings.ts";
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
			// Before the guard, as Sure's switch shows on its own page: the
			// setting reads and writes no credential. Only an administrator sees
			// it, as only one can change it.
			.get("/settings", requireRole("admin"), async (c) =>
				c.json({ data: await bankSyncSettings(deps) }, 200),
			)
			.put("/settings", validated("json", bankSyncSettingsSchema), async (c) =>
				c.json({ data: await saveBankSyncSettings(deps, c.req.valid("json")) }, 200),
			)
			// Before the guard as well, so credentials that no longer resolve can
			// still be removed, and before `/:id`, which would take it for an id.
			.delete("/credentials", async (c) => c.json({ data: await removeBankCredentials(deps) }, 200))
			// Before the guard too: a lost key must never keep a bank connected,
			// which would lock the credentials for good (Sure's `return unless provider`).
			.get("/", async (c) => c.json({ data: await listConnections(deps) }, 200))
			.get("/:id/accounts", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await listBankAccounts(deps, c.req.valid("param").id) }, 200),
			)
			.delete("/:id", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await disconnectConnection(deps, c.req.valid("param").id) }, 200),
			)
			// Registered after the routes above, which answer without reaching it:
			// every other route is refused before its input is even read.
			.use(
				createMiddleware(async (_c, next) => {
					await resolveBankConnector(deps);
					await next();
				}),
			)
			.get("/institutions", async (c) => c.json({ data: await listInstitutions(deps) }, 200))
			.post("/", validated("json", startConnectionSchema), async (c) =>
				c.json({ data: await startConnection(deps, c.req.valid("json")) }, 200),
			)
			.post("/callback", validated("json", completeConnectionSchema), async (c) =>
				c.json({ data: await completeConnection(deps, c.req.valid("json")) }, 200),
			)
			.post("/:id/sync", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await syncConnection(deps, c.req.valid("param").id) }, 200),
			)
			.post("/:id/renew", validated("param", connectionParamSchema), async (c) =>
				c.json({ data: await renewConnection(deps, c.req.valid("param").id) }, 200),
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
