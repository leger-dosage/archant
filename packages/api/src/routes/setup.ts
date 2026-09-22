import type { SetupDeps } from "../services/setup.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
import { setupSchema } from "../schemas/setup.ts";
import { completeSetup, getSetupStatus } from "../services/setup.ts";

export function setupRoutes(deps: SetupDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await getSetupStatus(deps) }, 200))
		.post(
			"/",
			zValidator("json", setupSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => {
				const data = await completeSetup(deps, c.req.valid("json"));

				return c.json({ data }, 201);
			},
		);
}
