import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { randomBytes } from "node:crypto";

import { BackupError, copyBeforeMigrating, errorCode } from "@archant/data/backup";
import { createDb, refreshStatistics } from "@archant/data/client";
import { runMigrations } from "@archant/data/migrate";

import { createApp } from "./app.ts";
import { validateEnv } from "./env.ts";
import { isInsecurePublicOrigin } from "./lib/insecure-origin.ts";
import { createLogger } from "./lib/logger.ts";
import { loopbackListener } from "./lib/port.ts";
import { createAuth } from "./services/auth.ts";
import { bankDepsFromEnv } from "./services/bank-connections.ts";
import { purgeStalePreviews } from "./services/imports.ts";
import { seedDefaults } from "./services/seed.ts";
import { hasUser } from "./services/setup.ts";

const env = validateEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);

// A warning, not a refusal: a tailnet or a home network may carry plain HTTP
// on a name this check cannot tell is private, and the owner decides.
if (isInsecurePublicOrigin(env.BETTER_AUTH_URL)) {
	logger.warn(
		`BETTER_AUTH_URL (ARCHANT_URL with Docker Compose) is ${new URL(env.BETTER_AUTH_URL).origin}, plain HTTP on a public address: the password and session cookies travel unencrypted. Serve it over HTTPS.`,
	);
}

const SKIPPED_BACKUP = {
	"up-to-date": "no pending migration, so no database copy",
	new: "a new database, so no database copy",
	remote: "a remote database, so no database copy",
} as const;

/** Ends the process with one line a first-time user can act on, and no stack trace. */
function portTaken(port: number): never {
	logger.fatal(
		{ port },
		`Port ${port} is already in use by another server. Stop it, or set PORT in .env to a free port.`,
	);
	process.exit(1);
}

// A server already on either loopback would receive Vite's proxied requests
// while this one listens beside it (see `loopbackListener`). Both are probed
// even when `HOST` is `127.0.0.1`: Vite proxies to `localhost`, which Node tries
// as `::1` first, so a stranger there would still catch its requests. Checked
// before migrating, so a conflict touches no database.
if ((await loopbackListener(env.PORT)) !== null) {
	portTaken(env.PORT);
}

// Migrations only go forward, so a file an upgrade migrated no longer opens in
// the image it came from. Without a copy there is no way back, so a failed
// copy stops the server before it migrates.
try {
	const backup = await copyBeforeMigrating({
		url: env.DATABASE_URL,
		authToken: env.DATABASE_AUTH_TOKEN,
		version: env.APP_VERSION,
		now: new Date(),
	});

	if ("copied" in backup) {
		logger.info(
			{ backup: backup.copied, kept: backup.kept },
			`database copied to backups/${backup.copied} before migrating`,
		);
		if (backup.pruneFailed !== undefined) {
			logger.warn(
				{ code: backup.pruneFailed },
				"older database copies could not be deleted from backups/",
			);
		}
	} else {
		logger.info({ skipped: backup.skipped }, SKIPPED_BACKUP[backup.skipped]);
	}
} catch (error) {
	if (error instanceof BackupError) {
		logger.fatal(
			{ code: error.code, directory: error.directory },
			"The database could not be copied before migrating, so it was not migrated. Free disk space or fix the permissions of the backups directory beside the database, then start again.",
		);
	} else {
		logger.fatal(
			{ code: errorCode(error) },
			"The database could not be read before migrating, so it was not migrated. Check that DATABASE_URL names an Archant database and that no other server holds it, then start again.",
		);
	}
	process.exit(1);
}

// Before anything reads a table: an upgrade is a new image and a restart, with
// no separate command to forget. `drizzle-kit` is not needed for this.
await runMigrations(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
logger.info("migrations applied");
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
// Without statistics SQLite plans blind, and at a decade of history it picked
// the wrong index for every transfer candidate. Best-effort: Turso may refuse
// `ANALYZE`, and a slower plan is no reason not to start.
try {
	await refreshStatistics(db);
	logger.info("statistics refreshed");
} catch (error) {
	logger.warn({ code: errorCode(error) }, "statistics refresh failed");
}
// Once per instance, not once per start: a default the user deleted stays deleted.
const seeded = await seedDefaults({ db });
if (seeded > 0) {
	logger.info({ seeded }, "default categories seeded");
}
// An unconfirmed preview keeps the uploaded file; a day is long enough to
// come back to it, and short enough that bank statements do not pile up.
const purged = await purgeStalePreviews({ db, timeZone: env.APP_TIMEZONE });
logger.info({ purged }, "stale import previews purged");
// Whoever calls `/api/setup` first becomes the administrator, and a new
// instance's address is public within minutes of its certificate. The token
// proves access to the server. This is the one secret a log may carry: it is
// worthless once setup is done, and a restart replaces it. `warn`, so the
// owner sees it at `LOG_LEVEL=warn` too.
const setupToken = (await hasUser({ db })) ? null : randomBytes(24).toString("base64url");
if (setupToken !== null) {
	logger.warn(
		`Setup is open. Open /setup and enter the setup token ${setupToken}. A new one is printed at every start.`,
	);
}
const auth = createAuth({
	db,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedProxies: env.TRUSTED_PROXIES,
	logger,
});
// Its start writes to the database (`mcp()` seeds `/api/mcp` as a resource);
// a failure there stops the server here rather than at the first sign-in.
await auth.$context;
const app = createApp({
	db,
	timeZone: env.APP_TIMEZONE,
	logger,
	auth,
	trustedOrigin: env.BETTER_AUTH_URL,
	authSecret: env.BETTER_AUTH_SECRET,
	trustedProxies: env.TRUSTED_PROXIES,
	clientAddress: (c) => getConnInfo(c).remote.address,
	webDist: env.WEB_DIST,
	syncSecret: env.SYNC_SECRET,
	setupToken,
	version: env.APP_VERSION,
	...bankDepsFromEnv(env),
});

// Vite proxies `/api` here in development; see packages/app/vite.config.ts.
// With `WEB_DIST` set, as in the container, this port also serves the
// interface. No SIGTERM handler: Node dies on the signal at once, and SQLite
// in WAL mode keeps every committed transaction, while waiting for keep-alive
// sockets to close could outlast `docker compose stop`.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
	logger.info({ host: env.HOST, port: info.port }, "Archant API listening");
});
// Where the bind itself fails, as on Linux, this also catches a server that
// took the port since the check above; on macOS SO_REUSEADDR binds beside it.
server.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code === "EADDRINUSE") {
		portTaken(env.PORT);
	}

	logger.fatal({ host: env.HOST, port: env.PORT, code: error.code }, "The API server failed");
	process.exit(1);
});
