import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { disconnectAssistant, listAssistants } from "../services/assistants.ts";
import { assistantsAvailable, mcpResource } from "../services/auth.ts";
import { requireRole, signedInUser } from "./middleware/roles.ts";

export type AssistantsDeps = ServiceDeps & {
	/** `BETTER_AUTH_URL`: the address assistants are given derives from it. */
	trustedOrigin: string;
};

/**
 * « Réglages › Assistants IA »: the address to give, and the assistants the
 * signed-in administrator connected; another administrator's stay theirs.
 * An administrator's only, since only one connects an assistant.
 */
export function assistantsRoutes(deps: AssistantsDeps) {
	return new Hono<SessionEnv>()
		.get("/", requireRole("admin"), async (c) =>
			c.json(
				{
					data: {
						// Off on plain HTTP outside loopback; the page then says HTTPS is required.
						available: assistantsAvailable(deps.trustedOrigin),
						address: mcpResource(deps.trustedOrigin),
						assistants: await listAssistants(deps, signedInUser(c).id),
					},
				},
				200,
			),
		)
		.delete("/:clientId", async (c) => {
			await disconnectAssistant(deps, signedInUser(c).id, c.req.param("clientId"));

			return c.json({ data: null }, 200);
		});
}
