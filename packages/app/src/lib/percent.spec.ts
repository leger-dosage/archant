import { describe, expect, it } from "vitest";

import { formatChangePercent, formatTenthPercent } from "./percent";

// Intl puts a narrow no-break space before the French percent sign.
const plain = (text: string) => text.replace(/[  ]/gu, " ");

describe("formatChangePercent", () => {
	it("signs a change, zero included, as Sure's « +0 % »", () => {
		expect(plain(formatChangePercent(0))).toBe("+0 %");
		expect(plain(formatChangePercent(-0))).toBe("+0 %");
		expect(plain(formatChangePercent(12.5))).toBe("+12,5 %");
		expect(plain(formatChangePercent(-3))).toMatch(/^[-−]3 %$/u);
	});
});

describe("formatTenthPercent", () => {
	it("keeps one decimal at most", () => {
		expect(plain(formatTenthPercent(33.3))).toBe("33,3 %");
		expect(plain(formatTenthPercent(81))).toBe("81 %");
	});
});
