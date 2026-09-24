import type { BankConnectionDeps } from "../services/bank-connections.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { validationError } from "../lib/zod-error.ts";
import {
	completeConnectionSchema,
	institutionsQuerySchema,
	startConnectionSchema,
} from "../schemas/bank-connections.ts";
import {
	bankSetup,
	completeConnection,
	listConnections,
	listInstitutions,
	requireBankConnector,
	startConnection,
} from "../services/bank-connections.ts";

export function bankConnectionsRoutes(deps: BankConnectionDeps) {
	return (
		new Hono()
			// Always answers: the page reads it to name what is missing.
			.get("/setup", (c) => c.json({ data: bankSetup(deps) }, 200))
			// Registered after `/setup`, which answers without reaching it: every
			// other route is refused before its input is even read.
			.use(
				createMiddleware(async (_c, next) => {
					requireBankConnector(deps);
					await next();
				}),
			)
			.get("/", async (c) => c.json({ data: await listConnections(deps) }, 200))
			.get(
				"/institutions",
				zValidator("query", institutionsQuerySchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) =>
					c.json({ data: await listInstitutions(deps, c.req.valid("query").country) }, 200),
			)
			.post(
				"/",
				zValidator("json", startConnectionSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await startConnection(deps, c.req.valid("json")) }, 200),
			)
			.post(
				"/callback",
				zValidator("json", completeConnectionSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await completeConnection(deps, c.req.valid("json")) }, 200),
			)
	);
}
