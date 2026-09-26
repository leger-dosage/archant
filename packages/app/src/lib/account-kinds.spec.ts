import { describe, expect, it } from "vitest";

import { kindOf } from "./account-kinds.ts";

describe("kindOf", () => {
	it("tells a loan's `other` from an investment's", () => {
		expect(kindOf("investment", "other")).toBe("other_investment");
		expect(kindOf("loan", "other")).toBe("other_loan");
	});

	it("names an investment by its subtype", () => {
		expect(kindOf("investment", "pea")).toBe("pea");
	});

	it("names a property by its subtype, and a vehicle by its type", () => {
		expect(kindOf("property", "single_family_home")).toBe("single_family_home");
		expect(kindOf("vehicle", null)).toBe("vehicle");
	});
});
