import { fileURLToPath } from "node:url";

// Not the dev ports (8787 and 5173): the suite runs beside `pnpm api
// start:dev` and `pnpm web start:dev` without touching their database.
export const API_PORT = 8788;
export const WEB_PORT = 4174;

/** The origin the browser uses, and so `BETTER_AUTH_URL` for the suite's API. */
export const WEB_URL = `http://localhost:${WEB_PORT}`;

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
