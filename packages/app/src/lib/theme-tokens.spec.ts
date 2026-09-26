import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CARD_COLORS } from "./pill-text-color.ts";

// The front matter of
// _bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md,
// as CSS custom properties. A token absent from a mode is not in its map.
const LIGHT = {
	background: "#F7F7F7",
	card: "#FFFFFF",
	tray: "#F0F0F0",
	foreground: "#171717",
	"muted-foreground": "#737373",
	"muted-foreground-on-grey": "#5C5C5C",
	border: "#E7E7E7",
	sidebar: "#F7F7F7",
	primary: "#171717",
	"primary-foreground": "#FFFFFF",
	"accent-brand": "#444CE7",
	ring: "#444CE7",
	destructive: "#C91313",
	warning: "#B54708",
	"money-income": "#067647",
	"money-expense": "#171717",
	"money-muted": "#737373",
	"trend-up": "#12B76A",
	"trend-down": "#F13636",
	"type-depository": "#875BF7",
	"type-investment": "#1570EF",
	"type-property": "#06AED4",
	"type-vehicle": "#F23E94",
	"type-credit-card": "#F13636",
	"type-loan": "#D444F1",
	transfer: "#444CE7",
	uncategorised: "#737373",
	logo: "#171717",
	"ring-shadow": "0 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)",
};

const DARK = {
	background: "#0B0B0B",
	card: "#171717",
	tray: "#1F1F1F",
	foreground: "#F7F7F7",
	"muted-foreground": "#A3A3A3",
	border: "#242424",
	sidebar: "#0B0B0B",
	primary: "#F7F7F7",
	"primary-foreground": "#171717",
	"accent-brand": "#8098F9",
	ring: "#8098F9",
	destructive: "#ED4E4E",
	warning: "#FDB022",
	"money-income": "#32D583",
	"money-expense": "#F7F7F7",
	"money-muted": "#A3A3A3",
	logo: "#F7F7F7",
	"ring-shadow": "0 0 0 1px rgba(255, 255, 255, 0.08)",
};

const RADII = { sm: "6px", md: "8px", lg: "10px", xl: "12px" };

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** The custom properties a top-level rule declares, by name. */
function declarations(selector: string): Map<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	const end = css.indexOf("\n}", start);
	const block = css.slice(start, end);

	return new Map(
		Array.from(block.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gmu), ([, name = "", value = ""]) => [
			name,
			value.trim().toLowerCase(),
		]),
	);
}

describe("styles.css", () => {
	it.each([
		[":root", LIGHT],
		[".dark", DARK],
	] as const)("sets DESIGN.md's colours in %s", (selector, tokens) => {
		const declared = declarations(selector);

		for (const [name, value] of Object.entries(tokens)) {
			expect(declared.get(name), `--${name}`).toBe(value.toLowerCase());
		}
	});

	it("sets DESIGN.md's radii", () => {
		const declared = declarations("@theme inline");

		for (const [name, value] of Object.entries(RADII)) {
			expect(declared.get(`radius-${name}`), `--radius-${name}`).toBe(value);
		}
	});

	it("gives the pill helper the card colour of each mode", () => {
		expect(declarations(":root").get("card")).toBe(CARD_COLORS.light.toLowerCase());
		expect(declarations(".dark").get("card")).toBe(CARD_COLORS.dark.toLowerCase());
	});

	it("puts the sidebar on the page grey in both modes", () => {
		expect(declarations(":root").get("sidebar")).toBe(declarations(":root").get("background"));
		expect(declarations(".dark").get("sidebar")).toBe(declarations(".dark").get("background"));
	});
});
