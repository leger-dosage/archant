import type { InvitationDeps } from "../services/invitations.ts";
import type { AttemptsDeps } from "./middleware/attempts.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { forwardedHeaders } from "../lib/client-address.ts";
import { AppError } from "../lib/errors.ts";
import { validated } from "../lib/validated.ts";
import {
	acceptInvitationSchema,
	createInvitationSchema,
	previewInvitationSchema,
} from "../schemas/invitations.ts";
import {
	acceptInvitation,
	createInvitation,
	listInvitations,
	previewInvitation,
	revokeInvitation,
} from "../services/invitations.ts";
import { limitAttempts } from "./middleware/attempts.ts";
import { requireRole } from "./middleware/roles.ts";

export type InvitationsRouteDeps = InvitationDeps & AttemptsDeps;

/**
 * « Réglages › Membres »' invitations, and the two public routes the link's
 * page calls. Every other route checks the administrator's role itself, for
 * two reasons: `viewerReadOnly` lets a viewer's `GET` through, and another
 * method on `/preview` or `/accept`, a public path, such as `DELETE`, reaches
 * `/:id` without a session.
 */
export function invitationsRoutes(deps: InvitationsRouteDeps) {
	const limited = limitAttempts(deps, "Too many invitation attempts. Try again in a few seconds.");

	return new Hono<SessionEnv>()
		.get("/", requireRole("admin"), async (c) => c.json({ data: await listInvitations(deps) }, 200))
		.post("/", requireRole("admin"), validated("json", createInvitationSchema), async (c) => {
			const inviter = c.get("user");

			// `requireRole` let only a signed-in administrator through.
			if (inviter === undefined) {
				throw new AppError("FORBIDDEN", "Your role does not allow this.");
			}

			return c.json({ data: await createInvitation(deps, inviter.id, c.req.valid("json")) }, 201);
		})
		.delete("/:id", requireRole("admin"), async (c) => {
			await revokeInvitation(deps, c.req.param("id"));

			return c.json({ data: null }, 200);
		})
		.post("/preview", validated("json", previewInvitationSchema), async (c) =>
			c.json({ data: await previewInvitation(deps, c.req.valid("json").token) }, 200),
		)
		.post("/accept", limited, validated("json", acceptInvitationSchema), async (c) => {
			// The rebuilt address, so the new session records the client's.
			const headers = forwardedHeaders(
				c.req.raw.headers,
				deps.clientAddress(c),
				deps.trustedProxies.length > 0,
			);
			const { cookies } = await acceptInvitation(deps, c.req.valid("json"), headers);

			for (const cookie of cookies) {
				c.header("set-cookie", cookie, { append: true });
			}

			return c.json({ data: { signedIn: cookies.length > 0 } }, 201);
		});
}
