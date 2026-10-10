import type { ChildProcess } from "node:child_process";

import { http, passthrough } from "msw";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createDb } from "@archant/data/client";
import { pendingMigrations } from "@archant/data/migrate";
import { migrateAllButLast } from "@archant/data/testing/migrations";

import { server } from "../vitest.setup.ts";
import { accepts } from "./lib/port.ts";

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

const listeningLine = z.object({ host: z.string(), port: z.number(), msg: z.string() });

const bindFatalLine = z.object({
	level: z.number(),
	host: z.string(),
	port: z.number(),
	code: z.string(),
	msg: z.string(),
});

const SYNC_SECRET = "archant-index-sync-secret-of-32-characters";

const logLine = z.object({ level: z.number(), msg: z.string() });

const SETUP_TOKEN_PATTERN = /enter the setup token (\S+)\./u;

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
		expect(logLines.some((line) => line.includes("a new database, so no database copy"))).toBe(
			true,
		);
	});

	it("refreshes the planner's statistics after migrating, before it listens", async () => {
		const migrated = logLines.findIndex((line) => line.includes("migrations applied"));
		const refreshed = logLines.findIndex((line) => line.includes("statistics refreshed"));
		const listened = logLines.findIndex((line) => line.includes("Archant API listening"));

		expect(refreshed).toBeGreaterThan(migrated);
		expect(refreshed).toBeLessThan(listened);
		const db = await createDb(`file:${join(directory, "fresh.db")}`);
		try {
			const table = await db.$client.execute(
				"select name from sqlite_master where name = 'sqlite_stat1'",
			);

			expect(table.rows).toHaveLength(1);
		} finally {
			db.$client.close();
		}
	});

	it("claims the one-time fee cost basis recompute on a fresh database", async () => {
		const db = await createDb(`file:${join(directory, "fresh.db")}`);
		try {
			const claim = await db.$client.execute(
				"select key from settings where key = 'fee_cost_basis_recomputed_at'",
			);

			expect(claim.rows).toHaveLength(1);
		} finally {
			db.$client.close();
		}
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

	it("logs one setup token at warn on an empty database, which setup accepts", async () => {
		server.use(http.post(`http://127.0.0.1:${port}/*`, () => passthrough()));
		const tokenLines = logLines.filter((line) => line.includes("setup token"));

		expect(tokenLines).toHaveLength(1);
		const line = logLine.parse(JSON.parse(tokenLines[0] ?? "{}"));
		expect(line.level).toBe(40);
		const token = SETUP_TOKEN_PATTERN.exec(line.msg)?.[1];
		expect(token).toMatch(/^[\w-]{32}$/u);

		const setup = (body: Record<string, string>) =>
			fetch(`http://127.0.0.1:${port}/api/setup`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "admin@example.test", password: "correct horse", ...body }),
			});

		expect((await setup({ token: "wrong" })).status).toBe(403);
		expect((await setup({ token: token ?? "" })).status).toBe(201);
	});

	it("gives no plain-HTTP warning on a loopback origin", () => {
		expect(logLines.filter((line) => line.includes("travel unencrypted"))).toEqual([]);
	});

	it("listens on 127.0.0.1 only when HOST is unset", async () => {
		const line = logLines.find((entry) => entry.includes("Archant API listening"));

		expect(listeningLine.parse(JSON.parse(line ?? "{}"))).toMatchObject({
			host: "127.0.0.1",
			port,
		});
		await expect(accepts("127.0.0.1", port)).resolves.toBe(true);
		await expect(accepts("::1", port)).resolves.toBe(false);
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

describe("the server entrypoint, once a user exists", () => {
	it("logs no setup token", async () => {
		// The database the first server set up, reopened as a restart would.
		const restarted = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${join(directory, "fresh.db")}`,
				PORT: String(port),
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: `http://localhost:${port}`,
			},
		});

		try {
			const lines = await listening(restarted);

			expect(lines.filter((line) => line.includes("setup token"))).toEqual([]);
			expect(lines.some((line) => line.includes("no pending migration, so no database copy"))).toBe(
				true,
			);
			await expect(readdir(join(directory, "backups"))).rejects.toThrow();
		} finally {
			if (restarted.exitCode === null && restarted.signalCode === null) {
				restarted.kill("SIGKILL");
				await once(restarted, "exit");
			}
		}
	}, 30_000);
});

