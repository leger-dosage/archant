import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { dashboardLayoutSchema } from "../schemas/dashboard-layout.ts";
import { getDashboardLayout, updateDashboardLayout } from "../services/dashboard-layout.ts";
import { signedInUser } from "./middleware/roles.ts";

/**
 * The signed-in user's dashboard layout, Sure's `PATCH /dashboard/preferences`
 * and `/dashboard/sections/:key/hidden`. A viewer reads Sure's default and
 * cannot change it: `viewerReadOnly` refuses the `PATCH` (AD-21).
 */
export function dashboardRoutes(deps: ServiceDeps) {
	return new Hono<SessionEnv>()
		.get("/layout", async (c) =>
			c.json({ data: await getDashboardLayout(deps, signedInUser(c).id) }, 200),
		)
		.patch("/layout", validated("json", dashboardLayoutSchema), async (c) =>
			c.json(
				{ data: await updateDashboardLayout(deps, signedInUser(c).id, c.req.valid("json")) },
				200,
			),
		);
}
