import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { originalBalance } from "./original-balance.ts";

describe("originalBalance", () => {
	it("takes the recorded amount borrowed above zero", () => {
		expect(originalBalance(toMinorUnits(13_000_000), 10_510_482n)).toBe(13_000_000n);
	});

	it("falls back to the opening balance when none is recorded, as Sure's first valuation", () => {
		expect(originalBalance(null, 18_000_000n)).toBe(18_000_000n);
	});

	it("counts a recorded zero or negative amount as unrecorded", () => {
		expect(originalBalance(toMinorUnits(0), 18_000_000n)).toBe(18_000_000n);
		expect(originalBalance(toMinorUnits(-100), 18_000_000n)).toBe(18_000_000n);
	});
});
