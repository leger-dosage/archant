import type { TestApp } from "../testing/auth.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { buildApp, logLines, openOwn, ownDatabase, temp, useSignedInApp } from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

async function post(
	path: "/api/csv-imports" | "/api/csv-imports/preview",
	fields: Record<string, string>,
	body: string,
	app: TestApp = buildApp(),
) {
	const form = new FormData();

	for (const [name, value] of Object.entries(fields)) {
		form.append(name, value);
	}

	form.append("file", new File([body], "import.csv"));
	const response = await app.request(path, { method: "POST", body: form });

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

describe("POST /api/csv-imports/preview", () => {
	it("answers the headers, the choices, the counts and the errors, writing nothing", async () => {
		const response = await post(
			"/api/csv-imports/preview",
			{ type: "categories" },
			"name,color\nJamais écrite,#ff0000\n,",
		);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			data: {
				headers: ["name", "color"],
				counts: { categories: 1 },
				errors: [],
			},
		});
		expect(await temp.db.all(sql`select id from categories where name = 'Jamais écrite'`)).toEqual(
			[],
		);
	});

	it("reads the choices as JSON text", async () => {
		const response = await post(
			"/api/csv-imports/preview",
			{
				type: "accounts",
				configuration: JSON.stringify({ separator: ";", numberFormat: "1 234,56" }),
				mappings: JSON.stringify({
					accountTypes: [{ key: "Livret", type: "depository", subtype: "savings" }],
				}),
			},
			"type;name;balance\nLivret;Livret A;1 234,56",
		);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			data: {
				configuration: { separator: ";", numberFormat: "1 234,56" },
				mappings: {
					accountTypes: [{ key: "Livret", count: 1, type: "depository", subtype: "savings" }],
				},
				errors: [],
			},
		});
	});

	it.each([
		[{ type: "budgets" }, "type"],
		[{ type: "accounts", configuration: "{" }, "configuration"],
		[
			{ type: "accounts", configuration: JSON.stringify({ separator: "|" }) },
			"configuration.separator",
		],
		[
			{ type: "merchants", edits: JSON.stringify([{ line: 2, key: "budget", value: "x" }]) },
			"edits.0.key",
		],
		[
			{ type: "merchants", edits: JSON.stringify([{ line: 0, key: "name", value: "x" }]) },
			"edits.0.line",
		],
		[
			{
				type: "merchants",
				edits: JSON.stringify([{ line: 2, key: "name", value: "x".repeat(10_001) }]),
			},
			"edits.0.value",
		],
	])("refuses %j as VALIDATION_ERROR on %s", async (fields, path) => {
		const response = await post("/api/csv-imports/preview", fields, "name\nA");

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			error: { code: "VALIDATION_ERROR", fields: [expect.objectContaining({ path })] },
		});
	});

	it("reads « Nettoyer »'s edits as JSON text", async () => {
		const response = await post(
			"/api/csv-imports/preview",
			{ type: "merchants", edits: JSON.stringify([{ line: 2, key: "name", value: "Corrigé" }]) },
			"name\nTypo",
		);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			data: {
				clean: {
					columns: ["name", "merchant_color", "merchant_website"],
					rows: [{ line: 2, values: ["Corrigé", "", ""] }],
				},
			},
		});
	});

	it("refuses a file with no data row as CSV_INVALID", async () => {
		const response = await post("/api/csv-imports/preview", { type: "merchants" }, "name\n");

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({ error: { code: "CSV_INVALID" } });
	});

	it("refuses a file over 10 MB unread, as Sure's MAX_CSV_SIZE", async () => {
		const response = await post(
			"/api/csv-imports/preview",
			{ type: "merchants" },
			`name\nA\n${" ".repeat(11 * 1024 * 1024)}`,
		);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			error: { code: "IMPORT_FILE_TOO_LARGE", params: { maxSize: "10" } },
		});
	});

	it("refuses 51 account rows, as Sure's max_row_count", async () => {
		const rows = Array.from({ length: 51 }, (_, index) => `Compte ${index},1`);
		const response = await post(
			"/api/csv-imports/preview",
			{ type: "accounts" },
			["name,balance", ...rows].join("\n"),
		);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			error: { code: "IMPORT_TOO_MANY_ROWS", params: { max: "50" } },
		});
	});
});

