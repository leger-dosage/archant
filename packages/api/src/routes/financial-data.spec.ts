import type { Auth } from "../services/auth.ts";
import type { TestApp } from "../testing/auth.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

import { bankConnections } from "@archant/data/schema/bank-connections";

import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
	errorBody,
	expense,
	logLines,
	openAccount,
	openOwn,
	ownDatabase,
	postOwn,
	postTransaction,
	temp,
	useSignedInApp,
} from "../testing/app.ts";
import {
	addViewer,
	buildTestApp,
	createTestAuth,
	TEST_ORIGIN,
	withSession,
} from "../testing/auth.ts";
import { financialDataRoutes } from "./financial-data.ts";
import { requireSession } from "./middleware/auth.ts";

useSignedInApp();

const silent = createLogger("silent");

let auth: Auth;
let viewerCookie: string;

// One Better Auth and one viewer sign-in for the file: the limit allows three per ten seconds.
beforeAll(async () => {
	auth = createTestAuth(temp.db, silent);
	viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
});

const viewer = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

async function count(db: typeof temp.db, table: "accounts" | "entries" | "users" | "goals") {
	const row = await db.get<{ count: number }>(
		sql`select count(*) as count from ${sql.identifier(table)}`,
	);

	return row?.count ?? 0;
}

/**
 * The route behind the session guard alone, without `viewerReadOnly`, so its
 * own `requireRole("admin")` is what answers a viewer.
 */
function sessionGuardOnly() {
	const app = new Hono<SessionEnv>();

	app.use("*", requireSession(auth));
	app.route(
		"/api/financial-data",
		financialDataRoutes({ db: temp.db, timeZone: "Europe/Paris", logger: silent }),
	);
	app.onError((error, c) =>
		error instanceof AppError ? c.json(error.toJSON(), error.status) : c.text("", 500),
	);

	return app;
}

describe("DELETE /api/financial-data", () => {
	it("answers an empty household 200 with no data", async () => {
		const { db } = await ownDatabase();

		const response = await buildApp(db).request("/api/financial-data", { method: "DELETE" });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: null });
		expect(await count(db, "accounts")).toBe(0);
	});

	it("deletes every account and transaction for an administrator, users kept", async () => {
		const { db } = await ownDatabase();
		const account = await openOwn();
		await postOwn(account.id, { date: "2026-09-10", label: "Boulangerie", amount: "-4,20" });
		const users = await count(db, "users");

		const response = await buildApp(db).request("/api/financial-data", { method: "DELETE" });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: null });
		expect(await count(db, "accounts")).toBe(0);
		expect(await count(db, "entries")).toBe(0);
		expect(await count(db, "users")).toBe(users);
		// An id, never a name or an amount.
		expect(logLines.join("\n")).toContain('"msg":"financial data reset"');
		expect(logLines.join("\n")).not.toContain("Boulangerie");
	});

	it("answers 409 SYNC_IN_PROGRESS while a sync holds a bank's lease, deleting nothing", async () => {
		const { db } = await ownDatabase();
		await openOwn();
		const now = Date.now();
		await db.insert(bankConnections).values({
			id: crypto.randomUUID(),
			connector: "enable-banking",
			institutionName: "Banque",
			country: "FR",
			status: "active",
			syncStartedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const response = await buildApp(db).request("/api/financial-data", { method: "DELETE" });

		expect(response.status).toBe(409);
		expect(errorBody.parse(await response.json()).error.code).toBe("SYNC_IN_PROGRESS");
		expect(await count(db, "accounts")).toBe(1);
		expect(logLines.join("\n")).not.toContain("financial data reset");
	});

	it("refuses a viewer FORBIDDEN, the household intact", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const before = [await count(temp.db, "accounts"), await count(temp.db, "entries")];

		const response = await viewer().request("/api/financial-data", { method: "DELETE" });

		expect(response.status).toBe(403);
		expect(errorBody.parse(await response.json()).error.code).toBe("FORBIDDEN");
		expect([await count(temp.db, "accounts"), await count(temp.db, "entries")]).toEqual(before);
	});

	it("refuses a viewer FORBIDDEN through its own guard, without viewerReadOnly", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const before = [await count(temp.db, "accounts"), await count(temp.db, "entries")];

		const response = await sessionGuardOnly().request("/api/financial-data", {
			method: "DELETE",
			headers: { cookie: viewerCookie },
		});

		expect(response.status).toBe(403);
		expect(errorBody.parse(await response.json()).error.code).toBe("FORBIDDEN");
		expect([await count(temp.db, "accounts"), await count(temp.db, "entries")]).toEqual(before);
	});

	it("answers a visitor without a session 401, the household intact", async () => {
		const before = await count(temp.db, "accounts");

		// From the interface's origin, so the session guard answers, not the origin check.
		const response = await buildTestApp(temp.db).request("/api/financial-data", {
			method: "DELETE",
			headers: { origin: TEST_ORIGIN },
		});

		expect(response.status).toBe(401);
		expect(errorBody.parse(await response.json()).error.code).toBe("UNAUTHORIZED");
		expect(await count(temp.db, "accounts")).toBe(before);
	});
});

