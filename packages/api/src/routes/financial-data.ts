import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { resetFinancialData } from "../services/ledger/reset.ts";
import { requireRole, signedInUser } from "./middleware/roles.ts";

/**
 * « Zone dangereuse › Réinitialiser le compte »: Sure's `DELETE
 * /users/:id/reset`, named after its `Family::FinancialDataReset`. Sure's
 * `ensure_admin` as `requireRole("admin")`, beside `viewerReadOnly`, which
 * already refuses a viewer's `DELETE`: a guard that names the role stays if
 * the route's method ever changes. At once rather than in a background job, as
 * Sure's `FamilyResetJob`: Archant has no queue, and one SQLite transaction
 * is fast.
 */
export function financialDataRoutes(deps: ServiceDeps & { logger: Logger }) {
	return new Hono<SessionEnv>().delete("/", requireRole("admin"), async (c) => {
		await resetFinancialData(deps, { origin: "user" });
		// Who reset, by id: never a count, a name or an amount.
		deps.logger.info({ userId: signedInUser(c).id }, "financial data reset");

		return c.json({ data: null }, 200);
	});
}
