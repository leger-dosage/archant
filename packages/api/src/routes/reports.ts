import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { getNetWorth } from "../services/reports.ts";

export function reportsRoutes(deps: ServiceDeps) {
	return new Hono().get(
		"/net-worth",
		zValidator("query", balanceQuerySchema, (result) => {
			if (!result.success) {
				throw validationError(result.error);
			}
		}),
		async (c) => c.json({ data: await getNetWorth(deps, c.req.valid("query").period) }, 200),
	);
}
