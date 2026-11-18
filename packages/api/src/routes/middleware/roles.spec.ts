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
	freshDatabase,
	openAccount,
	postTransaction,
	temp,
	template,
	useSignedInApp,
	valid,
} from "../../testing/app.ts";
import {
	addTestUser,
	buildTestApp,
	createTestAuth,
	GUEST,
	withSession,
} from "../../testing/auth.ts";
import { isPublicPath, requireSession } from "./auth.ts";
import { requireRole } from "./roles.ts";

useSignedInApp();

const silent = createLogger("silent");

let auth: Auth;
let guestCookie: string;
let memberCookie: string;

// One Better Auth and one sign-in per role for the file: the limit allows three per ten seconds.
beforeAll(async () => {
	auth = createTestAuth(temp.db);
	guestCookie = await addTestUser(buildTestApp(temp.db, silent, auth), auth);
	memberCookie = await addTestUser(buildTestApp(temp.db, silent, auth), auth, "member");
});

const admin = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), template.cookie);
const guest = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), guestCookie);
const member = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), memberCookie);

const WRITING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The reads only an administrator gets (AD-21). */
const ADMIN_READS = [
	"/api/bank-connections/setup",
	"/api/bank-connections/settings",
	"/api/assistants",
	"/api/invitations",
	"/api/members",
	"/api/export",
	"/api/prices",
];

const WRITER_READS = {
	"/api/securities": "?q=MC",
	"/api/transactions/x/rule-prompt": "",
};

const ADMIN_WRITE_GROUPS = [
	"/api/bank-connections",
	"/api/assistants",
	"/api/invitations",
	"/api/members",
	"/api/prices",
];
const ADMIN_WRITES = new Set([
	"DELETE /api/financial-data",
	"DELETE /api/accounts/x/unlink",
	"PUT /api/recurring/settings",
	"PATCH /api/preferences/household",
]);

const refused = {
	status: 403,
	body: { error: { code: "FORBIDDEN", message: "Your role does not allow this." } },
};

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

