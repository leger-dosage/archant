import { sql } from "drizzle-orm";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "./lib/logger.ts";
import { MAX_IMPORT_BYTES } from "./schemas/imports.ts";
import * as accountsService from "./services/accounts.ts";
import {
	buildApp,
	errorBody,
	expense,
	listBody,
	logLines,
	openAccount,
	openOwn,
	own,
	paddedOfx,
	postOwn,
	temp,
	template,
	upload,
	uploaded,
	useSignedInApp,
} from "./testing/app.ts";
import { buildTestApp, withSession } from "./testing/auth.ts";

useSignedInApp();

/** The body of a gzipped response, as a browser decodes it. */
async function gunzipped(response: Response): Promise<string> {
	if (response.body === null) {
		throw new Error("The response has no body.");
	}

	return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
}

describe("compressed API answers", () => {
	it("gzips a page of transactions for a client that accepts it, and only then", async () => {
		const account = await openOwn();
		await Array.from({ length: 20 }, (_, index) => index).reduce(async (previous, index) => {
			await previous;
			await postOwn(account.id, { ...expense, label: `Courses ${index}` });
		}, Promise.resolve());
		const app = buildApp(own?.db);

		const gzipped = await app.request("/api/transactions", {
			headers: { "accept-encoding": "gzip" },
		});
		const plain = await app.request("/api/transactions");

		expect(gzipped.headers.get("content-encoding")).toBe("gzip");
		expect(gzipped.headers.get("vary")).toContain("Accept-Encoding");
		const body = listBody.parse(JSON.parse(await gunzipped(gzipped)));
		expect(body.data.items).toHaveLength(20);
		expect(plain.headers.get("content-encoding")).toBeNull();
		expect(listBody.parse(await plain.json()).data.items).toHaveLength(20);
	});
});

