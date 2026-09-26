import { defineConfig, devices } from "@playwright/test";

import { ADMIN_STATE, TIME_ZONE, WEB_URL } from "./e2e/settings.ts";

const CI = Boolean(process.env["CI"]);

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
	projects: [
		// The only moment the database has no user: it creates the administrator
		// through `/setup` and saves the session. Signing in per test instead
		// would hit Better Auth's limit of three sign-ins per ten seconds.
		{ name: "setup", testMatch: /auth\.setup\.ts$/u, use: { ...devices["Desktop Chrome"] } },
		{
			name: "chromium",
			// Everything but the password change, which the project below runs
			// once nothing needs a session any more.
			testIgnore: /password\.spec\.ts$/u,
			use: { ...devices["Desktop Chrome"], storageState: ADMIN_STATE },
			dependencies: ["setup"],
		},
		// Last, because changing the password revokes every session of the single
		// user, the saved administrator session included: run in the middle, it
		// would sign every later test out. It is also the one project a retry
		// cannot repeat: a second attempt would sign in with a password the
		// first attempt has already replaced. Never give this suite `retries`.
		{
			name: "password",
			testMatch: /password\.spec\.ts$/u,
			use: { ...devices["Desktop Chrome"], storageState: ADMIN_STATE },
			dependencies: ["chromium"],
		},
	],
	// No `reuseExistingServer`: a stale server left on this port once made a
	// failure look like a hanging request. A taken port stops the run instead.
	webServer: {
		// The bundle that ships, not the dev server's modules, served by the API
		// on one port as in the container: a reloaded deep link and an unknown
		// `/api` route then reach the server exactly as a browser sends them.
		command: "pnpm exec vite build --logLevel warn && node e2e/start-api.ts",
		url: `${WEB_URL}/api/health`,
		// Lets the script delete its temporary database before it exits.
		gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
		stdout: "pipe",
		timeout: 120_000,
	},
});
