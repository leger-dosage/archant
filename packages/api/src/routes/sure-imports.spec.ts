import type { TestApp } from "../testing/auth.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import * as recurringService from "../services/recurring/pipeline.ts";
import {
	buildApp,
	logLines,
	ownDatabase,
	recurringRows,
	template,
	temp,
	useSignedInApp,
} from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";
import { loggedFigures } from "../testing/logs.ts";

useSignedInApp();

const checking = {
	type: "Account",
	data: {
		id: "a1",
		name: "Compte importé",
		balance: "1200.50",
		currency: "EUR",
		accountable_type: "Depository",
		subtype: "checking",
	},
};

const tag = (id: string) => ({ type: "Tag", data: { id, name: id } });

const ndjson = (lines: readonly unknown[]) => lines.map((line) => JSON.stringify(line)).join("\n");

async function post(
	path: "/api/sure-imports" | "/api/sure-imports/preflight",
	body: string,
	{ name = "all.ndjson", app = buildApp() }: { name?: string; app?: TestApp } = {},
) {
	const form = new FormData();
	form.append("file", new File([body], name));
	const response = await app.request(path, { method: "POST", body: form });

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

describe("POST /api/sure-imports/preflight", () => {
	it("answers Sure's counts, errors and warnings, writing nothing", async () => {
		const response = await post(
			"/api/sure-imports/preflight",
			ndjson([
				checking,
				{
					type: "Transaction",
					data: { id: "t", account_id: "x", date: "2026-09-10", amount: "5" },
				},
			]),
		);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			data: {
				counts: { accounts: 1, transactions: 1, budgets: 0 },
				errors: [
					{
						code: "missing_reference",
						params: { line: "2", type: "Transaction", field: "account_id", value: '"x"' },
					},
				],
				warnings: [],
			},
		});
		expect(await temp.db.all(sql`select id from accounts where name = 'Compte importé'`)).toEqual(
			[],
		);
	});

	it.each([
		["export.csv", ndjson([checking])],
		["all.ndjson", ""],
		["all.ndjson", "hello"],
	])("refuses %s holding %j as NDJSON_INVALID", async (name, body) => {
		const response = await post("/api/sure-imports/preflight", body, { name });

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({ error: { code: "NDJSON_INVALID" } });
	});

	it("refuses a file over 10 MB unread, as Sure's default", async () => {
		const body = `${JSON.stringify(checking)}\n${" ".repeat(11 * 1024 * 1024)}`;
		const response = await post("/api/sure-imports/preflight", body);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			error: { code: "IMPORT_FILE_TOO_LARGE", params: { maxSize: "10" } },
		});
	});

	it("refuses more lines than SURE_IMPORT_MAX_ROWS", async () => {
		const app = withSession(
			buildTestApp(temp.db, createLogger("silent"), undefined, {
				sureImport: { maxBytes: 1024 * 1024, maxRows: 2 },
			}),
			template.cookie,
		);
		const response = await post(
			"/api/sure-imports/preflight",
			ndjson([tag("a"), tag("b"), tag("c")]),
			{
				app,
			},
		);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			error: { code: "IMPORT_TOO_MANY_ROWS", params: { max: "2" } },
		});
	});
});