describe("POST /api/csv-imports", () => {
	it("imports the file, its counts in the answer and the log, no name in it", async () => {
		const own = await ownDatabase();
		const response = await post(
			"/api/csv-imports",
			{ type: "merchants" },
			"name\nBoulangerie du Coin",
			buildApp(own.db),
		);

		expect(response.status).toBe(201);
		expect(response.body).toEqual({ data: { counts: { merchants: 1 } } });
		expect(await own.db.all(sql`select name from merchants`)).toEqual([
			{ name: "Boulangerie du Coin" },
		]);
		expect(logLines.join("\n")).toContain("csv import finished");
		expect(logLines.join("\n")).not.toContain("Boulangerie");
	});

	it("takes a file over the 64 KB every other body is held to", async () => {
		const own = await ownDatabase();
		const rows = Array.from({ length: 5000 }, (_, index) => `Marchand numéro ${index}`);
		const body = ["name", ...rows].join("\n");
		expect(body.length).toBeGreaterThan(64 * 1024);

		const preview = await post(
			"/api/csv-imports/preview",
			{ type: "merchants" },
			body,
			buildApp(own.db),
		);
		const response = await post("/api/csv-imports", { type: "merchants" }, body, buildApp(own.db));

		expect(preview.status).toBe(200);
		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ data: { counts: { merchants: 5000 } } });
	});

	it("writes nothing when the preview finds an error", async () => {
		const own = await ownDatabase();
		const response = await post(
			"/api/csv-imports",
			{ type: "categories" },
			"name,color,parent_category,lucide_icon\nJamais,,,\nFood,,Food,",
			buildApp(own.db),
		);

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({ error: { code: "CSV_IMPORT_INVALID" } });
		expect(await own.db.all(sql`select id from categories`)).toEqual([]);
	});

	it("previews and imports a transactions file into the chosen account", async () => {
		const own = await ownDatabase();
		const app = buildApp(own.db);
		const { id } = await openOwn();
		const configuration = JSON.stringify({
			accountId: id,
			columns: { date: "Date", amount: "Montant", name: "Libellé" },
		});
		const file = "Date,Montant,Libellé\n2026-09-01,-12.5,Boulangerie";
		const read = await post(
			"/api/csv-imports/preview",
			{ type: "transactions", configuration },
			file,
			app,
		);

		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({
			data: { counts: { transactions: 1, categories: 0, tags: 0 }, errors: [] },
		});

		const published = await post(
			"/api/csv-imports",
			{ type: "transactions", configuration },
			file,
			app,
		);

		expect(published.status).toBe(201);
		expect(
			await own.db.all(
				sql`select t.label, e.amount from transactions t join entries e on e.id = t.entry_id`,
			),
		).toEqual([{ label: "Boulangerie", amount: -1250 }]);
	});

	it("imports a YNAB file with its columns preset, ignoring an account sent at upload", async () => {
		const own = await ownDatabase();
		const app = buildApp(own.db);
		const { id } = await openOwn({ name: "Compte joint" });
		const checking = await openOwn({ name: "Checking" });
		const published = await post(
			"/api/csv-imports",
			{ type: "ynab", configuration: JSON.stringify({ accountId: id }) },
			"Account,Date,Payee,Outflow,Inflow\nChecking,09/02/2026,Boulangerie,$12.50,",
			app,
		);

		expect(published.status).toBe(201);
		expect(published.body).toMatchObject({ data: { counts: { transactions: 1, accounts: 0 } } });
		expect(
			await own.db.all(
				sql`select e.account_id as account, e.amount from transactions t join entries e on e.id = t.entry_id`,
			),
		).toEqual([{ account: checking.id, amount: -1250 }]);
	});

	it("refuses a viewer FORBIDDEN, the preview too", async () => {
		const silent = createLogger("silent");
		const auth = createTestAuth(temp.db, silent);
		const cookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), cookie);

		const responses = await Promise.all(
			(["/api/csv-imports", "/api/csv-imports/preview"] as const).map(async (path) =>
				post(path, { type: "merchants" }, "name\nA", viewer),
			),
		);

		expect(responses.map((response) => response.status)).toEqual([403, 403]);
		expect(responses[0]?.body).toMatchObject({ error: { code: "FORBIDDEN" } });
	});
});
