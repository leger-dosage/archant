import type { BankConnectionDeps } from "../../services/bank-connections.ts";
import type { DailySync } from "../../services/sync.ts";

import { createMiddleware } from "hono/factory";

import { codeOf } from "../../services/bank-connections.ts";
import { startDailySync } from "../../services/sync.ts";
import { isPublicPath } from "./auth.ts";

/**
 * The first visit of the day syncs the banks (AD-18), after `requireSession`:
 * a machine that sleeps through the cron still opens on fresh accounts. The
 * leases are taken before the route answers, so a list read by this very
 * request already says a sync runs; the bank is read once it has answered.
 * A failure here is logged and never fails the request it rides on. Reads
 * only, which every page load sends: taken by a write such as the button's
 * sync or a disconnection, the lease would make that very route answer
 * `SYNC_IN_PROGRESS`.
 */
export function dailySync(deps: BankConnectionDeps) {
	return createMiddleware(async (c, next) => {
		if (c.req.method !== "GET" || isPublicPath(c.req.path)) {
			await next();
			return;
		}

		let daily: DailySync | null = null;

		try {
			daily = await startDailySync(deps);
		} catch (error) {
			deps.logger.error({ code: codeOf(error) }, "daily bank sync failed to start");
		}

		try {
			await next();
		} finally {
			// Not awaited: the process keeps it alive, and `run` never rejects.
			void daily?.run();
		}
	});
}