describe("uncompressed auth answers", () => {
	it("never gzips Better Auth's answers, which can carry a session token", async () => {
		const response = await buildApp().request("/api/auth/get-session", {
			headers: { "accept-encoding": "gzip" },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(
			z.object({ session: z.object({ token: z.string() }) }).parse(await response.json()),
		).toBeDefined();
	});
});

describe("errors", () => {
	it("answers an unknown route with NOT_FOUND", async () => {
		const response = await buildApp().request("/api/nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json())).toEqual({
			error: { code: "NOT_FOUND", message: "No route matches GET /api/nope" },
		});
	});

	it("hides an unexpected failure behind INTERNAL_ERROR and logs its name and path only", async () => {
		vi.spyOn(accountsService, "listAccounts").mockRejectedValue(
			new Error("SQLITE_ERROR: params [123456, 'FR76 1234']"),
		);

		const response = await buildApp().request("/api/accounts");
		const body = await response.text();

		expect(response.status).toBe(500);
		expect(errorBody.parse(JSON.parse(body))).toEqual({
			error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
		});
		expect(body).not.toContain("123456");
		expect(logLines).toHaveLength(1);
		expect(logLines[0]).toContain('"path":"/api/accounts"');
		expect(logLines[0]).toContain('"error":"Error"');
		expect(logLines[0]).not.toContain("123456");
		expect(logLines[0]).not.toContain("stack");
	});

	it("answers any path with NOT_FOUND when there is no interface to serve", async () => {
		const response = await buildApp().request("/");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});
});

// The I/O matrix of Story 3.3: the built interface served beside the API.
describe("serving the interface", () => {
	let webDist: string;
	const page = "<!doctype html><title>Archant</title>";
	const script = "console.log('archant');";
	const bigScript = `${script}\n`.repeat(200);

	beforeAll(async () => {
		webDist = await mkdtemp(join(tmpdir(), "archant-web-"));
		await mkdir(join(webDist, "assets"));
		await writeFile(join(webDist, "index.html"), page);
		await writeFile(join(webDist, "assets", "index-abc.js"), script);
		await writeFile(join(webDist, "assets", "index-big.js"), bigScript);
	});

	afterAll(async () => {
		await rm(webDist, { recursive: true, force: true });
	});

	const serving = () =>
		withSession(
			buildTestApp(temp.db, createLogger("silent"), undefined, { webDist }),
			template.cookie,
		);

	it.each(["/", "/accounts", "/accounts/abc/transactions"])(
		"answers %s with index.html, revalidated on every visit",
		async (path) => {
			const response = await serving().request(path);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			expect(response.headers.get("cache-control")).toBe("no-cache");
			await expect(response.text()).resolves.toBe(page);
		},
	);

	it.each(["/", "/accounts", "/api/health"])(
		"sends security headers on %s, so no other site can frame it and no injected text runs script",
		async (path) => {
			const response = await serving().request(path);

			expect(response.headers.get("x-frame-options")).toBe("DENY");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("content-security-policy")).toBe(
				"default-src 'self'; script-src 'self' 'sha256-rAeCpAn2Kteerk13PeCDOI8kvlaCDjXxkwzZgMe0DQU='; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://enablebanking.com https://api.enablebanking.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'",
			);
		},
	);

	it("serves a hashed asset as immutable for a year", async () => {
		const response = await serving().request("/assets/index-abc.js");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("javascript");
		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		await expect(response.text()).resolves.toBe(script);
	});

	it("gzips a hashed asset for a browser that accepts it, and only then", async () => {
		const gzipped = await serving().request("/assets/index-big.js", {
			headers: { "accept-encoding": "gzip, deflate, br" },
		});
		const plain = await serving().request("/assets/index-big.js");

		expect(gzipped.headers.get("content-encoding")).toBe("gzip");
		expect(gzipped.headers.get("vary")).toContain("Accept-Encoding");
		expect(gzipped.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		await expect(gunzipped(gzipped)).resolves.toBe(bigScript);
		expect(plain.headers.get("content-encoding")).toBeNull();
		await expect(plain.text()).resolves.toBe(bigScript);
	});

	it("leaves a file under 1 KB as it is", async () => {
		const response = await serving().request("/assets/index-abc.js", {
			headers: { "accept-encoding": "gzip" },
		});

		expect(response.headers.get("content-encoding")).toBeNull();
		await expect(response.text()).resolves.toBe(script);
	});

	it("answers a missing asset with 404, not the page", async () => {
		const response = await serving().request("/assets/index-gone.js");

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBeNull();
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});

	it("answers an unknown API route with the NOT_FOUND JSON, never the page", async () => {
		const response = await serving().request("/api/nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json())).toEqual({
			error: { code: "NOT_FOUND", message: "No route matches GET /api/nope" },
		});
	});

	it("still answers UNAUTHORIZED on an unknown API route without a session", async () => {
		const response = await buildTestApp(temp.db, createLogger("silent"), undefined, {
			webDist,
		}).request("/api/nope");

		expect(response.status).toBe(401);
		expect(errorBody.parse(await response.json()).error.code).toBe("UNAUTHORIZED");
	});

	it("answers the discovery documents as JSON, ahead of the page", async () => {
		const response = await serving().request("/.well-known/oauth-protected-resource/api/mcp");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
	});

	it.each(["/.well-known/openid-configuration", "/.well-known/oauth-protected-resource"])(
		"answers %s with the NOT_FOUND JSON, never the page a client would take for metadata",
		async (path) => {
			const response = await serving().request(path);

			expect(response.status).toBe(404);
			expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
		},
	);

	it("keeps API routes ahead of the page", async () => {
		const response = await serving().request("/api/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
	});
});

/** A JSON transaction whose label pads the body to exactly `size` bytes. */
function jsonOfSize(size: number): string {
	const empty = JSON.stringify({ ...expense, label: "" });

	return JSON.stringify({ ...expense, label: "A".repeat(size - empty.length) });
}

/**
 * A body sent in `chunks` pieces of `chunkSize` bytes with no declared
 * length, as `Transfer-Encoding: chunked` arrives, counting what was read.
 */
function chunkedBody(chunkSize: number, chunks: number) {
	const read = { bytes: 0 };
	let sent = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent === chunks) {
				controller.close();
				return;
			}

			sent += 1;
			read.bytes += chunkSize;
			controller.enqueue(new Uint8Array(chunkSize).fill(0x20));
		},
	});

	return { stream, read };
}

