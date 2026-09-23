import type { ServiceDeps } from "../services/deps.ts";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { validationError } from "../lib/zod-error.ts";
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
		.post(
			"/",
			zValidator("json", merchantSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) => c.json({ data: await createMerchant(deps, c.req.valid("json")) }, 201),
		)
		.patch(
			"/:id",
			zValidator("json", merchantSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json({ data: await renameMerchant(deps, c.req.param("id"), c.req.valid("json")) }, 200),
		)
		.delete("/:id", async (c) =>
			c.json({ data: await deleteMerchant(deps, c.req.param("id")) }, 200),
		)
		.post(
			"/:id/merge",
			zValidator("json", mergeMerchantSchema, (result) => {
				if (!result.success) {
					throw validationError(result.error);
				}
			}),
			async (c) =>
				c.json(
					{ data: await mergeMerchant(deps, c.req.param("id"), c.req.valid("json").targetId) },
					200,
				),
		);
}
