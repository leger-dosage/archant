import type { SureImportDeps } from "../services/sure-import.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";
import { z } from "zod";

import { validated } from "../lib/validated.ts";
import { resetFinancialData } from "../services/ledger/reset.ts";
import { resetWithSampleData } from "../services/sample-data.ts";
import { requireRole, signedInUser } from "./middleware/roles.ts";

/** `sampleData=true` is Sure's `reset_with_sample_data`; anything but `true` or `false` is refused. */
const resetQuerySchema = z.object({ sampleData: z.enum(["true", "false"]).optional() });

/**
 * « Zone dangereuse › Réinitialiser le compte »: Sure's `DELETE
 * /users/:id/reset`, named after its `Family::FinancialDataReset`, and with
 * `sampleData=true` « Réinitialiser et précharger », its `DELETE
 * /users/:id/reset_with_sample_data`, which runs `Demo::Generator` after:
 * one route, as both reach Sure's one `FamilyResetJob`. Sure's
 * `ensure_admin` as `requireRole("admin")`, beside `viewerReadOnly`, which
 * already refuses a viewer's `DELETE`: a guard that names the role stays if
 * the route's method ever changes. At once rather than in a background job, as
 * Sure's `FamilyResetJob`: Archant has no queue, and one SQLite transaction
 * is fast.
 */
export function financialDataRoutes(deps: SureImportDeps) {
	return new Hono<SessionEnv>().delete(
		"/",
		requireRole("admin"),
		validated("query", resetQuerySchema),
		async (c) => {
			const sampleData = c.req.valid("query").sampleData === "true";

			if (sampleData) {
				await resetWithSampleData(deps);
			} else {
				await resetFinancialData(deps, { origin: "user" });
			}

			// Who reset, by id: never a count, a name or an amount.
			deps.logger.info({ userId: signedInUser(c).id, sampleData }, "financial data reset");

			return c.json({ data: null }, 200);
		},
	);
}
