import type { ErrorBody } from "./lib/errors.ts";
import type { Logger } from "./lib/logger.ts";
import type { SessionEnv } from "./routes/middleware/auth.ts";
import type { Auth } from "./services/auth.ts";
import type { BankConnectionDeps } from "./services/bank-connections.ts";
import type { ServiceDeps } from "./services/deps.ts";
import type { Reservation, SignInCeilingOptions } from "./services/sign-in-failures.ts";
import type { Context, MiddlewareHandler, Next } from "hono";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { except } from "hono/combine";
import { compress } from "hono/compress";
import { getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import type { Database } from "@archant/data/client";

import { withForwardedFor } from "./lib/client-address.ts";
import {
	attachmentContentSecurityPolicy,
	contentSecurityPolicy,
} from "./lib/content-security-policy.ts";
import { AppError } from "./lib/errors.ts";
import { mcpHandler } from "./mcp/server.ts";
import { accountsRoutes } from "./routes/accounts.ts";
import { assistantsRoutes } from "./routes/assistants.ts";
import { attachmentsRoutes } from "./routes/attachments.ts";
import { bankConnectionsRoutes } from "./routes/bank-connections.ts";
import { budgetsRoutes } from "./routes/budgets.ts";
import { categoriesRoutes } from "./routes/categories.ts";
import { exportRoutes } from "./routes/export.ts";
import { goalsRoutes } from "./routes/goals.ts";
import { healthRoutes } from "./routes/health.ts";
import { importsRoutes } from "./routes/imports.ts";
import { invitationsRoutes } from "./routes/invitations.ts";
import { membersRoutes } from "./routes/members.ts";
import { merchantsRoutes } from "./routes/merchants.ts";
import { requireSession } from "./routes/middleware/auth.ts";
import { dailySync } from "./routes/middleware/daily-sync.ts";
import { requireRole, viewerReadOnly } from "./routes/middleware/roles.ts";
import { sameOrigin } from "./routes/middleware/same-origin.ts";
import { recurringRoutes } from "./routes/recurring.ts";
import { reportsRoutes } from "./routes/reports.ts";
import { rulesRoutes } from "./routes/rules.ts";
import { setupRoutes } from "./routes/setup.ts";
import { snapshotsRoutes } from "./routes/snapshots.ts";
import { syncRoutes } from "./routes/sync.ts";
import { tagsRoutes } from "./routes/tags.ts";
import { transactionsRoutes } from "./routes/transactions.ts";
import { transfersRoutes } from "./routes/transfers.ts";
import { versionRoutes } from "./routes/version.ts";
import { assistantsAvailable } from "./services/auth.ts";
import {
	DEVICE_COOKIE,
	deviceCookieOptions,
	knownDeviceNonce,
	signDeviceCookie,
} from "./services/device-cookie.ts";
import {
	SIGN_IN_CEILING,
	deviceCeiling,
	releaseAttempt,
	reserveAttempt,
} from "./services/sign-in-failures.ts";

export type AppDeps = ServiceDeps &
	BankConnectionDeps & {
		/** `$client` too, for the statistics a large import refreshes. */
		db: Pick<Database, "$client">;
		logger: Logger;
		auth: Auth;
		/** `BETTER_AUTH_URL`'s origin: the only one a write is accepted from. */
		trustedOrigin: string;
		/** `BETTER_AUTH_SECRET`, also given to Better Auth: signs the device cookie. */
		authSecret: string;
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
		/** `SYNC_SECRET`, the bearer token of `POST /api/sync`; unset, it refuses every call. */
		syncSecret?: string | undefined;
		/**
		 * The token `POST /api/setup` requires, generated at start while no user
		 * exists; `null` once one does. Never stored, never returned.
		 */
		setupToken: string | null;
		/** `APP_VERSION`: the release the image was built from, `null` for a development build. */
		version: string | null;
	};

/**
 * Far above any JSON body the interface sends, such as a rule with many
 * conditions, and small enough that no caller, signed in or not, makes the
 * server hold much. The two uploads, a statement and an attachment, have
 * their own, larger limits.
 */
const MAX_BODY_BYTES = 64 * 1024;

/** Where an attachment's bytes are served, under a policy of their own. */
const ATTACHMENT_FILE = "/api/transactions/:id/attachments/:attachmentId";

const tooLarge = () => {
	throw new AppError("PAYLOAD_TOO_LARGE", "The request body is larger than 64 KB.");
};

const tooManySignIns = () =>
	new AppError("TOO_MANY_REQUESTS", "Too many failed sign-ins. Try again in a few minutes.");

/**
 * Lets the sign-in reach Better Auth, then gives the slot back unless it
 * failed. Better Auth has answered by then, a session perhaps created: a
 * failed write must not turn that answer into a 500. The slot then stays
 * taken, which errs on the side of refusing.
 */
async function attempt(
	c: Context,
	next: Next,
	deps: AppDeps,
	reservation: Reservation,
	options: SignInCeilingOptions,
): Promise<void> {
	await next();

	if (c.res.status === 401) {
		return;
	}

	try {
		await releaseAttempt(deps, reservation, options);
	} catch (error) {
		deps.logger.error(
			{ error: error instanceof Error ? error.name : "unknown" },
			"sign-in ceiling: releasing a slot failed",
		);
	}
}

const signInBody = z.object({ email: z.string() });

/**
 * The nonce of the device cookie the request carries, when it is the device of
 * the user it signs in as. The body is read from a clone: Better Auth reads the
 * original. A body that is not JSON names no user, and gets no exemption.
 */
async function knownDevice(c: Context, deps: AppDeps): Promise<string | null> {
	const cookie = getCookie(c, DEVICE_COOKIE);
	const body = signInBody.safeParse(
		await c.req.raw
			.clone()
			.json()
			.catch(() => null),
	);

	if (cookie === undefined || !body.success) {
		return null;
	}

	return knownDeviceNonce(deps, { secret: deps.authSecret, cookie, email: body.data.email });
}

/**
 * Refuses a sign-in, before Better Auth reads it, once too many failed across
 * every address: its own limit is per address, so a guesser with many
 * addresses would otherwise try in parallel. Failures only are counted: a
 * count of attempts would let one address spend the allowance alone and lock
 * the owner out, where a failure needs Better Auth to have let it through.
 *
 * A full ceiling would still lock the owner out, the right password included,
 * so a browser that signed in before passes it on its device cookie, while
 * that device has not failed too often itself (OWASP's device cookies).
 */
function signInCeiling(deps: AppDeps) {
	return createMiddleware(async (c, next) => {
		const reservation = await reserveAttempt(deps);

		if (reservation !== null) {
			await attempt(c, next, deps, reservation, SIGN_IN_CEILING);
			return;
		}

		const nonce = await knownDevice(c, deps);
		const device = nonce === null ? null : deviceCeiling(nonce);
		const deviceReservation = device === null ? null : await reserveAttempt(deps, device);

		if (device === null || deviceReservation === null) {
			throw tooManySignIns();
		}

		await attempt(c, next, deps, deviceReservation, device);
	});
}

// What Better Auth answers when a request created a session. The password step
// of a two-factor sign-in answers `twoFactorRedirect` instead, having proved
// the password only, and a backup code checked without a session has no token.
const sessionCreated = z.object({ token: z.string().min(1), user: z.object({ id: z.string() }) });

/**
 * Sets a new device cookie whenever a sign-in creates a session, so the
 * ceiling above knows this browser next time.
 */
function deviceCookie(deps: AppDeps) {
	return createMiddleware(async (c, next) => {
		await next();

		if (c.res.status !== 200) {
			return;
		}

		const body = sessionCreated.safeParse(
			await c.res
				.clone()
				.json()
				.catch(() => null),
		);

		if (body.success) {
			setCookie(
				c,
				DEVICE_COOKIE,
				signDeviceCookie(deps.authSecret, body.data.user.id),
				deviceCookieOptions(deps.trustedOrigin),
			);
		}
	});
}

/**
 * Every API route, relative to `/api`. Mounts are chained on purpose: `AppType`
 * is read by `hc<AppType>("/api")` in the interface, and a mount registered
 * outside the chain is invisible to it.
 */
function createApi(deps: AppDeps) {
	return new Hono()
		.route("/accounts", accountsRoutes(deps))
		.route("/transactions", transactionsRoutes(deps))
		.route("/transactions/:id/attachments", attachmentsRoutes(deps))
		.route("/transfers", transfersRoutes(deps))
		.route("/budgets", budgetsRoutes(deps))
		.route("/goals", goalsRoutes(deps))
		.route("/snapshots", snapshotsRoutes(deps))
		.route("/imports", importsRoutes(deps))
		.route("/categories", categoriesRoutes(deps))
		.route("/merchants", merchantsRoutes(deps))
		.route("/tags", tagsRoutes(deps))
		.route("/rules", rulesRoutes(deps))
		.route("/assistants", assistantsRoutes(deps))
		.route("/invitations", invitationsRoutes(deps))
		.route("/members", membersRoutes(deps))
		.route("/recurring", recurringRoutes(deps))
		.route("/reports", reportsRoutes(deps))
		.route("/export", exportRoutes(deps))
		.route("/bank-connections", bankConnectionsRoutes(deps))
		.route("/sync", syncRoutes(deps))
		.route("/setup", setupRoutes(deps))
		.route("/version", versionRoutes(deps))
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
function serveInterface(app: Hono<SessionEnv>, root: string) {
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
 * comes before the viewer's refusal of writes, the first-visit sync and every
 * route it protects; `/api` has its own JSON 404 before the interface's
 * fallback, which would otherwise answer an unknown API route with the page.
 */
export function createApp(deps: AppDeps) {
	// Assistants need HTTPS or loopback (`assistantsAvailable`); without them
	// `/api/mcp` is the API's ordinary `404`.
	const mcp = assistantsAvailable(deps.trustedOrigin) ? mcpHandler(deps) : null;

	const app = new Hono()
		// Outermost, so it sees each response as finished, assets included: a
		// page of transactions or the interface's bundle shrinks several times
		// over a home connection. Gzip only, which every browser accepts; under
		// 1 KB the header costs more than it saves. Never on Better Auth's
		// answers: one can carry a session token beside text the request sent,
		// and compressing both lets an observer guess the token from the
		// length (BREACH). Nor on `/api/mcp`'s, for the same reason: an answer
		// holds account names beside what the assistant sent. Nor on
		// `/api/export`'s, a ZIP deflated already, which gzip would only hold
		// back in its buffer.
		.use(
			"*",
			except(
				["/api/auth/*", "/api/mcp", "/api/export"],
				compress({ encoding: "gzip", threshold: 1024 }),
			),
		)
		// Every response, pages and API alike: without `X-Frame-Options` a
		// third-party site could frame the sign-in page and steer a click, and
		// `nosniff` stops a browser from running a file under a type it guessed.
		// `DENY` agrees with the policy's `frame-ancestors 'none'`.
		// The policy keeps injected text from running script. It goes on JSON
		// too: a browser ignores it there, and splitting by path buys nothing.
		.use(
			"*",
			except(
				ATTACHMENT_FILE,
				secureHeaders({
					contentSecurityPolicy: contentSecurityPolicy(deps.bankApiUrl),
					xFrameOptions: "DENY",
				}),
			),
		)
		// An attachment is a file anyone could have crafted: sandboxed, it runs
		// no script and gets an opaque origin, even opened in a tab of its own.
		// Excepted above, since `secureHeaders` overwrites the headers of
		// whatever ran inside it.
		.use(
			ATTACHMENT_FILE,
			secureHeaders({
				contentSecurityPolicy: attachmentContentSecurityPolicy(deps.bankApiUrl),
				xFrameOptions: "DENY",
			}),
		)
		// Before anything reads a body: a declared length over the limit is
		// refused unread, and a chunked body stops being read at the limit.
		.use(
			"/api/*",
			except(
				["/api/accounts/:id/imports", "/api/transactions/:id/attachments"],
				bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }),
			),
		)
		// Before `csrf()` and Better Auth, so a browser on another address than
		// `BETTER_AUTH_URL` gets one code that says what to fix, setup included.
		.use("/api/*", sameOrigin(deps))
		// A form post needs no preflight, so a foreign page could submit an
		// upload with the session cookie attached. JSON requests are left to the
		// browser's CORS preflight, which this API never answers.
		.use(
			"/api/*",
			// The scheduled sync carries a bearer secret, which no foreign page can
			// attach, and a cron's bodiless `curl -X POST` has no content type,
			// which `csrf()` takes for a form from no origin. An assistant's token
			// requests are forms from no origin too, from a command-line client,
			// and carry the client's own proof: a code verifier or a refresh
			// token. `/api/mcp` takes a bearer token and has its own origin check.
			except(
				["/api/sync", "/api/mcp", "/api/auth/oauth2/token", "/api/auth/oauth2/revoke"],
				csrf({ origin: new URL(deps.trustedOrigin).origin }),
			),
		)
		.on("POST", "/api/auth/sign-in/email", signInCeiling(deps))
		.on(
			"POST",
			[
				"/api/auth/sign-in/email",
				"/api/auth/two-factor/verify-totp",
				"/api/auth/two-factor/verify-backup-code",
			],
			deviceCookie(deps),
		)
		// Only an administrator connects an assistant (AD-21). Better Auth's
		// consent endpoint is public, as its whole handler is, so its session is
		// checked here and its role read by the same `requireRole` as every route.
		.on(
			"POST",
			"/api/auth/oauth2/consent",
			requireSession(deps.auth, { always: true }),
			requireRole("admin"),
		)
		// Better Auth answers in its own shape, outside the envelope and outside
		// `AppType`; the interface calls it through `better-auth/react`.
		.on(["GET", "POST"], "/api/auth/*", async (c) =>
			deps.auth.handler(
				withForwardedFor(c.req.raw, deps.clientAddress(c), deps.trustedProxies.length > 0),
			),
		)
		// No session there (AD-19): a strict origin check against DNS rebinding,
		// then the token check and the tools.
		.use("/api/mcp", sameOrigin(deps, { strict: true }))
		.all("/api/mcp", async (c) => (mcp === null ? notFound(c) : mcp(c.req.raw)))
		.use("/api/*", requireSession(deps.auth))
		// Before the day's sync and every route: a viewer's write is refused
		// before anything reads it, and their reads still start the sync.
		.use("/api/*", viewerReadOnly())
		.use("/api/*", dailySync(deps))
		.route("/api", createApi(deps))
		.all("/api/*", notFound);

	if (mcp !== null) {
		// RFC 8414 and RFC 9728 put these at the root, outside `/api`; Better
		// Auth's handler answers both from the plugins' own `onRequest`.
		for (const path of [
			"/.well-known/oauth-authorization-server/api/auth",
			"/.well-known/oauth-protected-resource/api/mcp",
		]) {
			app.on(["GET", "HEAD"], path, async (c) => deps.auth.handler(c.req.raw));
		}
	}

	// Before the interface's fallback, which would answer a discovery request
	// with the page, and a client would take HTML for metadata.
	app.all("/.well-known/*", notFound);

	if (deps.webDist !== undefined) {
		serveInterface(app, deps.webDist);
	}

	app.notFound(notFound);

	app.onError((error, c) => {
		if (error instanceof AppError) {
			return c.json(error.toJSON(), error.status);
		}

		// `csrf()` refused a form post with no origin; `sameOrigin` refuses any other.
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
