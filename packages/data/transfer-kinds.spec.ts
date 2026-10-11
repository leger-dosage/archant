import { describe, expect, it } from "vitest";

import { toMinorUnits } from "./money.ts";
import { categorySetOnOutflow } from "./transfer-kinds.ts";

describe("categorySetOnOutflow", () => {
	it("holds for the inflow of a spent kind alone", () => {
		expect(categorySetOnOutflow(toMinorUnits(50000), null)).toBe(false);
		expect(categorySetOnOutflow(toMinorUnits(50000), { kind: "loan_payment" })).toBe(true);
		expect(categorySetOnOutflow(toMinorUnits(50000), { kind: "investment_contribution" })).toBe(
			true,
		);
		expect(categorySetOnOutflow(toMinorUnits(-50000), { kind: "loan_payment" })).toBe(false);
		expect(categorySetOnOutflow(toMinorUnits(50000), { kind: "internal_move" })).toBe(false);
	});
});
