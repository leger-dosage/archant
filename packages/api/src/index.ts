import { serve } from "@hono/node-server";

import { createDb } from "@archant/data/client";

import { createApp } from "./app.ts";
import { validateEnv } from "./env.ts";
import { createLogger } from "./lib/logger.ts";
import { purgeStalePreviews } from "./services/imports.ts";

const env = validateEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
// An unconfirmed preview keeps the uploaded file; a day is long enough to
// come back to it, and short enough that bank statements do not pile up.
const purged = await purgeStalePreviews({ db, timeZone: env.APP_TIMEZONE });
logger.info({ purged }, "stale import previews purged");
const app = createApp({ db, timeZone: env.APP_TIMEZONE, logger });

// Vite proxies `/api` here in development; see packages/web/vite.config.ts.
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	logger.info({ port: info.port }, "Archant API listening");
});
