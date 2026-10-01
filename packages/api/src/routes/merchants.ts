import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";

import { validated } from "../lib/validated.ts";
import { merchantSchema, mergeMerchantSchema } from "../schemas/merchants.ts";
import {
	createMerchant,
	deleteMerchant,
	listMerchants,
	mergeMerchant,
	renameMerchant,
} from "../services/merchants.ts";

export function merchantsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) => c.json({ data: await listMerchants(deps) }, 200))
		.post("/", validated("json", merchantSchema), async (c) =>
			c.json({ data: await createMerchant(deps, c.req.valid("json")) }, 201),
		)
		.patch("/:id", validated("json", merchantSchema), async (c) =>
			c.json({ data: await renameMerchant(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteMerchant(deps, c.req.param("id")) }, 200),
		)
		.post("/:id/merge", validated("json", mergeMerchantSchema), async (c) =>
			c.json(
				{ data: await mergeMerchant(deps, c.req.param("id"), c.req.valid("json").targetId) },
				200,
			),
		);
}
