import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";

import { createDb } from "@archant/data/client";
import { runMigrations } from "@archant/data/migrate";

import { createApp } from "./app.ts";
import { validateEnv } from "./env.ts";
import { createLogger } from "./lib/logger.ts";
import { loopbackListener } from "./lib/port.ts";
import { createAuth } from "./services/auth.ts";
import { bankDepsFromEnv } from "./services/bank-connections.ts";
import { purgeStalePreviews } from "./services/imports.ts";
import { seedDefaults } from "./services/seed.ts";

const env = validateEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);

/** Ends the process with one line a first-time user can act on, and no stack trace. */
function portTaken(port: number): never {
	logger.fatal(
		{ port },
		`Port ${port} is already in use by another server. Stop it, or set PORT in .env to a free port.`,
	);
	process.exit(1);
}

// A server already on the loopback would receive Vite's proxied requests while
// this one listens beside it (see `loopbackListener`). Checked before
// migrating, so a conflict touches no database.
if ((await loopbackListener(env.PORT)) !== null) {
	portTaken(env.PORT);
}

// Before anything reads a table: an upgrade is a new image and a restart, with
// no separate command to forget. `drizzle-kit` is not needed for this.
await runMigrations(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
logger.info("migrations applied");
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
// Once per instance, not once per start: a default the user deleted stays deleted.
const seeded = await seedDefaults({ db });
if (seeded > 0) {
	logger.info({ seeded }, "default categories seeded");
}
// An unconfirmed preview keeps the uploaded file; a day is long enough to
// come back to it, and short enough that bank statements do not pile up.
const purged = await purgeStalePreviews({ db, timeZone: env.APP_TIMEZONE });
logger.info({ purged }, "stale import previews purged");
const auth = createAuth({
	db,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedProxies: env.TRUSTED_PROXIES,
	logger,
});
const app = createApp({
	db,
	timeZone: env.APP_TIMEZONE,
	logger,
	auth,
	trustedOrigin: env.BETTER_AUTH_URL,
	trustedProxies: env.TRUSTED_PROXIES,
	clientAddress: (c) => getConnInfo(c).remote.address,
	webDist: env.WEB_DIST,
	syncSecret: env.SYNC_SECRET,
	...bankDepsFromEnv(env),
});

// Vite proxies `/api` here in development; see packages/web/vite.config.ts.
// With `WEB_DIST` set, as in the container, this port also serves the
// interface. No SIGTERM handler: Node dies on the signal at once, and SQLite
// in WAL mode keeps every committed transaction, while waiting for keep-alive
// sockets to close could outlast `docker compose stop`.
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	logger.info({ port: info.port }, "Archant API listening");
});
// Where the bind itself fails, as on Linux, this also catches a server that
// took the port since the check above; on macOS SO_REUSEADDR binds beside it.
server.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code === "EADDRINUSE") {
		portTaken(env.PORT);
	}

	logger.fatal({ port: env.PORT, code: error.code }, "The API server failed");
	process.exit(1);
});
