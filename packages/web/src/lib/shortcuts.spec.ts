import { describe, expect, it } from "vitest";
import { z } from "zod";

import fr from "../locales/fr.json";
import {
	SHORTCUTS,
	SHORTCUT_SECTIONS,
	hasForeignModifier,
	hotkeysOf,
	isApplePlatform,
	isLayerOpen,
	isTypingTarget,
	keysText,
	matchesCommand,
	shortcutOf,
	shortcutTexts,
	stepIndex,
} from "./shortcuts.ts";

const node = z.record(z.string(), z.unknown());

/** The French text at a dotted key, or undefined when a step is missing. */
function translation(key: string): unknown {
	return key.split(".").reduce<unknown>((current, part) => {
		const parsed = node.safeParse(current);

		return parsed.success ? parsed.data[part] : undefined;
	}, fr);
}

describe("SHORTCUTS", () => {
	it("gives each shortcut its own id", () => {
		const ids = SHORTCUTS.map((shortcut) => shortcut.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	it("binds each key to one shortcut only", () => {
		const keys = SHORTCUTS.flatMap((shortcut) => shortcut.keys);

		expect(new Set(keys).size).toBe(keys.length);
	});

	it("has a French label for every shortcut and every section", () => {
		for (const shortcut of SHORTCUTS) {
			expect(typeof translation(shortcut.label), shortcut.label).toBe("string");
		}
		for (const section of SHORTCUT_SECTIONS) {
			expect(typeof translation(`shortcuts.sections.${section}`), section).toBe("string");
		}
	});

	it("lets only the modifier shortcuts fire from a text field", () => {
		expect(
			SHORTCUTS.filter((shortcut) => shortcut.inFields).map((shortcut) => shortcut.id),
		).toEqual(["palette", "toggleSidebar"]);
	});
});

describe("shortcutOf", () => {
	it("finds a shortcut by id", () => {
		expect(shortcutOf("goAccounts").keys).toEqual(["g>c"]);
	});
});

describe("hotkeysOf", () => {
	it("binds mod to ⌘ on Apple platforms and Ctrl elsewhere", () => {
		expect(hotkeysOf(shortcutOf("palette"), true)).toBe("meta+k");
		expect(hotkeysOf(shortcutOf("palette"), false)).toBe("ctrl+k");
	});

	it("joins the alternatives of a shortcut", () => {
		expect(hotkeysOf(shortcutOf("nextRow"))).toBe("j,arrowdown");
		expect(hotkeysOf(shortcutOf("goOperations"))).toBe("g>o");
		expect(hotkeysOf(shortcutOf("goRules"))).toBe("g>u");
	});
});

describe("keysText", () => {
	it("reads ⌘K on Apple platforms and Ctrl K elsewhere", () => {
		expect(keysText("mod+k", true)).toBe("⌘K");
		expect(keysText("mod+k", false)).toBe("Ctrl K");
	});

	it("spaces the keys of a sequence", () => {
		expect(keysText("g>c", true)).toBe("G C");
		expect(keysText("g>c", false)).toBe("G C");
	});

	it("names arrows and Enter with symbols, and keeps punctuation", () => {
		expect(keysText("arrowdown", false)).toBe("↓");
		expect(keysText("arrowup", false)).toBe("↑");
		expect(keysText("enter", false)).toBe("↵");
		expect(keysText("?", false)).toBe("?");
		expect(keysText("/", true)).toBe("/");
	});

	it("reads ⇧J on Apple platforms and Shift J elsewhere", () => {
		expect(keysText("shift+j", true)).toBe("⇧J");
		expect(keysText("shift+arrowdown", false)).toBe("Shift ↓");
		expect(keysText("escape", false)).toBe("Esc");
	});

	it("lists every binding of a shortcut, the main one first", () => {
		expect(shortcutTexts("openRow", false)).toEqual(["E", "↵"]);
		expect(shortcutTexts("palette", true)).toEqual(["⌘K"]);
	});
});

/** A key event with the given modifiers held. */
const press = (
	key: string,
	modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
	key,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

describe("hasForeignModifier", () => {
	it("accepts the Shift that ? and / need on AZERTY", () => {
		expect(hasForeignModifier(press("?", { shiftKey: true }))).toBe(false);
		expect(hasForeignModifier(press("/", { shiftKey: true }))).toBe(false);
		expect(hasForeignModifier(press("j"))).toBe(false);
	});

	it("leaves Shift on letters, arrows and Enter to the selection shortcuts", () => {
		expect(hasForeignModifier(press("J", { shiftKey: true }))).toBe(true);
		expect(hasForeignModifier(press("ArrowDown", { shiftKey: true }))).toBe(true);
		expect(hasForeignModifier(press("Enter", { shiftKey: true }))).toBe(true);
	});

	it("refuses Ctrl, ⌘ and Alt", () => {
		expect(hasForeignModifier(press("k", { ctrlKey: true }))).toBe(true);
		expect(hasForeignModifier(press("k", { metaKey: true }))).toBe(true);
		expect(hasForeignModifier(press("k", { altKey: true }))).toBe(true);
	});
});

describe("isApplePlatform", () => {
	it("recognises macOS and iOS", () => {
		expect(isApplePlatform("MacIntel")).toBe(true);
		expect(isApplePlatform("iPhone")).toBe(true);
		expect(isApplePlatform("Win32")).toBe(false);
		expect(isApplePlatform("Linux x86_64")).toBe(false);
	});
});

describe("isTypingTarget", () => {
	it("is true for fields and editable content", () => {
		expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
		expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
		expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
		expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
	});

	it("is false for buttons, the page and non-elements", () => {
		expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
		expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget({})).toBe(false);
	});
});

describe("isLayerOpen", () => {
	it("asks for an open dialog, alert dialog, menu or listbox", () => {
		const asked: string[] = [];
		const root = {
			querySelector: (selector: string) => {
				asked.push(selector);
				return null;
			},
		};

		expect(isLayerOpen(root)).toBe(false);
		expect(asked[0]).toContain('[role="dialog"][data-state="open"]');
		expect(asked[0]).toContain('[role="menu"][data-state="open"]');
		expect(asked[0]).not.toContain("tooltip");
	});

	it("is true when something matches", () => {
		expect(isLayerOpen({ querySelector: () => ({}) })).toBe(true);
	});
});

describe("stepIndex", () => {
	it("lands on the first row when none has focus", () => {
		expect(stepIndex(-1, 5, 1)).toBe(0);
		expect(stepIndex(-1, 5, -1)).toBe(0);
	});

	it("moves one row down or up", () => {
		expect(stepIndex(1, 5, 1)).toBe(2);
		expect(stepIndex(1, 5, -1)).toBe(0);
	});

	it("stops at both ends of the page", () => {
		expect(stepIndex(4, 5, 1)).toBe(4);
		expect(stepIndex(0, 5, -1)).toBe(0);
	});

	it("has nothing to focus in an empty list", () => {
		expect(stepIndex(-1, 0, 1)).toBe(-1);
	});
});

describe("matchesCommand", () => {
	it("ignores case and accents", () => {
		expect(matchesCommand("Opérations", "operations")).toBe(true);
		expect(matchesCommand("Livret A", "LIVRET")).toBe(true);
		expect(matchesCommand("Epargne", "épargne")).toBe(true);
	});

	it("needs every typed word, in any order", () => {
		expect(matchesCommand("Ajouter un compte", "compte ajou")).toBe(true);
		expect(matchesCommand("Ajouter un compte", "compte solde")).toBe(false);
	});

	it("matches everything on an empty query", () => {
		expect(matchesCommand("Comptes", "  ")).toBe(true);
	});
});
