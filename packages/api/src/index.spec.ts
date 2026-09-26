import type { ChildProcess } from "node:child_process";

import { http, passthrough } from "msw";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { server } from "../vitest.setup.ts";

const entrypoint = fileURLToPath(new URL("./index.ts", import.meta.url));

/** A port nobody listens on: `PORT` refuses 0, so the kernel is asked for one. */
async function freePort(): Promise<number> {
	const probe = createServer();
	probe.listen(0, "127.0.0.1");
	await once(probe, "listening");
	const address = probe.address();
	probe.close();
	await once(probe, "close");

	if (address === null || typeof address === "string") {
		throw new Error("No TCP port was assigned.");
	}

	return address.port;
}

/** Resolves once the server logs that it listens, with every line it logged. */
async function listening(child: ChildProcess): Promise<string[]> {
	const lines: string[] = [];

	return new Promise((resolve, reject) => {
		let buffered = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			buffered += chunk.toString();
			const parts = buffered.split("\n");
			buffered = parts.pop() ?? "";
			lines.push(...parts);

			if (parts.some((line) => line.includes("Archant API listening"))) {
				resolve(lines);
			}
		});
		child.once("exit", (code) => {
			reject(new Error(`The server exited with ${code} before listening: ${lines.join("\n")}`));
		});
	});
}

/** Every line the process logged, once it has exited, with its exit code. */
async function outcome(child: ChildProcess): Promise<{ code: number | null; lines: string[] }> {
	let output = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	// `close`, not `exit`: only then is stdout drained, fatal line included.
	const code = await new Promise<number | null>((resolve) => {
		child.once("close", resolve);
	});

	return { code, lines: output.split("\n").filter((line) => line !== "") };
}

const SYNC_SECRET = "archant-index-sync-secret-of-32-characters";

let directory: string;
let port: number;
let child: ChildProcess;
let logLines: string[];

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "archant-index-"));
	port = await freePort();
	child = spawn(process.execPath, [entrypoint], {
		stdio: ["ignore", "pipe", "inherit"],
		// Nothing inherited: a `.env` exported in the shell must not point this
		// server at a real database.
		env: {
			DATABASE_URL: `file:${join(directory, "fresh.db")}`,
			PORT: String(port),
			LOG_LEVEL: "info",
			BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
			BETTER_AUTH_URL: `http://localhost:${port}`,
			SYNC_SECRET,
		},
	});
	logLines = await listening(child);
}, 30_000);

afterAll(async () => {
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await once(child, "exit");
	}

	await rm(directory, { recursive: true, force: true });
});

describe("the server entrypoint", () => {
	it("applies migrations to a fresh file before it listens", async () => {
		// The one request of this file that must reach a real socket.
		server.use(http.get(`http://127.0.0.1:${port}/*`, () => passthrough()));

		const response = await fetch(`http://127.0.0.1:${port}/api/health`);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
		const migrated = logLines.findIndex((line) => line.includes("migrations applied"));
		const listened = logLines.findIndex((line) => line.includes("Archant API listening"));
		expect(migrated).toBeGreaterThanOrEqual(0);
		expect(migrated).toBeLessThan(listened);
	});

	it("hands SYNC_SECRET to the scheduled sync route", async () => {
		server.use(http.post(`http://127.0.0.1:${port}/*`, () => passthrough()));
		const sync = (headers: Record<string, string>) =>
			fetch(`http://127.0.0.1:${port}/api/sync`, { method: "POST", headers });

		const refused = await sync({});
		// Past the secret, the bank variables this server lacks answer.
		const accepted = await sync({ authorization: `Bearer ${SYNC_SECRET}` });

		expect(refused.status).toBe(401);
		expect(accepted.status).toBe(503);
		await expect(accepted.json()).resolves.toMatchObject({
			error: { code: "BANK_CONNECTOR_UNAVAILABLE" },
		});
	});

	it("exits within one second of SIGTERM", async () => {
		const started = performance.now();
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
			(resolve) => {
				child.once("exit", (code, signal) => resolve({ code, signal }));
			},
		);

		child.kill("SIGTERM");
		const { code, signal } = await exited;

		expect(performance.now() - started).toBeLessThan(1000);
		expect({ code, signal }).toEqual({ code: null, signal: "SIGTERM" });
	});
});

const fatalLine = z.object({ level: z.number(), port: z.number(), msg: z.string() });

describe("the server entrypoint, on a port another server holds", () => {
	it.each(["127.0.0.1", "::1"])(
		"stops before migrating when %s answers on PORT",
		async (host) => {
			const holder = createServer((socket) => socket.destroy());
			holder.listen(0, host);
			await once(holder, "listening");
			const address = holder.address();

			if (address === null || typeof address === "string") {
				throw new Error("No TCP port was assigned.");
			}

			let conflicting: ChildProcess | undefined;

			try {
				conflicting = spawn(process.execPath, [entrypoint], {
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						DATABASE_URL: `file:${join(directory, "conflict.db")}`,
						PORT: String(address.port),
						LOG_LEVEL: "info",
						BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
						BETTER_AUTH_URL: `http://localhost:${address.port}`,
					},
				});
				let stderr = "";
				conflicting.stderr?.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				const { code, lines } = await outcome(conflicting);

				expect(code).toBe(1);
				expect(lines).toHaveLength(1);
				const line = fatalLine.parse(JSON.parse(lines[0] ?? "{}"));
				expect(line).toMatchObject({ level: 60, port: address.port });
				expect(line.msg).toContain(String(address.port));
				expect(line.msg).toContain("PORT");
				expect(lines.join("\n")).not.toContain("migrations applied");
				expect(stderr).toBe("");
			} finally {
				// A regression starts the server beside the holder: do not leave it running.
				conflicting?.kill("SIGKILL");
				holder.close();
				await once(holder, "close");
			}
		},
		30_000,
	);
});
