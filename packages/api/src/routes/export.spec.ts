import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
	buildApp,
	errorBody,
	openOwn,
	own,
	ownDatabase,
	postOwn,
	temp,
	useSignedInApp,
} from "../testing/app.ts";
import { buildTestApp } from "../testing/auth.ts";

useSignedInApp();

describe("GET /api/export", () => {
	it("streams the archive as an attachment, never compressed again", async () => {
		await ownDatabase();
		const account = await openOwn();
		await postOwn(account.id, { date: "2026-09-10", label: "Boulangerie", amount: "-4,20" });

		const response = await buildApp(own?.db).request("/api/export", {
			headers: { "accept-encoding": "gzip, deflate, br" },
		});
		const files = unzipSync(new Uint8Array(await response.arrayBuffer()));

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="archant_export_20260921_120000.zip"',
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(Object.keys(files)).toEqual([
			"version.txt",
			"accounts.csv",
			"transactions.csv",
			"categories.csv",
			"merchants.csv",
			"rules.csv",
			"attachments.json",
			"all.ndjson",
			"goals.ndjson",
		]);
		expect(strFromU8(files["transactions.csv"] ?? new Uint8Array())).toContain(
			"2026-09-10,Compte joint,4.20,Boulangerie,,,,EUR",
		);
	});

	it("answers a visitor without a session the 401 envelope, and no archive", async () => {
		const response = await buildTestApp(temp.db).request("/api/export");
		const body = await response.text();

		expect(response.status).toBe(401);
		expect(response.headers.get("content-disposition")).toBeNull();
		expect(errorBody.parse(JSON.parse(body)).error.code).toBe("UNAUTHORIZED");
	});
});
