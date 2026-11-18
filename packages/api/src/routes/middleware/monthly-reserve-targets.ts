import type { Logger } from "../../lib/logger.ts";
import type { ServiceDeps } from "../../services/deps.ts";

import { createMiddleware } from "hono/factory";

import { codeOf } from "../../services/bank-connections.ts";
import { refreshReserveTargets } from "../../services/goal-reserve-targets.ts";
import { isPublicPath } from "./auth.ts";

export function monthlyReserveTargets(deps: ServiceDeps & { logger: Logger }) {
	return createMiddleware(async (c, next) => {
		await next();

		if (c.req.method === "GET" && !isPublicPath(c.req.path)) {
			// Keep the monthly write outside the GET and let the route return its stored figures.
			setImmediate(() => {
				void refreshReserveTargets(deps).catch((error: unknown) => {
					deps.logger.error({ code: codeOf(error) }, "monthly reserve refresh failed");
				});
			});
		}
	});
}
