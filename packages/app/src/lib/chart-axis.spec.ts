import { describe, expect, it } from "vitest";

import { axisTicks } from "./chart-axis";

describe("axisTicks", () => {
	it("spreads round ticks over the series", () => {
		// DESIGN.md's mock: 274 269,28 € to 277 681,48 €, labelled 274 k€ to 278 k€.
		expect(axisTicks([27_426_928, 27_768_148])).toEqual([
			27_400_000, 27_500_000, 27_600_000, 27_700_000, 27_800_000,
		]);
	});

	it("widens a flat series until its compact labels differ", () => {
		expect(axisTicks([493_390, 493_390])).toEqual([
			470_000, 480_000, 490_000, 500_000, 510_000, 520_000,
		]);
		expect(axisTicks([12_345, 12_345])).toEqual([12_100, 12_200, 12_300, 12_400, 12_500, 12_600]);
	});

	it("never crosses zero on its own", () => {
		expect(axisTicks([0, 5_000]).at(0)).toBe(0);
		expect(axisTicks([-5_000, 0]).at(-1)).toBe(0);
	});

	it("crosses zero when the series does", () => {
		const ticks = axisTicks([-100_000, 300_000]);

		expect(ticks.at(0)).toBeLessThan(-100_000);
		expect(ticks).toContain(0);
		expect(ticks.at(-1)).toBeGreaterThan(300_000);
	});
});