describe("DELETE /api/financial-data?sampleData=true", () => {
	it("replaces the household with Sure's sample for an administrator", async () => {
		const { db } = await ownDatabase();
		const account = await openOwn({ name: "Compte à effacer" });
		await postOwn(account.id, { date: "2026-09-10", label: "Boulangerie", amount: "-4,20" });

		const response = await buildApp(db).request("/api/financial-data?sampleData=true", {
			method: "DELETE",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: null });
		expect(await count(db, "accounts")).toBe(20);
		expect(await count(db, "goals")).toBe(9);
		expect(await db.all(sql`select id from accounts where name = 'Compte à effacer'`)).toEqual([]);
		// An id, never a name or an amount.
		expect(logLines.join("\n")).toContain('"sampleData":true');
		expect(logLines.join("\n")).not.toContain("Boulangerie");
		expect(logLines.join("\n")).not.toContain("Compte courant");
	});

	it("answers 409 SYNC_IN_PROGRESS while a sync holds a bank's lease, writing nothing", async () => {
		const { db } = await ownDatabase();
		await openOwn();
		const now = Date.now();
		await db.insert(bankConnections).values({
			id: crypto.randomUUID(),
			connector: "enable-banking",
			institutionName: "Banque",
			country: "FR",
			status: "active",
			syncStartedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const response = await buildApp(db).request("/api/financial-data?sampleData=true", {
			method: "DELETE",
		});

		expect(response.status).toBe(409);
		expect(errorBody.parse(await response.json()).error.code).toBe("SYNC_IN_PROGRESS");
		expect(await count(db, "accounts")).toBe(1);
		expect(await count(db, "goals")).toBe(0);
	});

	it("refuses a viewer FORBIDDEN through its own guard, the household intact", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);
		const before = [await count(temp.db, "accounts"), await count(temp.db, "entries")];

		const response = await sessionGuardOnly().request("/api/financial-data?sampleData=true", {
			method: "DELETE",
			headers: { cookie: viewerCookie },
		});

		expect(response.status).toBe(403);
		expect(errorBody.parse(await response.json()).error.code).toBe("FORBIDDEN");
		expect([await count(temp.db, "accounts"), await count(temp.db, "entries")]).toEqual(before);
	});

	it("runs the plain reset with sampleData=false, no account left", async () => {
		const { db } = await ownDatabase();
		await openOwn();

		const response = await buildApp(db).request("/api/financial-data?sampleData=false", {
			method: "DELETE",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: null });
		expect(await count(db, "accounts")).toBe(0);
		expect(await count(db, "goals")).toBe(0);
	});

	it("refuses another value than true or false VALIDATION_ERROR, the household intact", async () => {
		const { db } = await ownDatabase();
		await openOwn();

		const response = await buildApp(db).request("/api/financial-data?sampleData=yes", {
			method: "DELETE",
		});

		expect(response.status).toBe(400);
		expect(errorBody.parse(await response.json()).error.code).toBe("VALIDATION_ERROR");
		expect(await count(db, "accounts")).toBe(1);
	});
});
