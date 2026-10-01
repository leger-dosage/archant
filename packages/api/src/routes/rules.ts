import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { ruleBodySchema, ruleEnabledSchema } from "../schemas/rules.ts";
import { pageQuerySchema } from "../schemas/transactions.ts";
import {
	applyRules,
	createRule,
	deleteRule,
	listRuleRuns,
	listRules,
	previewRules,
	setRuleEnabled,
	updateRule,
} from "../services/rules.ts";

export function rulesRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", async (c) => c.json({ data: await listRules(deps) }, 200))
			// Static paths before `/:id`, so « preview », « apply » and « runs » are never read as ids.
			.get("/preview", async (c) => c.json({ data: await previewRules(deps) }, 200))
			.post("/apply", async (c) => c.json({ data: await applyRules(deps) }, 200))
			.get("/runs", validated("query", pageQuerySchema), async (c) =>
				c.json({ data: await listRuleRuns(deps, c.req.valid("query")) }, 200),
			)
			.get("/:id/preview", async (c) =>
				c.json({ data: await previewRules(deps, c.req.param("id")) }, 200),
			)
			.post("/:id/apply", async (c) =>
				c.json({ data: await applyRules(deps, c.req.param("id")) }, 200),
			)
			.post("/", validated("json", ruleBodySchema), async (c) =>
				c.json({ data: await createRule(deps, c.req.valid("json")) }, 201),
			)
			.put("/:id", validated("json", ruleBodySchema), async (c) =>
				c.json({ data: await updateRule(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.patch("/:id", validated("json", ruleEnabledSchema), async (c) =>
				c.json({ data: await setRuleEnabled(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.delete("/:id", async (c) => c.json({ data: await deleteRule(deps, c.req.param("id")) }, 200))
	);
}
