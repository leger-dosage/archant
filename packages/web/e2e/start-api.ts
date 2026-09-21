import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "@archant/data/migrate";

import { API_PORT, TIME_ZONE } from "./settings.ts";

// Started by playwright.config.ts. One fresh database per run, in a file
// rather than `:memory:`: every libSQL connection to `:memory:` opens its own
// empty database, and the ledger's transactions borrow their own connection.
const directory = await mkdtemp(join(tmpdir(), "archant-e2e-"));
const databaseUrl = `file:${join(directory, "e2e.db")}`;

await runMigrations(databaseUrl);

const entrypoint = fileURLToPath(new URL("../../api/src/index.ts", import.meta.url));
const api = spawn(process.execPath, [entrypoint], {
	stdio: "inherit",
	env: {
		...process.env,
		DATABASE_URL: databaseUrl,
		// A token exported in the shell for Turso must not reach a local file.
		DATABASE_AUTH_TOKEN: "",
		PORT: String(API_PORT),
		APP_TIMEZONE: TIME_ZONE,
		LOG_LEVEL: "warn",
	},
});

// Set once Playwright asks for a stop, so only that stop counts as clean.
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stopping = true;
		api.kill(signal);
	});
}

api.on("exit", (code) => {
	void rm(directory, { recursive: true, force: true }).finally(() => {
		// Stopped by Playwright is a clean end; the API crashing or being killed
		// on its own is not.
		process.exit(stopping ? 0 : code || 1);
	});
});
