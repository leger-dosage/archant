/**
 * WCAG contrast and the OKLCH moves that fix it. A household picks any colour
 * for a category, so a pill's text and icon colours are computed rather than
 * listed (DESIGN.md, « Category colours »). Short enough not to need a colour
 * library.
 */

export type Oklch = { l: number; c: number; h: number };

type Rgb = [number, number, number];

const mapRgb = ([r, g, b]: Rgb, map: (channel: number) => number): Rgb => [map(r), map(g), map(b)];

const HEX = /^#[0-9a-f]{6}$/iu;

function parseHex(hex: string): Rgb {
	if (!HEX.test(hex)) {
		throw new Error(`Not a #rrggbb colour: ${hex}`);
	}

	const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;

	return [channel(1), channel(3), channel(5)];
}

function toHex(rgb: Rgb): string {
	return `#${rgb
		.map((channel) =>
			Math.round(Math.min(1, Math.max(0, channel)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

const toLinear = (channel: number) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const fromLinear = (channel: number) =>
	channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

function relativeLuminance(hex: string): number {
	const [r, g, b] = mapRgb(parseHex(hex), toLinear);

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
	const first = relativeLuminance(foreground);
	const second = relativeLuminance(background);

	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// Björn Ottosson's OKLab matrices, from linear sRGB.
function linearToOklch([r, g, b]: Rgb): Oklch {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const hue = (Math.atan2(bAxis, a) * 180) / Math.PI;

	return { l: lightness, c: Math.hypot(a, bAxis), h: hue < 0 ? hue + 360 : hue };
}

function oklchToLinear({ l: lightness, c, h }: Oklch): Rgb {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

export function hexToOklch(hex: string): Oklch {
	return linearToOklch(mapRgb(parseHex(hex), toLinear));
}

const EPSILON = 1e-6;

const inGamut = (color: Oklch) =>
	oklchToLinear(color).every((channel) => channel >= -EPSILON && channel <= 1 + EPSILON);

/** The same lightness and hue, with the chroma reduced until sRGB can show it. */
function clampChroma(color: Oklch): Oklch {
	if (inGamut(color)) {
		return color;
	}

	let low = 0;
	let high = color.c;

	for (let step = 0; step < 32; step++) {
		const middle = (low + high) / 2;

		if (inGamut({ ...color, c: middle })) {
			low = middle;
		} else {
			high = middle;
		}
	}

	return { ...color, c: low };
}

/** A colour outside sRGB loses chroma first, never lightness or hue. */
export function oklchToHex(color: Oklch): string {
	return toHex(mapRgb(oklchToLinear(clampChroma(color)), fromLinear));
}

/**
 * The colour with the least lightness change, hue and chroma kept, that
 * reaches `target` against `background`: darker on a light background,
 * lighter on a dark one. A colour already there comes back unchanged.
 */
export function adjustToContrast(color: string, background: string, target: number): string {
	const normalized = color.toLowerCase();

	if (contrastRatio(normalized, background) >= target) {
		return normalized;
	}

	const start = hexToOklch(normalized);
	const darken = relativeLuminance(background) > relativeLuminance(normalized);
	const passes = (lightness: number) =>
		contrastRatio(oklchToHex({ ...start, l: lightness }), background) >= target;
	// `near` fails, `far` is the darkest or lightest end, which passes whenever
	// the target is reachable at all.
	let near = start.l;
	let far = darken ? 0 : 1;

	for (let step = 0; step < 40; step++) {
		const middle = (near + far) / 2;

		if (passes(middle)) {
			far = middle;
		} else {
			near = middle;
		}
	}

	return oklchToHex({ ...start, l: far });
}
