import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { preferencesSchema, rulePromptDismissalSchema } from "../schemas/preferences.ts";
import { getPreferences, updatePreferences } from "../services/preferences.ts";
import { dismissRulePrompts } from "../services/rule-prompt.ts";
import { signedInUser } from "./middleware/roles.ts";

/**
 * « Réglages › Préférences », the signed-in user's own. A viewer reads their
 * order but cannot change it: `viewerReadOnly` refuses the `PATCH` (AD-21),
 * until Sure's roles let every member save their own.
 */
export function preferencesRoutes(deps: ServiceDeps) {
	return (
		new Hono<SessionEnv>()
			.get("/", async (c) => c.json({ data: await getPreferences(deps, signedInUser(c).id) }, 200))
			.patch("/", validated("json", preferencesSchema), async (c) =>
				c.json(
					{ data: await updatePreferences(deps, signedInUser(c).id, c.req.valid("json")) },
					200,
				),
			)
			// Sure's `PATCH /users/:id/rule_prompt_settings`, from « Masquer pour aujourd'hui ».
			.patch("/rule-prompt", validated("json", rulePromptDismissalSchema), async (c) =>
				c.json(
					{
						data: await dismissRulePrompts(deps, signedInUser(c).id, c.req.valid("json").disabled),
					},
					200,
				),
			)
	);
}
