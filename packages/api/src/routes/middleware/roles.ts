import type { SessionEnv } from "./auth.ts";
import type { Context } from "hono";

import { createMiddleware } from "hono/factory";

import type { UserRole } from "@archant/data/user-roles";

import { AppError } from "../../lib/errors.ts";
import { isPublicPath } from "./auth.ts";

/**
 * Checks a user's role after `requireSession` (AD-13, AD-21).
 * Use an explicit allowlist so an unknown role or a missing session fails closed.
 */
export function assertRole(c: Context<SessionEnv>, ...roles: UserRole[]) {
	const role = c.get("user")?.role;

	if (!roles.some((allowed) => allowed === role)) {
		throw new AppError("FORBIDDEN", "Your role does not allow this.");
	}
}

export function requireRole(...roles: UserRole[]) {
	return createMiddleware<SessionEnv>(async (c, next) => {
		assertRole(c, ...roles);
		await next();
	});
}

/**
 * The signed-in user of a guarded route: `requireSession` let only a
 * signed-in user through, so the check only satisfies the type.
 */
export function signedInUser(c: Context<SessionEnv>) {
	const user = c.get("user");

	if (user === undefined) {
		throw new AppError("FORBIDDEN", "Your role does not allow this.");
	}

	return user;
}

/**
 * The methods a guest may send. An allow list rather than the four that
 * write, so an unusual method fails closed with the rest.
 */
const READING_METHODS = new Set(["GET", "HEAD"]);

/** A method guard for routes whose reads and writes have different permissions. */
export function requireRoleForWrite(...roles: UserRole[]) {
	const allowed = requireRole(...roles);

	return createMiddleware<SessionEnv>(async (c, next) => {
		if (READING_METHODS.has(c.req.method)) {
			await next();
			return;
		}

		await allowed(c, next);
	});
}

/**
 * A guest writes nothing (AD-21): every other method on a guarded `/api`
 * path needs an administrator or member, before the route reads its input. One check
 * here rather than one per route, so a route added later is covered without
 * anyone thinking of it. Better Auth's own routes, mounted before it, stay
 * open: a guest changes their name, password and two-factor there.
 */
export function guestReadOnly() {
	const writerOnly = requireRoleForWrite("admin", "member");

	return createMiddleware<SessionEnv>(async (c, next) => {
		// A public path has no user; setup and the scheduled sync carry their own proof.
		if (isPublicPath(c.req.path)) {
			await next();
			return;
		}

		await writerOnly(c, next);
	});
}
