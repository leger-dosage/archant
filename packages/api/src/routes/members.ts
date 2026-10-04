import type { MemberDeps } from "../services/members.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { memberRoleSchema } from "../schemas/members.ts";
import { listMembers, removeMember, setMemberRole } from "../services/members.ts";
import { requireRole, signedInUser } from "./middleware/roles.ts";

/**
 * « Réglages › Membres »: who has access, a role changed, a member removed
 * (AD-21). The list checks the administrator's role itself, since
 * `viewerReadOnly` lets a viewer's `GET` through; it refuses the writes.
 */
export function membersRoutes(deps: MemberDeps) {
	return new Hono<SessionEnv>()
		.get("/", requireRole("admin"), async (c) => c.json({ data: await listMembers(deps) }, 200))
		.patch("/:id", validated("json", memberRoleSchema), async (c) =>
			c.json(
				{
					data: await setMemberRole(
						deps,
						signedInUser(c).id,
						c.req.param("id"),
						c.req.valid("json").role,
					),
				},
				200,
			),
		)
		.delete("/:id", async (c) => {
			await removeMember(deps, signedInUser(c).id, c.req.param("id"));

			return c.json({ data: null }, 200);
		});
}
