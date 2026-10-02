import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError } from "./errors.ts";
import { validated } from "./validated.ts";

const app = new Hono()
	.post("/", validated("json", z.object({ name: z.string().min(1) })), (c) =>
		c.json({ data: c.req.valid("json") }, 200),
	)
	.onError((error, c) =>
		error instanceof AppError ? c.json(error.toJSON(), error.status) : c.text("unexpected", 500),
	);

function post(body: unknown): Response | Promise<Response> {
	return app.request("/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("validated", () => {
	it("refuses an invalid body with a VALIDATION_ERROR naming the field", async () => {
		const response = await post({ name: "" });

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "The request is invalid.",
				fields: [{ path: "name", code: "too_small" }],
			},
		});
	});

	it("hands a valid body to the handler", async () => {
		const response = await post({ name: "Courses" });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { name: "Courses" } });
	});
});
