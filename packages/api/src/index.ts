import { serve } from "@hono/node-server";

import { createDb } from "@archant/data/client";

import { createApp } from "./app.ts";
import { validateEnv } from "./env.ts";
import { createLogger } from "./lib/logger.ts";

// Vite proxies `/api` here in development; see packages/web/vite.config.ts.
const PORT = 8787;

const env = validateEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
const app = createApp({ db, timeZone: env.APP_TIMEZONE, logger });

serve({ fetch: app.fetch, port: PORT }, (info) => {
	logger.info({ port: info.port }, "Archant API listening");
});
