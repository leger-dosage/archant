import type { Auth } from "../services/auth.ts";

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_DASHBOARD_ORDER } from "@archant/data/dashboard-sections";

import { createLogger } from "../lib/logger.ts";
import { buildApp, errorBody, ownDatabase, temp, useSignedInApp } from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

const layoutBody = z.object({
	data: z.strictObject({
		sectionOrder: z.array(z.string()),
		hiddenSections: z.array(z.string()),
		collapsedSections: z.record(z.string(), z.boolean()),
		sectionLayout: z.record(
			z.string(),
			z.strictObject({ height: z.string(), colSpan: z.string() }),
		),
	}),
});

async function send(app: ReturnType<typeof buildApp>, method: string, body?: unknown) {
	const response = await app.request("/api/dashboard/layout", {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

async function ownApp() {
	const own = await ownDatabase();

	return { app: buildApp(own.db), db: own.db };
}

const stored = async (db: typeof temp.db) =>
	(await db.all<{ layout: string | null }>(sql`select dashboard_layout as layout from users`)).map(
		(row) => row.layout,
	);

describe("GET /api/dashboard/layout", () => {
	it("reads Sure's default for a user who never arranged the dashboard", async () => {
		const { app } = await ownApp();

		const read = await send(app, "GET");

		expect(read.status).toBe(200);
		const { data } = layoutBody.parse(read.body);
		expect(data.sectionOrder).toEqual(DEFAULT_DASHBOARD_ORDER);
		expect(data.hiddenSections).toEqual([]);
		expect(data.sectionLayout["cashflow_sankey"]).toEqual({ height: "auto", colSpan: "full" });
	});

	it("drops a stored key the code no longer knows", async () => {
		const { app, db } = await ownApp();
		await db.run(
			sql`update users set dashboard_layout = ${JSON.stringify({ sectionOrder: ["insights_feed", "goals"] })}`,
		);

		const { data } = layoutBody.parse((await send(app, "GET")).body);

		expect(data.sectionOrder[0]).toBe("goals");
		expect(data.sectionOrder).not.toContain("insights_feed");
		expect(data.sectionOrder).toHaveLength(DEFAULT_DASHBOARD_ORDER.length);
	});
});

describe("PATCH /api/dashboard/layout", () => {
	it("saves each change and reads it back, sizes merged key by key", async () => {
		const { app } = await ownApp();

		await send(app, "PATCH", { sectionLayout: { net_worth_chart: { height: "compact" } } });
		await send(app, "PATCH", { collapsedSections: { balance_sheet: true } });
		await send(app, "PATCH", { hiddenSections: { money_flow: true } });
		const saved = await send(app, "PATCH", {
			sectionLayout: { net_worth_chart: { colSpan: "full" } },
			sectionOrder: ["balance_sheet", "cashflow_sankey"],
		});
		const read = await send(app, "GET");

		expect(saved.status).toBe(200);
		expect(read.body).toEqual(saved.body);
		const { data } = layoutBody.parse(read.body);
		expect(data.sectionLayout["net_worth_chart"]).toEqual({ height: "compact", colSpan: "full" });
		expect(data.collapsedSections["balance_sheet"]).toBe(true);
		expect(data.hiddenSections).toEqual(["money_flow"]);
		// `money_flow` followed `balance_sheet` in the default order, and stays after it.
		expect(data.sectionOrder.slice(0, 3)).toEqual([
			"balance_sheet",
			"money_flow",
			"cashflow_sankey",
		]);
	});

	it("shows a hidden widget again", async () => {
		const { app } = await ownApp();
		await send(app, "PATCH", { hiddenSections: { goals: true, money_flow: true } });

		const shown = await send(app, "PATCH", { hiddenSections: { goals: false } });

		expect(layoutBody.parse(shown.body).data.hiddenSections).toEqual(["money_flow"]);
	});

	it.each([
		[{ sectionOrder: ["insights_feed"] }, "sectionOrder.0", "invalid_value"],
		[{ hiddenSections: { foo: true } }, "hiddenSections.foo", "unrecognized_keys"],
		[
			{ collapsedSections: { insights_feed: true } },
			"collapsedSections.insights_feed",
			"unrecognized_keys",
		],
		[{ sectionOrder: ["goals", "goals"] }, "sectionOrder", "duplicate_section"],
		[
			{ sectionLayout: { outflows_donut: { height: "tall" } } },
			"sectionLayout.outflows_donut.height",
			"size_not_offered",
		],
		[
			{ sectionLayout: { goals: { colSpan: "full" } } },
			"sectionLayout.goals.colSpan",
			"size_not_offered",
		],
		[
			{ sectionLayout: { balance_sheet: { height: "tall" } } },
			"sectionLayout.balance_sheet.height",
			"size_not_offered",
		],
		[
			{ sectionLayout: { net_worth_chart: { height: "huge" } } },
			"sectionLayout.net_worth_chart.height",
			"invalid_value",
		],
		[{ layout: {} }, "layout", "unrecognized_keys"],
	])("refuses %j with VALIDATION_ERROR, nothing stored", async (body, path, code) => {
		const { app, db } = await ownApp();

		const refused = await send(app, "PATCH", body);

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code }],
		});
		expect(await stored(db)).toEqual([null]);
	});

	describe("as a viewer", () => {
		const silent = createLogger("silent");
		let auth: Auth;
		let viewerCookie: string;

		// One viewer sign-in for the block: Better Auth allows three per ten seconds.
		beforeAll(async () => {
			auth = createTestAuth(temp.db, silent);
			viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
		});

		const viewer = () => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		it("reads the default, and is refused FORBIDDEN on a save, nothing written", async () => {
			const refused = await send(viewer(), "PATCH", { hiddenSections: { goals: true } });
			const read = await send(viewer(), "GET");

			expect(refused.status).toBe(403);
			expect(errorBody.parse(refused.body).error.code).toBe("FORBIDDEN");
			expect(layoutBody.parse(read.body).data.hiddenSections).toEqual([]);
			expect(
				await temp.db.all(sql`select 1 from users where dashboard_layout is not null`),
			).toEqual([]);
		});

		it("keeps another user's layout apart from the administrator's", async () => {
			const saved = await send(buildApp(), "PATCH", { collapsedSections: { goals: true } });
			const read = await send(viewer(), "GET");

			expect(saved.status).toBe(200);
			expect(layoutBody.parse(read.body).data.collapsedSections["goals"]).toBe(false);
			expect(
				await temp.db.all<{ role: string }>(
					sql`select role from users where dashboard_layout is not null`,
				),
			).toEqual([{ role: "admin" }]);
		});
	});
});
