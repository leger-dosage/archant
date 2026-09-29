import type { Logger } from "../../lib/logger.ts";

import { createMiddleware } from "hono/factory";

import { AppError } from "../../lib/errors.ts";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuses a write whose `Origin` is not `BETTER_AUTH_URL`'s, ahead of `csrf()`
 * and Better Auth. A first run behind Tailscale with `ARCHANT_URL` left empty
 * created the administrator, since `csrf()` never checks JSON, then failed
 * every sign-in with Better Auth's bare `INVALID_ORIGIN`, which names no
 * cause. One check gives one code the interface can explain, one log line,
 * and stops setup before it creates an administrator nobody can sign in to.
 * An absent or `null` origin is left to `csrf()` and Better Auth, as before:
 * a cron's `curl` sends none, and a sandboxed form sends `null`.
 */
export function sameOrigin(deps: { trustedOrigin: string; logger: Logger }) {
	const expected = new URL(deps.trustedOrigin).origin;

	return createMiddleware(async (c, next) => {
		const origin = c.req.header("origin");

		if (
			UNSAFE_METHODS.has(c.req.method) &&
			origin !== undefined &&
			origin !== "null" &&
			origin !== expected
		) {
			deps.logger.warn({ origin, expected }, "request from another origin refused");

			// Neither origin in the answer: the caller may be anyone.
			throw new AppError(
				"ORIGIN_MISMATCH",
				"This server is configured for another address. Set ARCHANT_URL to the address in the address bar, then restart.",
			);
		}

		await next();
	});
}
