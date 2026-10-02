import type { SetupDeps } from "../services/setup.ts";
import type { Context } from "hono";

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { clientKey, forwardedFor } from "../lib/client-address.ts";
import { AppError } from "../lib/errors.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { validated } from "../lib/validated.ts";
import { setupSchema } from "../schemas/setup.ts";
import { assertSetupOpen, completeSetup, getSetupStatus } from "../services/setup.ts";

export type SetupRouteDeps = SetupDeps & {
	/** The TCP peer's address, as in `AppDeps`. */
	clientAddress: (c: Context) => string | undefined;
	/** `TRUSTED_PROXIES`. */
	trustedProxies: string[];
};

/**
 * Better Auth's sign-in rule, 3 requests per 10 seconds per address, so
 * guessing the token is no faster than guessing the password. In memory: a
 * restart forgets the counts but also changes the token, which leaves an
 * attacker nothing to gain from it.
 */
const SETUP_ATTEMPTS = { max: 3, windowMs: 10_000 };

export function setupRoutes(deps: SetupRouteDeps) {
	const limiter = createRateLimiter(SETUP_ATTEMPTS);

	// Before the body is read: a closed setup tells a stranger nothing about
	// what it would have accepted.
	const open = createMiddleware(async (_c, next) => {
		await assertSetupOpen(deps);
		await next();
	});

	const limited = createMiddleware(async (c, next) => {
		const forwarded = forwardedFor(
			c.req.header("x-forwarded-for") ?? null,
			deps.clientAddress(c),
			deps.trustedProxies.length > 0,
		);

		if (!limiter.consume(clientKey(forwarded, deps.trustedProxies))) {
			throw new AppError(
				"TOO_MANY_REQUESTS",
				"Too many setup attempts. Try again in a few seconds.",
			);
		}

		await next();
	});

	return new Hono()
		.get("/", async (c) => c.json({ data: await getSetupStatus(deps) }, 200))
		.post("/", open, limited, validated("json", setupSchema), async (c) => {
			const data = await completeSetup(deps, c.req.valid("json"));

			return c.json({ data }, 201);
		});
}
