import type { Logger } from "../../lib/logger.ts";
import type { ServiceDeps } from "../../services/deps.ts";

import { createMiddleware } from "hono/factory";

import { codeOf } from "../../services/bank-connections.ts";
import { startDailyOccurrences } from "../../services/recurring/occurrences.ts";
import { isPublicPath } from "./auth.ts";

/**
 * The first signed-in read of the day generates every active series'
 * occurrences, so a bill falls due on a host no sync woke, as Sure's daily
 * `GenerateRecurringOccurrencesJob` without a job. The day is claimed before
 * the route answers and the occurrences written after it. A failure is
 * logged, code only, and never fails the request it rides on. Reads only,
 * as the day's sync and prices.
 */
export function dailyRecurring(deps: ServiceDeps & { logger: Logger }) {
	return createMiddleware(async (c, next) => {
		if (c.req.method !== "GET" || isPublicPath(c.req.path)) {
			await next();
			return;
		}

		let daily: { run: () => Promise<void> } | null = null;

		try {
			daily = await startDailyOccurrences(deps);
		} catch (error) {
			deps.logger.error({ code: codeOf(error) }, "daily occurrences failed to start");
		}

		try {
			await next();
		} finally {
			// Not awaited: the process keeps it alive, and the catch keeps it from rejecting.
			void daily?.run().catch((error: unknown) => {
				deps.logger.error({ code: codeOf(error) }, "daily occurrences failed");
			});
		}
	});
}
