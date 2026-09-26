import type { Oklch, Rgb } from "culori/fn";

import {
	converter,
	formatHex,
	modeLrgb,
	modeOklab,
	modeOklch,
	modeRgb,
	parse,
	toGamut,
	useMode as registerMode,
	wcagContrast,
} from "culori/fn";

// The tree-shakable entry registers no colour space; these are the ones the
// conversions, the gamut mapping and the contrast below go through.
registerMode(modeRgb);
registerMode(modeLrgb);
registerMode(modeOklab);
registerMode(modeOklch);

/** The `card` token of each mode, which a pill sits on (DESIGN.md). */
export const CARD_COLORS = { light: "#FFFFFF", dark: "#171717" } as const;

const TINT = 0.1;
const MINIMUM_CONTRAST = 4.5;
const STEP = 0.005;

const toRgb = converter("rgb");
const toOklch = converter("oklch");
// No "roughly in gamut" shortcut, so the mapping only reduces chroma: CSS's
// default lets it clip, which turned an orange's hue by six degrees.
const intoSrgb = toGamut("rgb", "oklch", null);

function rgbOf(hex: string): Rgb {
	const color = toRgb(parse(hex));
	if (color === undefined) {
		throw new Error(`Not a colour: ${hex}`);
	}

	return color;
}

/**
 * DESIGN.md's 10 % tint as CSS draws it. One source with `pillTint`, so the
 * contrast search always measures the fill the browser paints.
 */
export function tintFill(color: string): string {
	return `color-mix(in oklab, ${color} ${TINT * 100}%, transparent)`;
}

/**
 * The pill's fill as the eye sees it: the category colour at 10 % composited
 * over the card in sRGB, which is how the browser blends a translucent fill.
 */
export function pillTint(color: string, card: string): string {
	const top = rgbOf(color);
	const bottom = rgbOf(card);

	return formatHex({
		mode: "rgb",
		r: top.r * TINT + bottom.r * (1 - TINT),
		g: top.g * TINT + bottom.g * (1 - TINT),
		b: top.b * TINT + bottom.b * (1 - TINT),
	});
}

/**
 * The pill's text colour: the category colour itself when it reads at 4.5:1
 * on its tint, otherwise the same hue moved in OKLCH lightness until it does,
 * toward black on a light card and toward white on a dark one. DESIGN.md says
 * "darkened", but no darker text passes on the dark card. The household can
 * pick any colour, hence a computation rather than a table.
 */
export function pillTextColor(color: string, card: string): string {
	const tint = pillTint(color, card);
	if (wcagContrast(color, tint) >= MINIMUM_CONTRAST) {
		return color;
	}

	const start: Oklch | undefined = toOklch(parse(color));
	if (start === undefined) {
		throw new Error(`Not a colour: ${color}`);
	}

	const direction = wcagContrast(card, "#000000") > wcagContrast(card, "#FFFFFF") ? -1 : 1;
	let candidate = color;

	for (let l = start.l + direction * STEP; l >= 0 && l <= 1; l += direction * STEP) {
		candidate = formatHex(intoSrgb({ ...start, l }));
		if (wcagContrast(candidate, tint) >= MINIMUM_CONTRAST) {
			return candidate;
		}
	}

	// Black or white always passes against a 10 % tint; kept for the type checker.
	return direction === -1 ? "#000000" : "#ffffff";
}
