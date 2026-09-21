import { describe, expect, it } from "vitest";

import { ApiError, unwrap } from "./api.ts";

// `unwrap` only reads `ok` and `json`, so plain objects stand in for a
// response and no request is ever sent.
const failed = (body: () => Promise<unknown>) => Promise.resolve({ ok: false, json: body });

describe("unwrap", () => {
	it("returns the body of a successful response", async () => {
		await expect(
			unwrap(Promise.resolve({ ok: true, json: () => Promise.resolve({ data: 1 }) })),
		).resolves.toEqual({ data: 1 });
	});

	it("keeps the code and the field errors of a validation failure", async () => {
		const fields = [{ path: "name", code: "too_small" }];
		const result = unwrap(
			failed(() =>
				Promise.resolve({ error: { code: "VALIDATION_ERROR", message: "Invalid", fields } }),
			),
		);

		await expect(result).rejects.toBeInstanceOf(ApiError);
		await expect(result).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields });
	});

	it("reports a code the interface cannot translate as INTERNAL_ERROR", async () => {
		const result = unwrap(
			failed(() => Promise.resolve({ error: { code: "TEAPOT", message: "Short" } })),
		);

		await expect(result).rejects.toBeInstanceOf(ApiError);
		await expect(result).rejects.toMatchObject({ code: "INTERNAL_ERROR", fields: [] });
	});

	it("reports a body that is not the envelope, such as the proxy's page, as NETWORK_ERROR", async () => {
		const result = unwrap(failed(() => Promise.reject(new SyntaxError("Unexpected token '<'"))));

		await expect(result).rejects.toBeInstanceOf(ApiError);
		await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
	});

	it("reports a request that never got a response as NETWORK_ERROR", async () => {
		const result = unwrap(Promise.reject(new TypeError("Failed to fetch")));

		await expect(result).rejects.toBeInstanceOf(ApiError);
		await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
	});
});
