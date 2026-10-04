import type { Context } from "hono";

import { createMiddleware } from "hono/factory";

import { clientKey, forwardedFor } from "../../lib/client-address.ts";
import { AppError } from "../../lib/errors.ts";
import { createRateLimiter } from "../../lib/rate-limit.ts";

export type AttemptsDeps = {
	/** The TCP peer's address, as in `AppDeps`. */
	clientAddress: (c: Context) => string | undefined;
	/** `TRUSTED_PROXIES`. */
	trustedProxies: string[];
};

/**
 * Better Auth's sign-in rule, 3 requests per 10 seconds per address, on the
 * two public routes that create a user: setup, so guessing its token is no
 * faster than guessing a password, and an invitation's acceptance, which
 * hashes a password and creates a user on every success. An invitation's
 * preview is not limited: it writes nothing, and its 32-byte token is out of
 * reach of guessing. In memory: a restart forgets the counts, and changes the
 * setup token.
 */
const ATTEMPTS = { max: 3, windowMs: 10_000 };

/**
 * Refuses a public route's request with `TOO_MANY_REQUESTS` once its address
 * spent the allowance, before the body is read. Each call keeps counts of its
 * own, so setup attempts never spend an invitation's.
 */
export function limitAttempts(deps: AttemptsDeps, message: string) {
	const limiter = createRateLimiter(ATTEMPTS);

	return createMiddleware(async (c, next) => {
		const forwarded = forwardedFor(
			c.req.header("x-forwarded-for") ?? null,
			deps.clientAddress(c),
			deps.trustedProxies.length > 0,
		);

		if (!limiter.consume(clientKey(forwarded, deps.trustedProxies))) {
			throw new AppError("TOO_MANY_REQUESTS", message);
		}

		await next();
	});
}
