import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toFieldErrors, validationError } from "./zod-error.ts";

const schema = z.object({
	name: z.string().trim().min(1),
	nested: z.object({ amount: z.string().refine((value) => value === "1", "invalid_amount") }),
});

describe("toFieldErrors", () => {
	it("keeps a built-in code and reads a custom one from its message", () => {
		const result = schema.safeParse({ name: " ", nested: { amount: "2" } });

		expect(result.success).toBe(false);
		expect(toFieldErrors(result.error!)).toEqual([
			{ path: "name", code: "too_small" },
			{ path: "nested.amount", code: "invalid_amount" },
		]);
	});

	it("names each key a strict object does not take in its own path", () => {
		const strict = z.strictObject({ nested: z.strictObject({ kept: z.string() }) });
		const result = strict.safeParse({ extra: 1, nested: { kept: "a", one: 1, two: 2 } });

		expect(toFieldErrors(result.error!)).toEqual([
			{ path: "nested.one", code: "unrecognized_keys" },
			{ path: "nested.two", code: "unrecognized_keys" },
			{ path: "extra", code: "unrecognized_keys" },
		]);
	});
});

describe("validationError", () => {
	it("wraps the fields in a 400 VALIDATION_ERROR", () => {
		const result = schema.safeParse({});
		const error = validationError(result.error!);

		expect(error.status).toBe(400);
		expect(error.toJSON().error.code).toBe("VALIDATION_ERROR");
		expect(error.toJSON().error.fields).toHaveLength(2);
	});
});
