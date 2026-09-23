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
});
