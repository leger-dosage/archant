import type { DailyPriceRun } from "../../services/prices.ts";
import type { PriceDeps } from "../../services/securities.ts";

import { createMiddleware } from "hono/factory";

import { codeOf } from "../../services/bank-connections.ts";
import { startDailyPrices } from "../../services/prices.ts";
import { isPublicPath } from "./auth.ts";

/**
 * The first visit of the day fetches the day's prices (AD-22), after the
 * bank sync's middleware and as it does: the lease is taken before the route
 * answers, so a status read by this very request already says a run is on;
 * the provider is read once it has answered. A failure here is logged and
 * never fails the request it rides on. Reads only, so the button's own
 * `POST` never finds the lease taken by itself.
 */
export function dailyPrices(deps: PriceDeps) {
	return createMiddleware(async (c, next) => {
		if (c.req.method !== "GET" || isPublicPath(c.req.path)) {
			await next();
			return;
		}

		let daily: DailyPriceRun | null = null;

		try {
			daily = await startDailyPrices(deps);
		} catch (error) {
			deps.logger.error({ code: codeOf(error) }, "daily price update failed to start");
		}

		try {
			await next();
		} finally {
			// Not awaited: the process keeps it alive, and `run` never rejects.
			void daily?.run();
		}
	});
}
