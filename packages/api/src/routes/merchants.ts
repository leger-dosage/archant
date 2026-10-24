import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { merchantSchema, mergeMerchantsSchema } from "../schemas/merchants.ts";
import {
	createMerchant,
	deleteMerchant,
	listMerchants,
	mergeMerchants,
	updateMerchant,
} from "../services/merchants.ts";

export function merchantsRoutes(deps: ServiceDeps) {
	return (
		new Hono()
			.get("/", async (c) => c.json({ data: await listMerchants(deps) }, 200))
			.post("/", validated("json", merchantSchema), async (c) =>
				c.json({ data: await createMerchant(deps, c.req.valid("json")) }, 201),
			)
			// Sure's `perform_merge`, before `/:id` so « merge » is never read as an id.
			.post("/merge", validated("json", mergeMerchantsSchema), async (c) => {
				const { targetId, sourceIds } = c.req.valid("json");

				return c.json({ data: await mergeMerchants(deps, targetId, sourceIds) }, 200);
			})
			.patch("/:id", validated("json", merchantSchema), async (c) =>
				c.json({ data: await updateMerchant(deps, c.req.param("id"), c.req.valid("json")) }, 200),
			)
			.delete("/:id", async (c) =>
				c.json({ data: await deleteMerchant(deps, c.req.param("id")) }, 200),
			)
	);
}
