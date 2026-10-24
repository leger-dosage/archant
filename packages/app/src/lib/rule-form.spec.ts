import { describe, expect, it } from "vitest";

import { amountStep, presetValues } from "./rule-form.ts";

describe("amountStep", () => {
	it("steps by the currency's minor unit, as Sure's number_step", () => {
		expect(amountStep("EUR")).toBe("0.01");
		expect(amountStep("JPY")).toBe("1");
		expect(amountStep("KWD")).toBe("0.001");
	});
});

describe("presetValues", () => {
	it("names the rule after the label, matches it and sets the category, as Sure's `rules#new`", () => {
		expect(presetValues("CB CARREFOUR", "c1")).toEqual({
			name: "CB CARREFOUR",
			effectiveDate: null,
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "CB CARREFOUR" }],
			actions: [{ actionType: "set_transaction_category", value: "c1", replacement: null }],
		});
	});

	it("cuts a long label to the name's limit, the condition keeping it whole", () => {
		const label = "x".repeat(150);

		const values = presetValues(label, "c1");

		expect(values.name).toHaveLength(100);
		expect(values.conditions[0]?.value).toBe(label);
	});
});
