import type { Auth } from "../../services/auth.ts";

import { createMiddleware } from "hono/factory";

import { AppError } from "../../lib/errors.ts";

/**
 * Routes a visitor without a session may reach: Better Auth's own, setup,
 * the health check (Story 3.3), the scheduled sync, which carries its own
 * secret instead (Epic 10), `/api/mcp`, which takes an assistant's token
 * and never a session (AD-19), and an invitation's preview and acceptance,
 * which take the link's token (AD-21).
 */
const PUBLIC_PREFIXES = ["/api/auth/"];
const PUBLIC_PATHS = new Set([
	"/api/auth",
	"/api/setup",
	"/api/health",
	"/api/sync",
	"/api/mcp",
	"/api/invitations/preview",
	"/api/invitations/accept",
]);

export function isPublicPath(path: string): boolean {
	return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** The signed-in user, as Better Auth reads it from the session. */
type SessionUser = Auth["$Infer"]["Session"]["user"];

/**
 * What `requireSession` leaves on the context: the user, read by
 * `requireRole`. Optional, since a public path passes without one.
 */
export type SessionEnv = { Variables: { user?: SessionUser } };

/**
 * The one session check (AD-13), in front of every `/api` route, unknown
 * ones included, so a missing route reveals nothing without a session.
 * `always` checks a public path too: the one Better Auth endpoint Archant
 * guards itself, which answers the request once the check passes and
 * extends the session itself, so it is read here without a refresh.
 */
export function requireSession(auth: Pick<Auth, "api">, { always = false } = {}) {
	return createMiddleware<SessionEnv>(async (c, next) => {
		if (!always && isPublicPath(c.req.path)) {
			await next();
			return;
		}

		const { headers, response: session } = await auth.api.getSession({
			headers: c.req.raw.headers,
			query: { disableRefresh: always },
			returnHeaders: true,
		});

		if (session === null) {
			throw new AppError("UNAUTHORIZED", "Sign in to continue.");
		}

		c.set("user", session.user);

		// Better Auth extends a session older than a day and re-sends its cookie.
		// Dropped, a tab used daily without a reload would still be signed out
		// when the first cookie expires, seven days after signing in.
		for (const cookie of headers.getSetCookie()) {
			c.header("set-cookie", cookie, { append: true });
		}

		await next();
	});
}
