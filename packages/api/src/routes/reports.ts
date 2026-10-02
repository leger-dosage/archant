import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { cashFlowQuerySchema } from "../schemas/reports.ts";
import { getCashFlow, getNetWorth } from "../services/reports.ts";

export function reportsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/net-worth", validated("query", balanceQuerySchema), async (c) =>
			c.json({ data: await getNetWorth(deps, c.req.valid("query").period) }, 200),
		)
		.get("/cash-flow", validated("query", cashFlowQuerySchema), async (c) =>
			c.json({ data: await getCashFlow(deps, c.req.valid("query").month) }, 200),
		);
}
