import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import { moneyFlowQuerySchema, spendingTrendQuerySchema } from "../schemas/reports.ts";
import {
	getDashboardCashFlow,
	getMoneyFlow,
	getNetWorth,
	getSpendingTrend,
} from "../services/reports.ts";

export function reportsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/net-worth", validated("query", balanceQuerySchema), async (c) =>
			c.json({ data: await getNetWorth(deps, c.req.valid("query")) }, 200),
		)
		.get("/cash-flow", validated("query", balanceQuerySchema), async (c) =>
			c.json({ data: await getDashboardCashFlow(deps, c.req.valid("query")) }, 200),
		)
		.get("/money-flow", validated("query", moneyFlowQuerySchema), async (c) =>
			c.json({ data: await getMoneyFlow(deps, c.req.valid("query")) }, 200),
		)
		.get("/spending-trend", validated("query", spendingTrendQuerySchema), async (c) =>
			c.json({ data: await getSpendingTrend(deps, c.req.valid("query").month) }, 200),
		);
}
