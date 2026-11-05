import { describe, expect, it } from "vitest";

import { axisLabelsFit, showsAlternateTick } from "@/lib/money-flow";

describe("axisLabelsFit", () => {
	it("keeps the full labels when the widest leaves 8 px in its band, then the short month, then every other tick", () => {
		expect(axisLabelsFit([50, 62], [20, 24], 70)).toBe("full");
		expect(axisLabelsFit([50, 63], [20, 24], 70)).toBe("short");
		expect(axisLabelsFit([50, 63], [20, 24], 30)).toBe("alternate");
	});
});

describe("showsAlternateTick", () => {
	it("keeps the ticks of the picked month's parity, even ones without a picked month", () => {
		expect([0, 1, 2, 3, 4, 5].filter((index) => showsAlternateTick(index, 5))).toEqual([1, 3, 5]);
		expect([0, 1, 2, 3].filter((index) => showsAlternateTick(index, -1))).toEqual([0, 2]);
	});
});
