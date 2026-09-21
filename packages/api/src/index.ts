import { serve } from "@hono/node-server";

import { createDb } from "@archant/data/client";

import { createApp } from "./app.ts";
import { validateEnv } from "./env.ts";
import { createLogger } from "./lib/logger.ts";

const env = validateEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
const app = createApp({ db, timeZone: env.APP_TIMEZONE, logger });

// Vite proxies `/api` here in development; see packages/web/vite.config.ts.
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	logger.info({ port: info.port }, "Archant API listening");
});
