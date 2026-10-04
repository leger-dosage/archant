import type { Auth } from "../../services/auth.ts";
import type { TestApp } from "../../testing/auth.ts";
import type { SessionEnv } from "./auth.ts";

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { twoFactors, users } from "@archant/data/schema/auth";

import { AppError } from "../../lib/errors.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	expense,
	openAccount,
	postTransaction,
	temp,
	template,
	useSignedInApp,
} from "../../testing/app.ts";
import {
	addViewer,
	buildTestApp,
	createTestAuth,
	VIEWER,
	withSession,
} from "../../testing/auth.ts";
import { isPublicPath, requireSession } from "./auth.ts";
import { requireRole } from "./roles.ts";

useSignedInApp();

const silent = createLogger("silent");

let auth: Auth;
let viewerCookie: string;

// One Better Auth and one viewer sign-in for the file: the limit allows three per ten seconds.
beforeAll(async () => {
	auth = createTestAuth(temp.db);
	viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
});

const admin = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), template.cookie);
const viewer = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

const WRITING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The reads only an administrator gets (AD-21). */
const ADMIN_READS = [
	"/api/bank-connections/setup",
	"/api/assistants",
	"/api/invitations",
	"/api/members",
	"/api/export",
	"/api/prices",
	"/api/securities",
];

/** The query an administrator's read of these paths needs to answer 200. */
const ADMIN_READ_QUERIES: Record<string, string> = { "/api/securities": "?q=MC" };

/**
 * Every route of the running app under `/api` behind the session guard, its
 * parameters filled in by `fill`, `x` by default. Read from the route table
 * rather than listed, so a route added later is walked without editing this
 * file. Better Auth's routes and `/api/mcp` are public paths, and a wildcard
 * is a middleware, not a route.
 */
function guardedRoutes(
	methods: (method: string) => boolean,
	fill: (path: string) => string = (path) => path,
): { method: string; path: string }[] {
	const routes = buildTestApp(temp.db, silent, auth)
		.routes.filter(
			({ method, path }) =>
				methods(method) && path.startsWith("/api/") && !path.includes("*") && !isPublicPath(path),
		)
		.map(({ method, path }) => `${method} ${fill(path).replaceAll(/:[^/]+/gu, "x")}`);

	return [...new Set(routes)].map((route) => {
		const [method = "", path = ""] = route.split(" ");

		return { method, path };
	});
}

async function answer(app: TestApp, method: string, path: string) {
	const response = await app.request(path, { method });
	const body: unknown = await response.json().catch(() => null);

	return { route: `${method} ${path}`, status: response.status, body };
}

/** A route behind `requireRole("admin")` alone, with or without the session guard before it. */
function guarded(sessionGuard: boolean) {
	const app = new Hono<SessionEnv>();

	if (sessionGuard) {
		app.use("*", requireSession(auth));
	}

	app.get("/api/guarded", requireRole("admin"), (c) => c.json({ data: null }, 200));
	app.onError((error, c) =>
		error instanceof AppError ? c.json(error.toJSON(), error.status) : c.text("", 500),
	);

	return app;
}

