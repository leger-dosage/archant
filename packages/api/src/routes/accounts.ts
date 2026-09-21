import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { createAccountSchema } from "../schemas/accounts.ts";
import { createAccount, listAccounts } from "../services/accounts.ts";

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
		);
}
