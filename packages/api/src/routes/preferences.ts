import type { ServiceDeps } from "../services/deps.ts";
import type { SessionEnv } from "./middleware/auth.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { householdPreferencesSchema } from "../schemas/household-preferences.ts";
import { preferencesSchema, rulePromptDismissalSchema } from "../schemas/preferences.ts";
import { getPreferencesPage, updatePreferences } from "../services/preferences.ts";
import { dismissRulePrompts } from "../services/rule-prompt.ts";
import { getHouseholdPreferences, saveHouseholdPreferences } from "../services/settings.ts";
import { assertRole, requireRole, signedInUser } from "./middleware/roles.ts";

/** « Réglages › Préférences ». Only an administrator changes the household language. */
export function preferencesRoutes(deps: ServiceDeps) {
	return (
		new Hono<SessionEnv>()
			.get("/", async (c) =>
				c.json({ data: await getPreferencesPage(deps, signedInUser(c).id) }, 200),
			)
			.patch("/", validated("json", preferencesSchema), async (c) => {
				const input = c.req.valid("json");

				if (input.householdLocale !== undefined) {
					assertRole(c, "admin");
				}

				return c.json({ data: await updatePreferences(deps, signedInUser(c).id, input) }, 200);
			})
			.get("/household", async (c) => c.json({ data: await getHouseholdPreferences(deps) }, 200))
			.patch(
				"/household",
				requireRole("admin"),
				validated("json", householdPreferencesSchema),
				async (c) => {
					await saveHouseholdPreferences(deps.db, c.req.valid("json"));
					return c.json({ data: await getHouseholdPreferences(deps) }, 200);
				},
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
