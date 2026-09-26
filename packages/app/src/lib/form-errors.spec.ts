import { describe, expect, it } from "vitest";

import { applyFieldErrors, fieldErrorCode } from "./form-errors.ts";

type Form = { name: string; openingBalance: string };

describe("applyFieldErrors", () => {
	it("sets each API field error on the matching form field and returns the rest", () => {
		const calls: [string, { type: string; message?: string }][] = [];

		const unplaced = applyFieldErrors<Form>(
			[
				{ path: "name", code: "too_small" },
				{ path: "openingBalance", code: "invalid_amount" },
				{ path: "nested.unknown", code: "invalid_type" },
			],
			["name", "openingBalance"],
			(name, error) => {
				calls.push([
					name,
					{
						type: String(error.type),
						...(error.message === undefined ? {} : { message: error.message }),
					},
				]);
			},
		);

		expect(calls).toEqual([
			["name", { type: "too_small", message: "too_small" }],
			["openingBalance", { type: "invalid_amount", message: "invalid_amount" }],
		]);
		expect(unplaced).toEqual([{ path: "nested.unknown", code: "invalid_type" }]);
	});
});

describe("fieldErrorCode", () => {
	it("reads a built-in Zod issue from its type", () => {
		expect(fieldErrorCode({ type: "too_small", message: "Too small: expected string" })).toBe(
			"too_small",
		);
	});

	it("reads a custom issue from its message, as the API mapper does", () => {
		expect(fieldErrorCode({ type: "custom", message: "invalid_amount" })).toBe("invalid_amount");
	});

	it("reads an error the API placed on the field", () => {
		expect(fieldErrorCode({ type: "invalid_currency", message: "invalid_currency" })).toBe(
			"invalid_currency",
		);
	});

	it("falls back to a generic message for a code it cannot translate", () => {
		expect(fieldErrorCode({ type: "not_a_code" })).toBe("unknown");
		expect(fieldErrorCode({ type: "custom" })).toBe("unknown");
	});
});