describe("the server entrypoint, on a public plain-HTTP origin", () => {
	it("warns once that the password travels unencrypted, and still starts", async () => {
		const publicPort = await freePort();
		const exposed = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${join(directory, "public.db")}`,
				PORT: String(publicPort),
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: "http://archant.example.org",
			},
		});

		try {
			const warnings = (await listening(exposed)).filter((line) =>
				line.includes("travel unencrypted"),
			);

			expect(warnings).toHaveLength(1);
			const line = logLine.parse(JSON.parse(warnings[0] ?? "{}"));
			expect(line.level).toBe(40);
			expect(line.msg).toContain("BETTER_AUTH_URL");
			expect(line.msg).toContain("ARCHANT_URL");
			expect(line.msg).toContain("password");
			expect(line.msg).toContain("session cookies");
		} finally {
			if (exposed.exitCode === null && exposed.signalCode === null) {
				exposed.kill("SIGKILL");
				await once(exposed, "exit");
			}
		}
	}, 30_000);
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

describe("the server entrypoint, with HOST set", () => {
	it("listens on ::1 only when HOST is ::1", async () => {
		const hostPort = await freePort();
		const started = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${join(directory, "host.db")}`,
				PORT: String(hostPort),
				HOST: "::1",
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: `http://localhost:${hostPort}`,
			},
		});

		try {
			const line = (await listening(started)).find((entry) =>
				entry.includes("Archant API listening"),
			);

			expect(listeningLine.parse(JSON.parse(line ?? "{}"))).toMatchObject({
				host: "::1",
				port: hostPort,
			});
			await expect(accepts("::1", hostPort)).resolves.toBe(true);
			await expect(accepts("127.0.0.1", hostPort)).resolves.toBe(false);
		} finally {
			if (started.exitCode === null && started.signalCode === null) {
				started.kill("SIGKILL");
				await once(started, "exit");
			}
		}
	}, 30_000);

	it("stops with the host and the code when HOST is not an address of this machine", async () => {
		const hostPort = await freePort();
		// TEST-NET-1 (RFC 5737): documentation only, never assigned to a machine.
		const refused = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${join(directory, "unavailable.db")}`,
				PORT: String(hostPort),
				HOST: "192.0.2.1",
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: `http://localhost:${hostPort}`,
			},
		});

		try {
			const { code, lines } = await outcome(refused);

			expect(code).toBe(1);
			const fatal = lines
				.map((entry) => bindFatalLine.safeParse(JSON.parse(entry)))
				.find((entry) => entry.success && entry.data.level === 60);
			expect(fatal?.data).toMatchObject({
				host: "192.0.2.1",
				port: hostPort,
				code: "EADDRNOTAVAIL",
			});
			expect(lines.join("\n")).not.toContain("Archant API listening");
		} finally {
			if (refused.exitCode === null && refused.signalCode === null) {
				refused.kill("SIGKILL");
				await once(refused, "exit");
			}
		}
	}, 30_000);
});

async function pendingAfter(file: string): Promise<"new" | "none" | number> {
	const db = await createDb(`file:${file}`);
	try {
		return await pendingMigrations(db);
	} finally {
		db.$client.close();
	}
}

