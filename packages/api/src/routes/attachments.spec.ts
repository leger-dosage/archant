import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MAX_ATTACHMENTS_PER_TRANSACTION, MAX_ATTACHMENT_BYTES } from "@archant/data/attachments";

import { MAX_ATTACHMENT_BODY_BYTES } from "../schemas/attachments.ts";
import {
	buildApp,
	errorBody,
	expense,
	logLines,
	openAccount,
	postTransaction,
	request,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");

const attachmentItem = z.strictObject({
	id: z.string(),
	transactionId: z.string(),
	filename: z.string(),
	contentType: z.string(),
	byteSize: z.number(),
	createdAt: z.number(),
});

const createdBody = z.object({ data: attachmentItem });

const listBody = z.object({ data: z.array(attachmentItem) });

/** A transaction of its own on a new account. */
async function transaction() {
	const account = await openAccount();
	const { body } = await postTransaction(account.id, expense);

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

/** `bytes` grown to `size` with zeros, so its first bytes still say its type. */
function padded(bytes: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
	const grown = new Uint8Array(size);
	grown.set(bytes);

	return grown;
}

async function upload(id: string, bytes: Uint8Array, name = "ticket.png", type = "image/png") {
	const form = new FormData();
	form.append("file", new File([bytes], name, { type }));
	const response = await buildApp().request(`/api/transactions/${id}/attachments`, {
		method: "POST",
		body: form,
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

async function uploaded(id: string, bytes = PNG, name = "ticket.png") {
	const { status, body } = await upload(id, bytes, name);

	expect(status, JSON.stringify(body)).toBe(201);

	return createdBody.parse(body).data;
}

async function listOf(id: string) {
	const { status, body } = await request("GET", `/api/transactions/${id}/attachments`);

	expect(status).toBe(200);

	return listBody.parse(body).data;
}

const refused = (code: string) => ({
	error: { code: "VALIDATION_ERROR", fields: [{ path: "file", code }] },
});

describe("POST /api/transactions/:id/attachments", () => {
	it("stores the type read from the bytes, not the one declared, and lists the file with its size", async () => {
		const id = await transaction();

		const { status, body } = await upload(id, PNG, "ticket.png", "text/plain");

		expect(status).toBe(201);
		const item = createdBody.parse(body).data;
		expect(item).toMatchObject({
			transactionId: id,
			filename: "ticket.png",
			contentType: "image/png",
			byteSize: PNG.byteLength,
		});
		await expect(listOf(id)).resolves.toEqual([item]);
	});

	it("is typed for the interface's client, and lists oldest first", async () => {
		const id = await transaction();
		const first = await uploaded(id, PNG, "a.png");
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		const second = await uploaded(id, PDF, "b.pdf");

		const response = await testClient(buildApp()).api.transactions[":id"].attachments.$get({
			param: { id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.map((item) => item.id)).toEqual([first.id, second.id]);
	});

	it("cleans the name", async () => {
		const id = await transaction();

		await expect(uploaded(id, PDF, "../a<b>.pdf")).resolves.toMatchObject({
			filename: "..-a-b-.pdf",
			contentType: "application/pdf",
		});
	});

	it("refuses an eleventh file with attachment_limit", async () => {
		const id = await transaction();
		await Array.from({ length: MAX_ATTACHMENTS_PER_TRANSACTION }).reduce<Promise<unknown>>(
			async (previous) => {
				await previous;
				await uploaded(id);
			},
			Promise.resolve(),
		);

		const { status, body } = await upload(id, PNG);

		expect(status).toBe(400);
		expect(body).toMatchObject(refused("attachment_limit"));
		await expect(listOf(id)).resolves.toHaveLength(MAX_ATTACHMENTS_PER_TRANSACTION);
	});

	it.each([
		["a 12 MB body, refused before it is read", 12 * 1024 * 1024],
		["a file one byte over 10 MiB", MAX_ATTACHMENT_BYTES + 1],
	])("refuses %s with attachment_too_large", async (_name, size) => {
		const id = await transaction();

		const { status, body } = await upload(id, padded(PNG, size));

		expect(status).toBe(400);
		expect(body).toMatchObject(refused("attachment_too_large"));
		await expect(listOf(id)).resolves.toEqual([]);
	});

	it("refuses a declared length over the limit without reading the body", async () => {
		const id = await transaction();
		const read = { bytes: 0 };
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent === 100) {
					controller.close();
					return;
				}

				sent += 1;
				read.bytes += 1024;
				controller.enqueue(new Uint8Array(1024).fill(0x20));
			},
		});

		const response = await buildApp().request(`/api/transactions/${id}/attachments`, {
			method: "POST",
			headers: {
				"content-type": "multipart/form-data; boundary=x",
				"content-length": String(MAX_ATTACHMENT_BODY_BYTES + 1),
			},
			body: stream,
			duplex: "half",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject(refused("attachment_too_large"));
		// A stream pulls one chunk ahead of any reader.
		expect(read.bytes).toBeLessThanOrEqual(1024);
	});

	it("takes a file of exactly 10 MiB", async () => {
		const id = await transaction();

		await expect(uploaded(id, padded(PNG, MAX_ATTACHMENT_BYTES))).resolves.toMatchObject({
			byteSize: MAX_ATTACHMENT_BYTES,
		});
	});

	it.each([
		["an HTML page named .pdf", new TextEncoder().encode("<html><script>alert(1)</script>")],
		["an empty file", new Uint8Array()],
	])("refuses %s with attachment_type", async (_name, bytes) => {
		const id = await transaction();

		const { status, body } = await upload(id, bytes, "facture.pdf", "application/pdf");

		expect(status).toBe(400);
		expect(body).toMatchObject(refused("attachment_type"));
		await expect(listOf(id)).resolves.toEqual([]);
	});

	it("refuses a body without a file on `file`", async () => {
		const id = await transaction();
		const form = new FormData();
		form.append("other", "x");

		const response = await buildApp().request(`/api/transactions/${id}/attachments`, {
			method: "POST",
			body: form,
		});

		expect(response.status).toBe(400);
		expect(errorBody.parse(await response.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "file" }],
		});
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status, body } = await upload("nope", PNG);

		expect(status).toBe(404);
		expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
		await expect(request("GET", "/api/transactions/nope/attachments")).resolves.toMatchObject({
			status: 404,
		});
	});

	it("keeps the file's name out of the logs, refused or stored", async () => {
		const id = await transaction();
		const app = buildApp();
		const send = async (bytes: Uint8Array) => {
			const form = new FormData();
			form.append("file", new File([bytes], "Ordonnance Dr Martin.pdf"));

			return app.request(`/api/transactions/${id}/attachments`, { method: "POST", body: form });
		};

		await send(PDF);
		await send(new Uint8Array([1, 2, 3]));
		await send(padded(PDF, 12 * 1024 * 1024));

		expect(logLines.join("\n")).not.toMatch(/Ordonnance|Martin/u);
	});
});

describe("GET /api/transactions/:id/attachments/:attachmentId", () => {
	it("serves the bytes inline with their type, nosniff, no cache and a sandboxed policy", async () => {
		const id = await transaction();
		const { id: attachmentId } = await uploaded(id, PDF, "Reçu café.pdf");

		const response = await buildApp().request(
			`/api/transactions/${id}/attachments/${attachmentId}`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/pdf");
		expect(response.headers.get("content-disposition")).toBe(
			"inline; filename=\"Re_u caf_.pdf\"; filename*=UTF-8''Re%C3%A7u%20caf%C3%A9.pdf",
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("content-security-policy")).toBe(
			"default-src 'self'; script-src 'self' 'sha256-rAeCpAn2Kteerk13PeCDOI8kvlaCDjXxkwzZgMe0DQU='; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://enablebanking.com https://api.enablebanking.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; sandbox",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
	});

	it("leaves the policy of every other route unsandboxed", async () => {
		const id = await transaction();
		const app = buildApp();
		const health = await app.request("/api/health");

		const policies = await Promise.all(
			[`/api/transactions/${id}/attachments`, `/api/transactions/${id}`, "/api/transactions"].map(
				async (path) => (await app.request(path)).headers.get("content-security-policy"),
			),
		);

		expect(health.headers.get("content-security-policy")).not.toContain("sandbox");
		expect(policies).toEqual(
			Array.from({ length: 3 }, () => health.headers.get("content-security-policy")),
		);
	});

	it("answers NOT_FOUND for an unknown attachment, or one of another transaction", async () => {
		const id = await transaction();
		const other = await transaction();
		const { id: attachmentId } = await uploaded(other);

		const responses = await Promise.all(
			[
				`/api/transactions/${id}/attachments/nope`,
				`/api/transactions/${id}/attachments/${attachmentId}`,
			].map(async (path) => buildApp().request(path)),
		);

		expect(responses.map((response) => response.status)).toEqual([404, 404]);
		await expect(
			Promise.all(
				responses.map(async (response) => errorBody.parse(await response.json()).error.code),
			),
		).resolves.toEqual(["NOT_FOUND", "NOT_FOUND"]);
	});
});

describe("DELETE /api/transactions/:id/attachments/:attachmentId", () => {
	it("deletes the file, which then answers NOT_FOUND", async () => {
		const id = await transaction();
		const { id: attachmentId } = await uploaded(id);

		await expect(
			request("DELETE", `/api/transactions/${id}/attachments/${attachmentId}`),
		).resolves.toEqual({ status: 200, body: { data: { id: attachmentId } } });

		await expect(listOf(id)).resolves.toEqual([]);
		await expect(
			request("DELETE", `/api/transactions/${id}/attachments/${attachmentId}`),
		).resolves.toMatchObject({ status: 404 });
	});

	it("goes with its transaction", async () => {
		const id = await transaction();
		const { id: attachmentId } = await uploaded(id);

		await expect(request("DELETE", `/api/transactions/${id}`)).resolves.toMatchObject({
			status: 200,
		});

		const response = await buildApp().request(
			`/api/transactions/${id}/attachments/${attachmentId}`,
		);
		expect(response.status).toBe(404);
	});
});