/** One of Better Auth's own endpoints, as the guest's security page would call it. */
async function viewerPost(path: string, body: unknown) {
	return guest().request(`/api/auth${path}`, {
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

	it("refuses a guest with FORBIDDEN", async () => {
		const response = await guarded(true).request("/api/guarded", {
			headers: { cookie: guestCookie },
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

describe("a guest's writes", () => {
	it("are each refused FORBIDDEN before the route reads its input, never a 400", async () => {
		const routes = guardedRoutes((method) => WRITING_METHODS.has(method));
		const walked = routes.map(({ method, path }) => `${method} ${path}`);

		// Fails if the walk stops finding routes, rather than passing on none.
		expect(routes.length).toBeGreaterThanOrEqual(70);
		// Epics 17 to 19, 21 to 23: budgets, splits, attachments, goals, prices,
		// trades, holdings and recurring series.
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
				"POST /api/accounts/x/trades",
				"PATCH /api/trades/x",
				"DELETE /api/trades/x",
				"POST /api/transactions/x/trade",
				"PUT /api/accounts/x/holdings/x/cost-basis",
				"DELETE /api/accounts/x/holdings/x/cost-basis",
				"POST /api/securities/x/prices",
				"POST /api/recurring/declare",
				"PATCH /api/recurring/x",
				"DELETE /api/recurring/x",
				"POST /api/recurring/cleanup",
				"POST /api/recurring/payments/x/confirm",
				"POST /api/recurring/payments/x/reject",
				"POST /api/recurring/occurrences/x/payments",
				"POST /api/recurring/occurrences/x/paid",
				"POST /api/recurring/occurrences/x/skip",
				"POST /api/recurring/occurrences/x/reopen",
				"PATCH /api/recurring/occurrences/x",
				"DELETE /api/recurring/payments/x",
				"POST /api/transfers/x/confirm",
				"PATCH /api/transfers/x",
				"PUT /api/transfers/x/tags",
				"DELETE /api/financial-data",
			]),
		);

		const answers = await Promise.all(
			routes.map(async ({ method, path }) => answer(guest(), method, path)),
		);

		expect(
			answers.filter(
				({ status, body }) =>
					status !== refused.status || JSON.stringify(body) !== JSON.stringify(refused.body),
			),
		).toEqual([]);
	});

	it("are refused for a method that is neither a read nor one of the four writes", async () => {
		const response = await guest().request("/api/accounts", { method: "OPTIONS" });

		expect(response.status).toBe(403);
	});

	it("leave an administrator's write to the route, which validates it", async () => {
		const { status } = await answer(admin(), "POST", "/api/categories");

		expect(status).toBe(400);
	});
});

describe("member and administrator writes", () => {
	it("opens every ordinary write to a member and reserves administration", async () => {
		const routes = guardedRoutes((method) => WRITING_METHODS.has(method));
		const adminDb = await freshDatabase();
		const memberDb = await freshDatabase();

		try {
			const adminApp = withSession(buildTestApp(adminDb.db, silent), template.cookie);
			const matrixAuth = createTestAuth(memberDb.db);
			const app = buildTestApp(memberDb.db, silent, matrixAuth);
			const memberApp = withSession(app, await addTestUser(app, matrixAuth, "member"));

			// An empty request tests dispatch and authorization. Some routes can
			// write without a body, so each role gets a disposable database.
			const checkRoute = async ({ method, path }: (typeof routes)[number]) => {
				const [adminResponse, memberResponse] = await Promise.all([
					answer(adminApp, method, path),
					answer(memberApp, method, path),
				]);
				const adminOnly =
					ADMIN_WRITES.has(adminResponse.route) ||
					ADMIN_WRITE_GROUPS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

				if (adminResponse.status === 503 && path.startsWith("/api/bank-connections")) {
					expect(adminResponse.body).toMatchObject({
						error: { code: "BANK_CONNECTOR_UNAVAILABLE" },
					});
				} else {
					expect(adminResponse.status, adminResponse.route).toBeLessThan(500);
				}
				expect(adminResponse.status, adminResponse.route).not.toBe(403);

				if (adminOnly) {
					expect(memberResponse, memberResponse.route).toMatchObject(refused);
				} else {
					expect(memberResponse.status, memberResponse.route).toBe(adminResponse.status);
				}
			};

			let checked = Promise.resolve();
			for (const route of routes) {
				checked = checked.then(() => checkRoute(route));
			}
			await checked;
		} finally {
			await adminDb.dispose();
			await memberDb.dispose();
		}
	});

	it("lets members change the ledger, rules, budgets and personal preferences", async () => {
		const app = member();
		const send = (path: string, method: string, body: unknown) =>
			app.request(path, {
				method,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});

		const account = await send("/api/accounts", "POST", valid);
		expect(account.status).toBe(201);
		const { id } = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await account.json()).data;
		expect((await send(`/api/accounts/${id}/transactions`, "POST", expense)).status).toBe(201);

		const accountPath = `/api/accounts/${id}`;
		const bankSetting = await send(accountPath, "PATCH", {
			name: "Refusé",
			treatBalanceAsAvailableCredit: true,
		});
		expect(bankSetting.status).toBe(403);
		await expect((await app.request(accountPath)).json()).resolves.toMatchObject({
			data: { name: valid.name },
		});

		const category = await send("/api/categories", "POST", {
			name: "Courses partagées",
			icon: "tag",
			parentId: null,
		});
		expect(category.status).toBe(201);
		const { id: categoryId } = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await category.json()).data;
		expect(
			(
				await send("/api/rules", "POST", {
					conditions: [{ conditionType: "transaction_name", operator: "like", value: "Courses" }],
					actions: [{ actionType: "set_transaction_category", value: categoryId }],
				})
			).status,
		).toBe(201);
		expect(
			(
				await send("/api/budgets/2026-10", "PUT", {
					budgetedSpending: "100",
					expectedIncome: "120",
				})
			).status,
		).toBe(200);

		const forbidden = await send("/api/preferences", "PATCH", {
			householdLocale: "en",
			locale: "en",
		});
		expect(forbidden.status).toBe(403);
		await expect(forbidden.json()).resolves.toEqual(refused.body);
		const reconciliation = await send("/api/preferences", "PATCH", {
			manualReconciliation: true,
		});
		expect(reconciliation.status).toBe(403);

		const preferences = async (): Promise<unknown> =>
			(await app.request("/api/preferences")).json();
		await expect(preferences()).resolves.toMatchObject({
			data: { locale: null, householdLocale: "fr" },
		});
		expect((await send("/api/preferences", "PATCH", { locale: "en" })).status).toBe(200);
		await expect(preferences()).resolves.toMatchObject({
			data: { locale: "en", householdLocale: "fr" },
		});
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

describe("a guest's reads", () => {
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
		).filter(
			({ path }) =>
				!ADMIN_READS.includes(path) && !(path.replace(transactionId, "x") in WRITER_READS),
		);

		expect(routes.length).toBeGreaterThanOrEqual(34);

		const statuses = async (app: () => TestApp) =>
			Promise.all(
				routes.map(
					async ({ method, path }) => `${path} ${(await answer(app(), method, path)).status}`,
				),
			);

		// The day's first read claims the day's occurrences: a write of the day,
		// which no later read repeats, as the day's sync and prices.
		await answer(guest(), "GET", "/api/accounts");
		const before = await rows();
		const guestStatuses = await statuses(guest);

		await expect(rows()).resolves.toEqual(before);
		expect(guestStatuses).toEqual(
			expect.arrayContaining([
				`/api/accounts/${account.id} 200`,
				`/api/transactions/${transactionId}/attachments 200`,
				"/api/budgets/2026-09 200",
				"/api/goals/summary 200",
				`/api/accounts/${account.id}/trades 200`,
				`/api/accounts/${account.id}/holdings 200`,
				"/api/recurring/bills/all 200",
				"/api/recurring/upcoming 200",
				"/api/recurring/x 404",
			]),
		);
		expect(guestStatuses).toEqual(await statuses(admin));
	});

	it("include HEAD", async () => {
		const response = await guest().request("/api/accounts", { method: "HEAD" });

		expect(response.status).toBe(200);
	});

	it.each(ADMIN_READS)("leave %s to an administrator", async (path) => {
		const responses = await Promise.all([guest().request(path), member().request(path)]);
		const allowed = await admin().request(path);
		await allowed.arrayBuffer();

		expect(responses.map(({ status }) => status)).toEqual([403, 403]);
		await expect(Promise.all(responses.map((response) => response.json()))).resolves.toEqual([
			refused.body,
			refused.body,
		]);
		expect(allowed.status).toBe(200);
	});
	it.each(Object.entries(WRITER_READS))(
		"allows a member to read %s for editing",
		async (path, query) => {
			const url = `${path}${query}`;
			expect((await admin().request(url)).status).toBe(200);
			expect((await member().request(url)).status).toBe(200);
			expect(await answer(guest(), "GET", url)).toMatchObject(refused);
		},
	);
});

describe("a guest's own account", () => {
	it("changes their name, turns two-factor on and changes their password through Better Auth", async () => {
		const name = await viewerPost("/update-user", { name: "Camille" });
		const twoFactor = await viewerPost("/two-factor/enable", { password: GUEST.password });
		const password = await viewerPost("/change-password", {
			currentPassword: GUEST.password,
			newPassword: "a new long enough password",
		});

		expect([name.status, twoFactor.status, password.status]).toEqual([200, 200, 200]);
		await expect(
			temp.db.select({ name: users.name }).from(users).where(eq(users.email, GUEST.email)),
		).resolves.toEqual([{ name: "Camille" }]);
		await expect(
			temp.db
				.select({ id: twoFactors.id })
				.from(twoFactors)
				.innerJoin(users, eq(users.id, twoFactors.userId))
				.where(eq(users.email, GUEST.email)),
		).resolves.toHaveLength(1);
	});
});
