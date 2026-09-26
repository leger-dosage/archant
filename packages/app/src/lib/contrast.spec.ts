import { describe, expect, it } from "vitest";

import { adjustToContrast, contrastRatio, hexToOklch, oklchToHex } from "./contrast.ts";

const HOVER_LIGHT = "#f4f4f4";
const HOVER_DARK = "#2b2d30";

describe("contrastRatio", () => {
	it("measures known pairs", () => {
		expect(contrastRatio("#ffffff", "#5e6ad2")).toBeCloseTo(4.7, 2);
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
		expect(contrastRatio("#777777", "#777777")).toBe(1);
	});

	it("does not depend on the order of the pair", () => {
		expect(contrastRatio("#282a30", "#f8f8f8")).toBe(contrastRatio("#f8f8f8", "#282a30"));
	});

	it("refuses anything but #rrggbb", () => {
		expect(() => contrastRatio("red", "#ffffff")).toThrow();
	});
});

describe("OKLCH round trip", () => {
	it.each(["#5e6ad2", "#fc7840", "#000000", "#ffffff", "#f0bf00"])("keeps %s", (hex) => {
		expect(oklchToHex(hexToOklch(hex))).toBe(hex);
	});

	it("reads white as full lightness without chroma", () => {
		const white = hexToOklch("#ffffff");

		expect(white.l).toBeCloseTo(1, 4);
		expect(white.c).toBeCloseTo(0, 4);
	});

	it("reduces chroma rather than clipping a channel", () => {
		const outside = { ...hexToOklch("#0000ff"), l: 0.9 };
		const shown = hexToOklch(oklchToHex(outside));

		expect(shown.l).toBeCloseTo(0.9, 2);
		expect(shown.c).toBeLessThan(outside.c);
	});
});

describe("adjustToContrast", () => {
	it("darkens a pale colour on the light hover row, same hue", () => {
		const adjusted = adjustToContrast("#f0bf00", HOVER_LIGHT, 4.6);

		expect(contrastRatio(adjusted, HOVER_LIGHT)).toBeGreaterThanOrEqual(4.6);
		expect(hexToOklch(adjusted).l).toBeLessThan(hexToOklch("#f0bf00").l);
		expect(hexToOklch(adjusted).h).toBeCloseTo(hexToOklch("#f0bf00").h, 0);
	});

	it("takes the least change: a hair less and the ratio is missed", () => {
		const adjusted = adjustToContrast("#f0bf00", HOVER_LIGHT, 4.6);
		const lighter = oklchToHex({ ...hexToOklch(adjusted), l: hexToOklch(adjusted).l + 0.01 });

		expect(contrastRatio(lighter, HOVER_LIGHT)).toBeLessThan(4.6);
	});

	it("lightens a dark colour on the dark hover row", () => {
		const adjusted = adjustToContrast("#5e6ad2", HOVER_DARK, 6.5);

		expect(contrastRatio(adjusted, HOVER_DARK)).toBeGreaterThanOrEqual(6.5);
		expect(hexToOklch(adjusted).l).toBeGreaterThan(hexToOklch("#5e6ad2").l);
	});

	it("returns a colour that is already enough unchanged", () => {
		expect(adjustToContrast("#282a30", HOVER_LIGHT, 4.6)).toBe("#282a30");
		expect(adjustToContrast("#282A30", HOVER_LIGHT, 4.6)).toBe("#282a30");
	});

	it("reduces chroma when sRGB cannot hold the lighter colour, and still meets the ratio", () => {
		const adjusted = adjustToContrast("#0000ff", HOVER_DARK, 6.5);

		expect(contrastRatio(adjusted, HOVER_DARK)).toBeGreaterThanOrEqual(6.5);
		expect(hexToOklch(adjusted).c).toBeLessThan(hexToOklch("#0000ff").c);
		expect(hexToOklch(adjusted).h).toBeCloseTo(hexToOklch("#0000ff").h, 0);
	});
});
