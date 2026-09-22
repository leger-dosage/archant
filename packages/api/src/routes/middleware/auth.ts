import type { Auth } from "../../services/auth.ts";

import { createMiddleware } from "hono/factory";

import { AppError } from "../../lib/errors.ts";

/**
 * Routes a visitor without a session may reach: Better Auth's own, setup,
 * the health check (Story 3.3) and the scheduled sync, which carries its own
 * secret instead (Epic 10).
 */
const PUBLIC_PREFIXES = ["/api/auth/"];
const PUBLIC_PATHS = new Set(["/api/auth", "/api/setup", "/api/health", "/api/sync"]);

export function isPublicPath(path: string): boolean {
	return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The one session check (AD-13), in front of every `/api` route, unknown
 * ones included, so a missing route reveals nothing without a session.
 */
export function requireSession(auth: Pick<Auth, "api">) {
	return createMiddleware(async (c, next) => {
		if (isPublicPath(c.req.path)) {
			await next();
			return;
		}

		const { headers, response: session } = await auth.api.getSession({
			headers: c.req.raw.headers,
			returnHeaders: true,
		});

		if (session === null) {
			throw new AppError("UNAUTHORIZED", "Sign in to continue.");
		}

		// Better Auth extends a session older than a day and re-sends its cookie.
		// Dropped, a tab used daily without a reload would still be signed out
		// when the first cookie expires, seven days after signing in.
		for (const cookie of headers.getSetCookie()) {
			c.header("set-cookie", cookie, { append: true });
		}

		await next();
	});
}