describe("POST /api/sure-imports", () => {
	it("imports the archive, its counts in the answer and the log, no name in it", async () => {
		const response = await post(
			"/api/sure-imports",
			ndjson([
				checking,
				{
					type: "Transaction",
					data: {
						id: "t",
						account_id: "a1",
						date: "2026-09-10",
						amount: "42.90",
						name: "BOULANGERIE",
					},
				},
			]),
		);

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ data: { counts: { accounts: 1, transactions: 1 } } });
		const [account] = await temp.db.all<{ id: string }>(
			sql`select id from accounts where name = 'Compte importé'`,
		);
		const balances = await temp.db.all<{ balance: number }>(
			sql`select balance from balances where account_id = ${account?.id} order by date desc limit 1`,
		);

		// Sure's fallback: the balance the day before the oldest line, then the line in Archant's sign.
		expect(balances).toEqual([{ balance: 120050 - 4290 }]);
		expect(logLines.join("\n")).toContain("sure import finished");
		expect(logLines.join("\n")).not.toContain("BOULANGERIE");
		expect(logLines.join("\n")).not.toContain("Compte importé");
	});

	it("writes nothing when the preflight finds an error", async () => {
		const response = await post(
			"/api/sure-imports",
			ndjson([
				{ ...checking, data: { ...checking.data, id: "a9", name: "Jamais écrit" } },
				{
					type: "Transaction",
					data: { id: "t", account_id: "x", date: "2026-09-10", amount: "5" },
				},
			]),
		);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({ error: { code: "SURE_IMPORT_INVALID" } });
		expect(await temp.db.all(sql`select id from accounts where name = 'Jamais écrit'`)).toEqual([]);
	});

	it("refuses a viewer FORBIDDEN, the preflight too", async () => {
		const silent = createLogger("silent");
		const auth = createTestAuth(temp.db, silent);
		const cookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), cookie);

		const responses = await Promise.all(
			(["/api/sure-imports", "/api/sure-imports/preflight"] as const).map(async (path) =>
				post(path, ndjson([checking]), { app: viewer }),
			),
		);

		expect(responses.map((response) => response.status)).toEqual([403, 403]);
		expect(responses[0]?.body).toMatchObject({ error: { code: "FORBIDDEN" } });
	});
});

/** An account and its subscription on the 5th of July, August and September, in Sure's sign. */
function subscription(name: string) {
	return [
		{ ...checking, data: { ...checking.data, id: "s1", name } },
		...["2026-07-05", "2026-08-05", "2026-09-05"].map((date, index) => ({
			type: "Transaction",
			data: { id: `n${index}`, account_id: "s1", date, amount: "13.99", name: "NETFLIX.COM" },
		})),
	];
}

describe("POST /api/sure-imports, after the write", () => {
	it("takes an archive over the 64 KB every other body is held to", async () => {
		const lines = [
			{ ...checking, data: { ...checking.data, id: "big", name: "Compte volumineux" } },
			...Array.from({ length: 700 }, (_, index) => ({
				type: "Transaction",
				data: {
					id: `big-${index}`,
					account_id: "big",
					date: "2026-09-01",
					amount: "1.00",
					name: `Ligne ${index}`,
				},
			})),
		];
		const body = ndjson(lines);
		expect(body.length).toBeGreaterThan(64 * 1024);

		const response = await post("/api/sure-imports", body);

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ data: { counts: { transactions: 700 } } });
	});

	it("detects recurring transactions once the lines are written", async () => {
		const own = await ownDatabase();

		const response = await post("/api/sure-imports", ndjson(subscription("Abonnements")), {
			app: buildApp(own.db),
		});

		expect(response.status).toBe(201);
		await expect(recurringRows(own.db)).resolves.toEqual([
			expect.objectContaining({ labelKey: "netflix.com", amount: -1399, day: 5, count: 3 }),
		]);
	});

	it("answers 201 when detection throws, and logs the code only", async () => {
		const run = vi
			.spyOn(recurringService, "runRecurring")
			.mockRejectedValue(new Error("SQLITE_ERROR: params [-1399, 'NETFLIX.COM']"));
		const own = await ownDatabase();

		const response = await post("/api/sure-imports", ndjson(subscription("Détection en panne")), {
			app: buildApp(own.db),
		});

		expect(response.status).toBe(201);
		const failures = logLines
			.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
			.filter((line) => line["level"] === 50);
		expect(failures).toEqual([
			expect.objectContaining({ code: "INTERNAL_ERROR", msg: "recurring detection failed" }),
		]);
		expect(loggedFigures(logLines)).not.toMatch(/1399|13\.99|NETFLIX|panne/u);
		expect(run).toHaveBeenCalledWith(expect.anything(), { backfill: false });
	});
});
