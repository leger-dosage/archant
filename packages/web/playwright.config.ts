import { defineConfig, devices } from "@playwright/test";

import { API_PORT, TIME_ZONE, WEB_PORT } from "./e2e/settings.ts";

const CI = Boolean(process.env["CI"]);
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
	testDir: "./e2e",
	// A forgotten `test.only` would otherwise turn the pipeline green having run
	// a single test.
	forbidOnly: CI,
	// One SQLite writer, and group totals shared by every test stay predictable
	// when asserted as a change around an action.
	workers: 1,
	fullyParallel: false,
	reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: WEB_URL,
		locale: "fr-FR",
		timezoneId: TIME_ZONE,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// No `reuseExistingServer`: a stale server left on these ports once made a
	// failure look like a hanging request. A taken port stops the run instead.
	webServer: [
		{
			command: "node e2e/start-api.ts",
			port: API_PORT,
			// Lets the script delete its temporary database before it exits.
			gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
			stdout: "pipe",
		},
		{
			// The bundle that ships, not the dev server's modules.
			command: `pnpm exec vite build --logLevel warn && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
			url: WEB_URL,
			// Read by vite.config.ts as the proxy target for `/api`.
			env: { PORT: String(API_PORT) },
			timeout: 120_000,
		},
	],
});
