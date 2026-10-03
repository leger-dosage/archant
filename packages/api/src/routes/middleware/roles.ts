import type { SessionEnv } from "./auth.ts";

import { createMiddleware } from "hono/factory";

import type { UserRole } from "@archant/data/schema/auth";

import { AppError } from "../../lib/errors.ts";
import { isPublicPath } from "./auth.ts";

/**
 * The one reader of a user's role (AD-13, AD-21), after `requireSession`.
 * Equality rather than a ranking: with two roles, `admin` is the only one a
 * check ever names. No user on the context, a route mounted outside the
 * session guard, is refused too.
 */
export function requireRole(role: UserRole) {
	return createMiddleware<SessionEnv>(async (c, next) => {
		if (c.get("user")?.role !== role) {
			throw new AppError("FORBIDDEN", "Your role does not allow this.");
		}

		await next();
	});
}

/**
 * The methods a viewer may send. An allow list rather than the four that
 * write, so an unusual method fails closed with the rest.
 */
const READING_METHODS = new Set(["GET", "HEAD"]);

/**
 * A viewer writes nothing (AD-21): every other method on a guarded `/api`
 * path needs an administrator, before the route reads its input. One check
 * here rather than one per route, so a route added later is covered without
 * anyone thinking of it. Better Auth's own routes, mounted before it, stay
 * open: a viewer changes their name, password and two-factor there.
 */
export function viewerReadOnly() {
	const adminOnly = requireRole("admin");

	return createMiddleware<SessionEnv>(async (c, next) => {
		// A public path has no user; setup and the scheduled sync carry their own proof.
		if (READING_METHODS.has(c.req.method) || isPublicPath(c.req.path)) {
			await next();
			return;
		}

		await adminOnly(c, next);
	});
}