/** One of Better Auth's own endpoints, as the viewer's security page would call it. */
async function viewerPost(path: string, body: unknown) {
	return viewer().request(`/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("requireRole", () => {
	it("lets an administrator through", async () => {
		const response = await guarded(true).request("/api/guarded", {
			headers: { cookie: template.cookie },
		});

		expect(response.status).toBe(200);
	});

	it("refuses a viewer with FORBIDDEN", async () => {
		const response = await guarded(true).request("/api/guarded", {
			headers: { cookie: viewerCookie },
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Your role does not allow this." },
		});
	});

	it("refuses when no session guard put a user on the context", async () => {
		const response = await guarded(false).request("/api/guarded", {
			headers: { cookie: template.cookie },
		});

		expect(response.status).toBe(403);
	});
});

describe("a viewer's writes", () => {
	it("are each refused FORBIDDEN before the route reads its input, never a 400", async () => {
		const routes = guardedRoutes((method) => WRITING_METHODS.has(method));
		const walked = routes.map(({ method, path }) => `${method} ${path}`);

		// Fails if the walk stops finding routes, rather than passing on none.
		expect(routes.length).toBeGreaterThanOrEqual(64);
		// Epics 17 to 19, 21 and 22: budgets, splits, attachments, goals and prices.
		expect(walked).toEqual(
			expect.arrayContaining([
				"PUT /api/budgets/x",
				"POST /api/budgets/x/move",
				"POST /api/transactions/x/split",
				"DELETE /api/transactions/x/split",
				"POST /api/transactions/x/attachments",
				"DELETE /api/transactions/x/attachments/x",
				"POST /api/goals",
				"PUT /api/goals/x",
				"DELETE /api/goals/x",
				"POST /api/goals/x/x",
				"PUT /api/prices/settings",
				"POST /api/prices/update",
			]),
		);

		const answers = await Promise.all(
			routes.map(async ({ method, path }) => answer(viewer(), method, path)),
		);
		const refused = {
			status: 403,
			body: { error: { code: "FORBIDDEN", message: "Your role does not allow this." } },
		};

		expect(
			answers.filter(
				({ status, body }) =>
					status !== refused.status || JSON.stringify(body) !== JSON.stringify(refused.body),
			),
		).toEqual([]);
	});

	it("are refused for a method that is neither a read nor one of the four writes", async () => {
		const response = await viewer().request("/api/accounts", { method: "OPTIONS" });

		expect(response.status).toBe(403);
	});

	it("leave an administrator's write to the route, which validates it", async () => {
		const { status } = await answer(admin(), "POST", "/api/categories");

		expect(status).toBe(400);
	});
});

/** Tables a read may write: the session's refresh and Better Auth's rate limit. */
const WRITTEN_BY_READS = new Set([
	"sessions",
	"rate_limits",
	"verifications",
	"__drizzle_migrations",
]);

/** Every row of every table a read must leave as it is. */
async function rows(): Promise<Record<string, unknown[]>> {
	const tables = await temp.db.all<{ name: string }>(
		sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
	);
	const kept = tables.filter(({ name }) => !WRITTEN_BY_READS.has(name));
	const contents = await Promise.all(
		kept.map(async ({ name }) => temp.db.all(sql`select * from ${sql.identifier(name)}`)),
	);

	return Object.fromEntries(kept.map(({ name }, index) => [name, contents[index] ?? []]));
}

describe("a viewer's reads", () => {
	it("each answer as the administrator's do, and write nothing", async () => {
		const account = await openAccount();
		const { body } = await postTransaction(account.id, expense);
		const transactionId = z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
		const routes = guardedRoutes(
			(method) => method === "GET",
			(path) =>
				path
					.replace(/^\/api\/accounts\/:id/u, `/api/accounts/${account.id}`)
					.replace(/^\/api\/transactions\/:id/u, `/api/transactions/${transactionId}`)
					.replace(":month", "2026-09"),
		).filter(({ path }) => !ADMIN_READS.includes(path));

		expect(routes.length).toBeGreaterThanOrEqual(33);

		const statuses = async (app: () => TestApp) =>
			Promise.all(
				routes.map(
					async ({ method, path }) => `${path} ${(await answer(app(), method, path)).status}`,
				),
			);

		const before = await rows();
		const viewerStatuses = await statuses(viewer);

		await expect(rows()).resolves.toEqual(before);
		expect(viewerStatuses).toEqual(
			expect.arrayContaining([
				`/api/accounts/${account.id} 200`,
				`/api/transactions/${transactionId}/attachments 200`,
				"/api/budgets/2026-09 200",
				"/api/goals/summary 200",
			]),
		);
		expect(viewerStatuses).toEqual(await statuses(admin));
	});

	it("include HEAD", async () => {
		const response = await viewer().request("/api/accounts", { method: "HEAD" });

		expect(response.status).toBe(200);
	});

	it.each(ADMIN_READS)("leave %s to an administrator", async (path) => {
		const url = `${path}${ADMIN_READ_QUERIES[path] ?? ""}`;
		const refused = await viewer().request(url);
		const allowed = await admin().request(url);
		await allowed.arrayBuffer();

		expect(refused.status).toBe(403);
		await expect(refused.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
		expect(allowed.status).toBe(200);
	});
});

describe("a viewer's own account", () => {
	it("changes their name, turns two-factor on and changes their password through Better Auth", async () => {
		const name = await viewerPost("/update-user", { name: "Camille" });
		const twoFactor = await viewerPost("/two-factor/enable", { password: VIEWER.password });
		const password = await viewerPost("/change-password", {
			currentPassword: VIEWER.password,
			newPassword: "a new long enough password",
		});

		expect([name.status, twoFactor.status, password.status]).toEqual([200, 200, 200]);
		await expect(
			temp.db.select({ name: users.name }).from(users).where(eq(users.email, VIEWER.email)),
		).resolves.toEqual([{ name: "Camille" }]);
		await expect(
			temp.db
				.select({ id: twoFactors.id })
				.from(twoFactors)
				.innerJoin(users, eq(users.id, twoFactors.userId))
				.where(eq(users.email, VIEWER.email)),
		).resolves.toHaveLength(1);
	});
});
