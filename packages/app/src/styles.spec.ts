import { describe, expect, it } from "vitest";

import { contrastRatio } from "./lib/contrast.ts";
import styles from "./styles.css?raw";

/** The `--name: #rrggbb` declarations of one top-level block, `:root` or `.dark`. */
function tokensOf(selector: string): Map<string, string> {
	const start = styles.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "mu"));

	if (start === -1) {
		throw new Error(`No ${selector} block in styles.css`);
	}

	const block = styles.slice(start, styles.indexOf("\n}", start));
	const tokens = new Map<string, string>();

	for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/giu)) {
		if (name !== undefined && value !== undefined) {
			tokens.set(name, value);
		}
	}

	return tokens;
}

const light = tokensOf(":root");
// `.dark` redeclares every token it changes; the rest cascade from `:root`.
const dark = new Map([...light, ...tokensOf(".dark")]);

const TEXT = ["foreground", "foreground-secondary", "muted-foreground"];
const TEXT_SURFACES = ["sidebar", "background", "section", "accent", "selection", "sidebar-accent"];
const ACCENT_TEXT = ["link", "money-income", "destructive"];
const ACCENT_SURFACES = ["background", "section", "accent", "selection"];

// DESIGN.md's surfaces under shadcn's names: `sidebar` is its base
// `background`, `background` its `panel`, `accent` its `hover`,
// `sidebar-accent` its `active`, under a muted balance on the active row.
const pairs: [string, string][] = [
	...TEXT.flatMap((text) => TEXT_SURFACES.map((surface): [string, string] => [text, surface])),
	...ACCENT_TEXT.flatMap((text) =>
		ACCENT_SURFACES.map((surface): [string, string] => [text, surface]),
	),
	["primary-foreground", "primary"],
];

describe.each([
	["light", light],
	["dark", dark],
])("%s theme", (_, tokens) => {
	it.each(pairs)("%s on %s meets WCAG AA", (text, surface) => {
		const foreground = tokens.get(text);
		const background = tokens.get(surface);

		expect(foreground, `--${text}`).toBeDefined();
		expect(background, `--${surface}`).toBeDefined();
		expect(contrastRatio(foreground ?? "", background ?? "")).toBeGreaterThanOrEqual(4.5);
	});
});

it("keeps the muted amount the muted text colour", () => {
	expect(light.get("money-muted")).toBe(light.get("muted-foreground"));
	expect(dark.get("money-muted")).toBe(dark.get("muted-foreground"));
});

describe("the panel", () => {
	it("is DESIGN.md's panel in both modes", () => {
		expect(light.get("background")).toBe("#ffffff");
		expect(dark.get("background")).toBe("#1f2023");
		expect(light.get("card")).toBe(light.get("background"));
		expect(dark.get("card")).toBe(dark.get("background"));
	});
});