describe("the server entrypoint, on a database with a pending migration", () => {
	it("copies the database to backups/ before it migrates", async () => {
		const upgradeDirectory = await mkdtemp(join(tmpdir(), "archant-upgrade-"));
		const file = join(upgradeDirectory, "archant.db");
		await migrateAllButLast(`file:${file}`);
		const upgradePort = await freePort();
		const upgraded = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${file}`,
				PORT: String(upgradePort),
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: `http://localhost:${upgradePort}`,
				APP_VERSION: "1.2.0",
			},
		});

		try {
			const lines = await listening(upgraded);

			const copied = lines.findIndex((line) => line.includes("before migrating"));
			const migrated = lines.findIndex((line) => line.includes("migrations applied"));
			expect(copied).toBeGreaterThanOrEqual(0);
			expect(copied).toBeLessThan(migrated);
			expect(logLine.parse(JSON.parse(lines[copied] ?? "{}")).level).toBe(30);
			const copies = await readdir(join(upgradeDirectory, "backups"));
			expect(copies).toHaveLength(1);
			expect(copies[0]).toMatch(/^archant-\d{8}T\d{6}Z-1\.2\.0\.db$/u);
			await expect(pendingAfter(join(upgradeDirectory, "backups", copies[0] ?? ""))).resolves.toBe(
				1,
			);
		} finally {
			if (upgraded.exitCode === null && upgraded.signalCode === null) {
				upgraded.kill("SIGKILL");
				await once(upgraded, "exit");
			}
			await rm(upgradeDirectory, { recursive: true, force: true });
		}
	}, 30_000);

	it("stops without migrating when the copy fails", async () => {
		const upgradeDirectory = await mkdtemp(join(tmpdir(), "archant-upgrade-"));
		const file = join(upgradeDirectory, "archant.db");
		await migrateAllButLast(`file:${file}`);
		await writeFile(join(upgradeDirectory, "backups"), "");
		const upgradePort = await freePort();
		let refused: ChildProcess | undefined;

		try {
			refused = spawn(process.execPath, [entrypoint], {
				stdio: ["ignore", "pipe", "inherit"],
				env: {
					DATABASE_URL: `file:${file}`,
					PORT: String(upgradePort),
					LOG_LEVEL: "info",
					BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
					BETTER_AUTH_URL: `http://localhost:${upgradePort}`,
				},
			});
			// A regression that migrates and listens would never exit on its own.
			const started = refused;
			started.stdout?.on("data", (chunk: Buffer) => {
				if (chunk.toString().includes("Archant API listening")) {
					started.kill("SIGKILL");
				}
			});

			const { code, lines } = await outcome(refused);

			expect(code).toBe(1);
			const fatal = lines
				.map((line) => backupFatalLine.safeParse(JSON.parse(line)))
				.find((line) => line.success && line.data.level === 60);
			expect(fatal?.data).toMatchObject({ directory: join(upgradeDirectory, "backups") });
			expect(fatal?.data?.code).toMatch(/^E[A-Z]+$/u);
			expect(lines.join("\n")).not.toContain("migrations applied");
			await expect(pendingAfter(file)).resolves.toBe(1);
		} finally {
			if (refused !== undefined && refused.exitCode === null && refused.signalCode === null) {
				refused.kill("SIGKILL");
				await once(refused, "exit");
			}
			await rm(upgradeDirectory, { recursive: true, force: true });
		}
	}, 30_000);

	it("warns and keeps going when older copies cannot be deleted", async () => {
		const upgradeDirectory = await mkdtemp(join(tmpdir(), "archant-upgrade-"));
		const file = join(upgradeDirectory, "archant.db");
		await migrateAllButLast(`file:${file}`);
		// Directories under copy names: deleting them as files fails.
		await Promise.all(
			["01", "02", "03", "04", "05"].map((day) =>
				mkdir(join(upgradeDirectory, "backups", `archant-200001${day}T000000Z-1.0.0.db`), {
					recursive: true,
				}),
			),
		);
		const upgradePort = await freePort();
		const upgraded = spawn(process.execPath, [entrypoint], {
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				DATABASE_URL: `file:${file}`,
				PORT: String(upgradePort),
				LOG_LEVEL: "info",
				BETTER_AUTH_SECRET: "archant-index-secret-of-at-least-32-characters",
				BETTER_AUTH_URL: `http://localhost:${upgradePort}`,
			},
		});

		try {
			const lines = await listening(upgraded);

			expect(lines.some((line) => line.includes("before migrating"))).toBe(true);
			const warning = lines
				.map((line) => pruneWarnLine.safeParse(JSON.parse(line)))
				.find((line) => line.success && line.data.level === 40);
			expect(warning?.data?.code).toEqual(expect.any(String));
			expect(lines.some((line) => line.includes("migrations applied"))).toBe(true);
		} finally {
			if (upgraded.exitCode === null && upgraded.signalCode === null) {
				upgraded.kill("SIGKILL");
				await once(upgraded, "exit");
			}
			await rm(upgradeDirectory, { recursive: true, force: true });
		}
	}, 30_000);
});

const pruneWarnLine = z.object({ level: z.number(), code: z.string(), msg: z.string() });

const backupFatalLine = z.object({
	level: z.number(),
	code: z.string(),
	directory: z.string(),
	msg: z.string(),
});
