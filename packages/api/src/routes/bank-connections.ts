import type { BankConnectionDeps } from "../services/bank-connections.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { validationError } from "../lib/zod-error.ts";
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

export function bankConnectionsRoutes(deps: BankConnectionDeps) {
	return (
		new Hono()
			// Always answers: the page reads it to name what is missing.
			.get("/setup", async (c) => c.json({ data: await bankSetup(deps) }, 200))
			// Before the guard: it is how credentials come to exist at all.
			.put(
				"/credentials",
				zValidator("json", saveBankCredentialsSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await saveBankCredentials(deps, c.req.valid("json")) }, 200),
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
			.get(
				"/:id/accounts",
				zValidator("param", connectionParamSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await listBankAccounts(deps, c.req.valid("param").id) }, 200),
			)
			.post(
				"/:id/sync",
				zValidator("param", connectionParamSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await syncConnection(deps, c.req.valid("param").id) }, 200),
			)
			.post(
				"/:id/renew",
				zValidator("param", connectionParamSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) => c.json({ data: await renewConnection(deps, c.req.valid("param").id) }, 200),
			)
			.delete(
				"/:id",
				zValidator("param", connectionParamSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				async (c) =>
					c.json({ data: await disconnectConnection(deps, c.req.valid("param").id) }, 200),
			)
			.post(
				"/:id/accounts",
				zValidator("param", connectionParamSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
				zValidator("json", linkBankAccountsSchema, (result) => {
					if (!result.success) {
						throw validationError(result.error);
					}
				}),
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
