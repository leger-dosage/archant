import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { contentDisposition } from "../lib/content-disposition.ts";
import { validated } from "../lib/validated.ts";
import { balanceQuerySchema } from "../schemas/balances.ts";
import {
	moneyFlowQuerySchema,
	reportsLayoutSchema,
	reportsPageQuerySchema,
	spendingTrendQuerySchema,
} from "../schemas/reports.ts";
import { getReportsLayout, updateReportsLayout } from "../services/reports-layout.ts";
import { getReportsCsv, getReportsPage } from "../services/reports-page.ts";
import {
	getDashboardCashFlow,
	getInvestmentSummary,
	getMoneyFlow,
	getNetWorth,
	getSpendingTrend,
} from "../services/reports.ts";
import { signedInUser } from "./middleware/roles.ts";

/**
 * The dashboard's reports, and Sure's « Rapports » page: its one read, its
 * CSV, and the signed-in user's section layout. A viewer reads every one of
 * them, the CSV included, and cannot change the layout: `viewerReadOnly`
 * refuses the `PATCH` (AD-21).
 */
export function reportsRoutes(deps: ServiceDeps) {
	return (
		new Hono<SessionEnv>()
			.get("/net-worth", validated("query", balanceQuerySchema), async (c) =>
				c.json({ data: await getNetWorth(deps, c.req.valid("query")) }, 200),
			)
			.get("/cash-flow", validated("query", balanceQuerySchema), async (c) =>
				c.json({ data: await getDashboardCashFlow(deps, c.req.valid("query")) }, 200),
			)
			.get("/investment-summary", validated("query", balanceQuerySchema), async (c) =>
				c.json({ data: await getInvestmentSummary(deps, c.req.valid("query")) }, 200),
			)
			.get("/money-flow", validated("query", moneyFlowQuerySchema), async (c) =>
				c.json({ data: await getMoneyFlow(deps, c.req.valid("query")) }, 200),
			)
			.get("/spending-trend", validated("query", spendingTrendQuerySchema), async (c) =>
				c.json({ data: await getSpendingTrend(deps, c.req.valid("query").month) }, 200),
			)
			.get("/page", validated("query", reportsPageQuerySchema), async (c) =>
				c.json({ data: await getReportsPage(deps, c.req.valid("query")) }, 200),
			)
			// Outside the `{ data }` envelope: the interface downloads it through a
			// plain link, so the browser saves it under its name.
			.get("/export", validated("query", reportsPageQuerySchema), async (c) => {
				const { fileName, body } = await getReportsCsv(deps, c.req.valid("query"), {
					userId: signedInUser(c).id,
					acceptLanguage: c.req.header("accept-language"),
				});

				return c.body(body, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": contentDisposition("attachment", fileName),
					// Every category's amounts: no shared cache, nor the browser's, keeps a copy.
					"Cache-Control": "no-store",
				});
			})
			.get("/layout", async (c) =>
				c.json({ data: await getReportsLayout(deps, signedInUser(c).id) }, 200),
			)
			.patch("/layout", validated("json", reportsLayoutSchema), async (c) =>
				c.json(
					{ data: await updateReportsLayout(deps, signedInUser(c).id, c.req.valid("json")) },
					200,
				),
			)
	);
}
