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
