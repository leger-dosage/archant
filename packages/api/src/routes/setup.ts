import type { SetupDeps } from "../services/setup.ts";
import type { AttemptsDeps } from "./middleware/attempts.ts";

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { validated } from "../lib/validated.ts";
import { setupSchema } from "../schemas/setup.ts";
import { assertSetupOpen, completeSetup, getSetupStatus } from "../services/setup.ts";
import { limitAttempts } from "./middleware/attempts.ts";

export type SetupRouteDeps = SetupDeps & AttemptsDeps;

export function setupRoutes(deps: SetupRouteDeps) {
	// Before the body is read: a closed setup tells a stranger nothing about
	// what it would have accepted.
	const open = createMiddleware(async (_c, next) => {
		await assertSetupOpen(deps);
		await next();
	});

	const limited = limitAttempts(deps, "Too many setup attempts. Try again in a few seconds.");

	return new Hono()
		.get("/", async (c) => c.json({ data: await getSetupStatus(deps) }, 200))
		.post("/", open, limited, validated("json", setupSchema), async (c) => {
			const data = await completeSetup(deps, c.req.valid("json"));

			return c.json({ data }, 201);
		});
}
