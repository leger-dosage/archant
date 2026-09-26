import { converter, parse, wcagContrast } from "culori/fn";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "@archant/api/services/default-categories";
import { CATEGORY_COLORS } from "@archant/data/category-presets";

import { CARD_COLORS, pillTextColor, pillTint } from "./pill-text-color.ts";

const toOklch = converter("oklch");

const COLORS = [
	...CATEGORY_COLORS,
	...DEFAULT_CATEGORIES.map((category) => category.color),
	"#FFFF00",
	"#FFFFFF",
	"#000000",
];

const MODES = ["light", "dark"] as const;

/** The smallest difference between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
	const distance = Math.abs(a - b) % 360;

	return Math.min(distance, 360 - distance);
}

describe("pillTextColor", () => {
	for (const mode of MODES) {
		for (const color of COLORS) {
			it(`reads at 4.5:1 or more on the tint of ${color} in ${mode} mode`, () => {
				const card = CARD_COLORS[mode];

				expect(
					wcagContrast(pillTextColor(color, card), pillTint(color, card)),
				).toBeGreaterThanOrEqual(4.5);
			});
		}
	}

	it("returns a colour that already passes unchanged", () => {
		// Black on its own near-white tint, and white on its tint over the dark card.
		expect(pillTextColor("#000000", CARD_COLORS.light)).toBe("#000000");
		expect(pillTextColor("#FFFFFF", CARD_COLORS.dark)).toBe("#FFFFFF");
		expect(pillTextColor("#FFFF00", CARD_COLORS.dark)).toBe("#FFFF00");
	});

	it("darkens on the light card and lightens on the dark one", () => {
		const light = toOklch(parse(pillTextColor("#e99537", CARD_COLORS.light)));
		const dark = toOklch(parse(pillTextColor("#6471eb", CARD_COLORS.dark)));

		expect(light?.l).toBeLessThan(toOklch(parse("#e99537"))?.l ?? 0);
		expect(dark?.l).toBeGreaterThan(toOklch(parse("#6471eb"))?.l ?? 0);
	});

	it("keeps the hue", () => {
		for (const mode of MODES) {
			for (const color of COLORS) {
				const before = toOklch(parse(color));
				const after = toOklch(parse(pillTextColor(color, CARD_COLORS[mode])));

				// Greys have no hue to keep, and a hex rounds a faint chroma's hue.
				if (before?.h === undefined || (before.c ?? 0) < 0.05 || (after?.c ?? 0) < 0.02) {
					continue;
				}

				expect(hueDistance(before.h, after?.h ?? 0), `${color} in ${mode}`).toBeLessThan(5);
			}
		}
	});
});
