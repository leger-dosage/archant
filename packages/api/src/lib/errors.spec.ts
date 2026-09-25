import { describe, expect, it } from "vitest";

import { AppError } from "./errors.ts";

describe("AppError", () => {
	it("takes its status from its code", () => {
		expect(new AppError("NOT_FOUND", "x").status).toBe(404);
		expect(new AppError("VALIDATION_ERROR", "x").status).toBe(400);
		expect(new AppError("INTERNAL_ERROR", "x").status).toBe(500);
		expect(new AppError("UNAUTHORIZED", "x").status).toBe(401);
		expect(new AppError("FORBIDDEN", "x").status).toBe(403);
		expect(new AppError("INVALID_IMPORT_FILE", "x").status).toBe(400);
		expect(new AppError("IMPORT_PREVIEW_STALE", "x").status).toBe(409);
		expect(new AppError("IMPORT_NOT_REVERTABLE", "x").status).toBe(409);
		expect(new AppError("SERVICE_UNAVAILABLE", "x").status).toBe(503);
		expect(new AppError("BANK_CONNECTOR_UNAVAILABLE", "x").status).toBe(503);
		expect(new AppError("BANK_PROVIDER_ERROR", "x").status).toBe(502);
		expect(new AppError("BANK_REDIRECT_NOT_ALLOWED", "x").status).toBe(502);
		expect(new AppError("BANK_BALANCE_UNAVAILABLE", "x").status).toBe(502);
		expect(new AppError("BANK_AUTHORIZATION_INVALID", "x").status).toBe(400);
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

	it("serialises params only when it has some", () => {
		expect(
			new AppError("INVALID_IMPORT_FILE", "Refused.", undefined, { type: "Invst" }).toJSON(),
		).toEqual({
			error: { code: "INVALID_IMPORT_FILE", message: "Refused.", params: { type: "Invst" } },
		});
	});
});
