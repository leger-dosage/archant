import type { ErrorBody } from "./lib/errors.ts";
import type { Logger } from "./lib/logger.ts";
import type { Auth } from "./services/auth.ts";
import type { ServiceDeps } from "./services/deps.ts";
import type { Context } from "hono";

import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";

import { withForwardedFor } from "./lib/client-address.ts";
import { AppError } from "./lib/errors.ts";
import { accountsRoutes } from "./routes/accounts.ts";
import { importsRoutes } from "./routes/imports.ts";
import { requireSession } from "./routes/middleware/auth.ts";
import { setupRoutes } from "./routes/setup.ts";
import { snapshotsRoutes } from "./routes/snapshots.ts";
import { transactionsRoutes } from "./routes/transactions.ts";

export type AppDeps = ServiceDeps & {
	logger: Logger;
	auth: Auth;
	/** `BETTER_AUTH_URL`'s origin: the only one a form post is accepted from. */
	trustedOrigin: string;
	/** `TRUSTED_PROXIES`, also given to Better Auth. */
	trustedProxies: string[];
	/**
	 * The TCP peer's address, `undefined` for an in-process request. Passed in
	 * so no route reads a Node socket; `index.ts` builds it with `getConnInfo`.
	 */
	clientAddress: (c: Context) => string | undefined;
};

/**
 * Every API route, relative to `/api`. Mounts are chained on purpose: `AppType`
 * is read by `hc<AppType>("/api")` in the interface, and a mount registered
 * outside the chain is invisible to it.
 */
function createApi(deps: AppDeps) {
	return new Hono()
		.route("/accounts", accountsRoutes(deps))
		.route("/transactions", transactionsRoutes(deps))
		.route("/snapshots", snapshotsRoutes(deps))
		.route("/imports", importsRoutes(deps))
		.route("/setup", setupRoutes(deps));
}

export type AppType = ReturnType<typeof createApi>;

/**
 * The assembly point: the API under `/api`, and the error envelope for all of
 * it. Order matters: the origin check and Better Auth's handler come before
 * the session guard, which comes before every route it protects.
 */
export function createApp(deps: AppDeps) {
	const app = new Hono()
		// A form post needs no preflight, so a foreign page could submit an
		// upload with the session cookie attached. JSON requests are left to the
		// browser's CORS preflight, which this API never answers.
		.use("/api/*", csrf({ origin: new URL(deps.trustedOrigin).origin }))
		// Better Auth answers in its own shape, outside the envelope and outside
		// `AppType`; the interface calls it through `better-auth/react`.
		.on(["GET", "POST"], "/api/auth/*", async (c) =>
			deps.auth.handler(
				withForwardedFor(c.req.raw, deps.clientAddress(c), deps.trustedProxies.length > 0),
			),
		)
		.use("/api/*", requireSession(deps.auth))
		.route("/api", createApi(deps));

	// `c.notFound()` is untyped, so the body goes through `c.json` like any other.
	app.notFound((c) => {
		const body: ErrorBody = {
			error: { code: "NOT_FOUND", message: `No route matches ${c.req.method} ${c.req.path}` },
		};

		return c.json(body, 404);
	});

	app.onError((error, c) => {
		if (error instanceof AppError) {
			return c.json(error.toJSON(), error.status);
		}

		// `csrf()` refused a form post from another origin.
		if (error instanceof HTTPException && error.status === 403) {
			return c.json(
				new AppError("FORBIDDEN", "Cross-origin form posts are refused.").toJSON(),
				403,
			);
		}

		// Hono raises this for a body that is not JSON at all; the caller sent a
		// bad request, which is not a server fault.
		if (error instanceof HTTPException && error.status === 400) {
			return c.json(
				new AppError("VALIDATION_ERROR", "The request body is not valid JSON.").toJSON(),
				400,
			);
		}

		// Name and path only. A Drizzle error message embeds the query's bound
		// parameters, which are amounts; a stack adds nothing a path cannot find.
		deps.logger.error(
			{ error: error.name, method: c.req.method, path: c.req.path },
			"request failed",
		);

		return c.json(new AppError("INTERNAL_ERROR", "Something went wrong.").toJSON(), 500);
	});

	return app;
}
