import type { ErrorBody } from "./lib/errors.ts";
import type { Logger } from "./lib/logger.ts";
import type { Auth } from "./services/auth.ts";
import type { BankConnectionDeps } from "./services/bank-connections.ts";
import type { ServiceDeps } from "./services/deps.ts";
import type { Context, MiddlewareHandler } from "hono";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { withForwardedFor } from "./lib/client-address.ts";
import { AppError } from "./lib/errors.ts";
import { accountsRoutes } from "./routes/accounts.ts";
import { bankConnectionsRoutes } from "./routes/bank-connections.ts";
import { categoriesRoutes } from "./routes/categories.ts";
import { healthRoutes } from "./routes/health.ts";
import { importsRoutes } from "./routes/imports.ts";
import { merchantsRoutes } from "./routes/merchants.ts";
import { requireSession } from "./routes/middleware/auth.ts";
import { recurringRoutes } from "./routes/recurring.ts";
import { reportsRoutes } from "./routes/reports.ts";
import { rulesRoutes } from "./routes/rules.ts";
import { setupRoutes } from "./routes/setup.ts";
import { snapshotsRoutes } from "./routes/snapshots.ts";
import { tagsRoutes } from "./routes/tags.ts";
import { transactionsRoutes } from "./routes/transactions.ts";
import { transfersRoutes } from "./routes/transfers.ts";

export type AppDeps = ServiceDeps &
	BankConnectionDeps & {
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
		/**
		 * `WEB_DIST`: the built interface, served under `/` when set. Unset in
		 * development, where Vite serves it and proxies `/api` here.
		 */
		webDist?: string | undefined;
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
		.route("/transfers", transfersRoutes(deps))
		.route("/snapshots", snapshotsRoutes(deps))
		.route("/imports", importsRoutes(deps))
		.route("/categories", categoriesRoutes(deps))
		.route("/merchants", merchantsRoutes(deps))
		.route("/tags", tagsRoutes(deps))
		.route("/rules", rulesRoutes(deps))
		.route("/recurring", recurringRoutes(deps))
		.route("/reports", reportsRoutes(deps))
		.route("/bank-connections", bankConnectionsRoutes(deps))
		.route("/setup", setupRoutes(deps))
		.route("/health", healthRoutes(deps));
}

export type AppType = ReturnType<typeof createApi>;

// `c.notFound()` is untyped, so the body goes through `c.json` like any other.
function notFound(c: Context) {
	const body: ErrorBody = {
		error: { code: "NOT_FOUND", message: `No route matches ${c.req.method} ${c.req.path}` },
	};

	return c.json(body, 404);
}

/**
 * Sets `Cache-Control` on a file actually served. `serveStatic`'s `onFound`
 * runs once the response is built, too late for a header to reach it.
 */
function cacheControl(value: string): MiddlewareHandler {
	return async (c, next) => {
		await next();

		if (c.res.ok) {
			c.header("Cache-Control", value);
		}
	};
}

/**
 * The built interface. Vite hashes every file under `/assets`, so they never
 * change and a missing one is a `404`, never the page. Everything else is
 * revalidated: an `index.html` cached across an upgrade would ask for assets
 * the new build no longer has.
 */
function serveInterface(app: Hono, root: string) {
	app.get(
		"/assets/*",
		cacheControl("public, max-age=31536000, immutable"),
		serveStatic({ root }),
		notFound,
	);
	// Any other path is a client-side route, such as a reloaded `/accounts`.
	app.get(
		"*",
		cacheControl("no-cache"),
		serveStatic({ root }),
		serveStatic({ root, path: "index.html" }),
	);
}

/**
 * The assembly point: the API under `/api`, the built interface under `/`
 * when there is one, and the error envelope for all of it. Order matters: the
 * origin check and Better Auth's handler come before the session guard, which
 * comes before every route it protects; `/api` has its own JSON 404 before the
 * interface's fallback, which would otherwise answer an unknown API route with
 * the page.
 */
export function createApp(deps: AppDeps) {
	const app = new Hono()
		// Every response, pages and API alike: without `X-Frame-Options` a
		// third-party site could frame the sign-in page and steer a click, and
		// `nosniff` stops a browser from running a file under a type it guessed.
		.use("*", secureHeaders())
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
		.route("/api", createApi(deps))
		.all("/api/*", notFound);

	if (deps.webDist !== undefined) {
		serveInterface(app, deps.webDist);
	}

	app.notFound(notFound);

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