async function entriesOf(accountId: string) {
	const [row] = await temp.db.all<{ count: number }>(
		sql`select count(*) as count from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	return row?.count;
}

/** A JSON post from the interface's origin; `duplex` lets the body be a stream. */
const postBody = (
	app: ReturnType<typeof buildTestApp>,
	path: string,
	body: NonNullable<RequestInit["body"]>,
	headers: Record<string, string> = {},
) =>
	app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json", origin: "http://localhost:5173", ...headers },
		body,
		duplex: "half",
	});

// The I/O matrix of Story 13.2: no request makes the server read, or parse,
// more than it must.
describe("the body limit", () => {
	it.each([
		["signed out", () => buildTestApp(temp.db)],
		["signed in", () => buildApp()],
	])(
		"refuses a JSON body over 64 KB %s with PAYLOAD_TOO_LARGE and writes nothing",
		async (_name, app) => {
			const account = await openAccount();

			const response = await postBody(
				app(),
				`/api/accounts/${account.id}/transactions`,
				jsonOfSize(64 * 1024 + 1),
			);

			expect(response.status).toBe(413);
			expect(errorBody.parse(await response.json())).toEqual({
				error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is larger than 64 KB." },
			});
			await expect(entriesOf(account.id)).resolves.toBe(0);
		},
	);

	it("reads a body of exactly 64 KB", async () => {
		const account = await openAccount();

		const response = await postBody(
			buildApp(),
			`/api/accounts/${account.id}/transactions`,
			jsonOfSize(64 * 1024),
		);

		// Read and validated: the label is far too long, but no longer too large.
		expect(response.status).toBe(400);
		expect(errorBody.parse(await response.json()).error.code).toBe("VALIDATION_ERROR");
	});

	it("leaves /api/mcp out of the 64 KB: its token is checked first, its 1.5 MB after", async () => {
		const response = await postBody(buildTestApp(temp.db), "/api/mcp", jsonOfSize(64 * 1024 + 1));

		expect(response.status).toBe(401);
	});

	it("leaves the body of /api/mcp unread until the token is checked", async () => {
		const { stream, read } = chunkedBody(1024, 1024);

		const response = await postBody(buildTestApp(temp.db), "/api/mcp", stream);

		expect(response.status).toBe(401);
		// An anonymous caller makes the server hold no more than the 64 KB of any route.
		expect(read.bytes).toBeLessThan(64 * 1024);
	});

	it.each([
		"/api/auth/sign-in/email",
		"/api/setup",
		"/api/auth/oauth2/token",
		// Only the upload itself takes a file's size.
		"/api/transactions/t1/attachments/a1",
	])("refuses a body over 64 KB on %s", async (path) => {
		const response = await postBody(buildTestApp(temp.db), path, jsonOfSize(64 * 1024 + 1));

		expect(response.status).toBe(413);
		expect(errorBody.parse(await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
	});

	it("refuses a declared length over 64 KB without reading the body", async () => {
		const { stream, read } = chunkedBody(1024, 100);

		const response = await postBody(buildApp(), "/api/transactions/bulk-update", stream, {
			"content-length": String(100 * 1024),
		});

		expect(response.status).toBe(413);
		// A stream pulls one chunk ahead of any reader.
		expect(read.bytes).toBeLessThanOrEqual(1024);
	});

	it("stops reading a chunked body at 64 KB", async () => {
		const { stream, read } = chunkedBody(1024, 10 * 1024);

		const response = await postBody(buildTestApp(temp.db), "/api/setup", stream);

		expect(response.status).toBe(413);
		expect(errorBody.parse(await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(read.bytes).toBeLessThan(80 * 1024);
	});

	it("leaves the upload its own limit: a 1 MB statement is read", async () => {
		const account = await openAccount();

		const preview = await uploaded(account.id, paddedOfx(1024 * 1024));

		expect(preview.groups.created).toHaveLength(1);
	});

	it("answers a statement with 40-character tag names within a second", async () => {
		const account = await openAccount();
		const tag = "A".repeat(40);
		const bytes = new TextEncoder().encode(
			`<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260910<TRNAMT>-12.00<FITID>P1<NAME>Librairie</STMTTRN>\n<${tag}>x\n<${tag}.${tag}>y\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`,
		);
		const started = performance.now();

		const { status } = await upload(account.id, bytes);

		expect(performance.now() - started).toBeLessThan(1000);
		expect([201, 400]).toContain(status);
	});

	it.each([
		["5 MB of one whitespace run", MAX_IMPORT_BYTES, " "],
		["5 MB of repeated unclosed comments", MAX_IMPORT_BYTES, "<!--"],
		// See ofx.spec.ts: 1 MB of tags already fails in seconds if quadratic.
		["1 MB of unfinished tags", 1024 * 1024, "<A", "", "</OFX>"],
		["1 MB of one attribute name", 1024 * 1024, "B", "<A ", "</OFX>"],
	])(
		"refuses a statement of %s within a second",
		async (_name, size, unit, lead = "", tail = "") => {
			const account = await openAccount();
			const start = `OFXHEADER:100\n<OFX>${lead}`;
			const room = size - start.length - tail.length;
			const bytes = new TextEncoder().encode(
				start + unit.repeat(Math.floor(room / unit.length)) + tail,
			);
			const started = performance.now();

			const { status, body } = await upload(account.id, bytes);

			expect(performance.now() - started).toBeLessThan(1000);
			expect(status).toBe(400);
			expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		},
	);
});

describe("an assistant's requests through the middleware", () => {
	it.each(["/api/auth/oauth2/token", "/api/auth/oauth2/revoke"])(
		"lets a form post with no origin reach %s, which checks the client itself",
		async (path) => {
			const response = await buildTestApp(temp.db).request(path, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					token: "x",
					refresh_token: "x",
					client_id: "unknown",
				}).toString(),
			});

			// Better Auth's own refusal, in OAuth's shape, never `csrf()`'s FORBIDDEN.
			expect(response.status).not.toBe(403);
			expect(await response.json()).toHaveProperty("error");
		},
	);

	it("still refuses a form post with no origin anywhere else under /api/auth", async () => {
		const response = await buildTestApp(temp.db).request("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "email=admin",
		});

		expect(response.status).toBe(403);
	});

	it("lets /api/mcp past the session guard to its own token check", async () => {
		const response = await buildTestApp(temp.db).request("/api/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
	});
});
