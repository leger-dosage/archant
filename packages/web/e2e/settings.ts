import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Not a dev port (8787 or 5173): the suite runs beside `pnpm api start:dev`
// and `pnpm web start:dev` without touching their database. One port, as in
// the container: the API serves the built interface itself.
export const PORT = 8788;

/**
 * The run's SQLite file, which the server migrates itself. A fixed path, so a
 * run killed before its cleanup leaves a file the next run finds and clears.
 * The port already allows one run per machine at a time.
 */
export const DATABASE_FILE = join(tmpdir(), `archant-e2e-${PORT}`, "e2e.db");

/** The origin the browser uses, and so `BETTER_AUTH_URL` for the suite's API. */
export const WEB_URL = `http://localhost:${PORT}`;

// The browser and the API agree on which day is today, whatever the zone of
// the machine running the suite.
export const TIME_ZONE = "Europe/Paris";

/** The administrator the setup project creates through `/setup`. */
export const ADMIN = { email: "admin@archant.test", password: "mot de passe du test" } as const;

/**
 * The signed-in browser state the setup project saves and every other test
 * starts from. Gitignored: it holds a live session cookie.
 */
export const ADMIN_STATE = fileURLToPath(new URL("./.auth/admin.json", import.meta.url));
