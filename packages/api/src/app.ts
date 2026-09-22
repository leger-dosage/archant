import type { ErrorBody } from "./lib/errors.ts";
import type { Logger } from "./lib/logger.ts";
import type { ServiceDeps } from "./services/deps.ts";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { AppError } from "./lib/errors.ts";
import { accountsRoutes } from "./routes/accounts.ts";
import { importsRoutes } from "./routes/imports.ts";
import { snapshotsRoutes } from "./routes/snapshots.ts";
import { transactionsRoutes } from "./routes/transactions.ts";

export type AppDeps = ServiceDeps & { logger: Logger };

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
		.route("/imports", importsRoutes(deps));
}

export type AppType = ReturnType<typeof createApi>;

/** The assembly point: the API under `/api`, and the error envelope for all of it. */
export function createApp(deps: AppDeps) {
	const app = new Hono().route("/api", createApi(deps));

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
