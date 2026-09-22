import { describe, expect, it } from "vitest";

import { AppError } from "./errors.ts";

describe("AppError", () => {
	it("takes its status from its code", () => {
		expect(new AppError("NOT_FOUND", "x").status).toBe(404);
		expect(new AppError("VALIDATION_ERROR", "x").status).toBe(400);
		expect(new AppError("INTERNAL_ERROR", "x").status).toBe(500);
		expect(new AppError("INVALID_IMPORT_FILE", "x").status).toBe(400);
		expect(new AppError("IMPORT_PREVIEW_STALE", "x").status).toBe(409);
	});

	it("serialises fields only when it has some", () => {
		expect(new AppError("NOT_FOUND", "Gone.").toJSON()).toEqual({
			error: { code: "NOT_FOUND", message: "Gone." },
		});
		expect(
			new AppError("VALIDATION_ERROR", "Bad.", [{ path: "name", code: "too_small" }]).toJSON(),
		).toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "Bad.",
				fields: [{ path: "name", code: "too_small" }],
			},
		});
	});
});
