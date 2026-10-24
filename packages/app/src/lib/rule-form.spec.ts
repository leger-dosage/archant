import { describe, expect, it } from "vitest";

import { amountStep } from "./rule-form.ts";

describe("amountStep", () => {
	it("steps by the currency's minor unit, as Sure's number_step", () => {
		expect(amountStep("EUR")).toBe("0.01");
		expect(amountStep("JPY")).toBe("1");
		expect(amountStep("KWD")).toBe("0.001");
	});
});
