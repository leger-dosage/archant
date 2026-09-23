/**
 * Every keyboard shortcut of the interface. The bindings, the « Raccourcis
 * clavier » dialog and the tooltips all read this list, so a shortcut cannot
 * exist without being listed.
 *
 * Keys use react-hotkeys-hook's syntax, matched on the typed character rather
 * than the physical key: `+` joins a modifier to a key, `>` chains a sequence,
 * and `mod` is `⌘` on Apple platforms, `Ctrl` elsewhere.
 */

export const SHORTCUT_SECTIONS = ["general", "navigation", "actions", "lists"] as const;

export type ShortcutSection = (typeof SHORTCUT_SECTIONS)[number];

export const SHORTCUTS = [
	{
		id: "palette",
		keys: ["mod+k"],
		label: "shortcuts.labels.palette",
		section: "general",
		// A shortcut with a modifier types nothing, so it may fire from a text field.
		inFields: true,
	},
	{
		// Bound by shadcn's `ui/sidebar.tsx`, which also lets it fire from a field;
		// listed here so the dialog and the trigger's tooltip show it.
		id: "toggleSidebar",
		keys: ["mod+b"],
		label: "shortcuts.labels.toggleSidebar",
		section: "general",
		inFields: true,
	},
	{
		id: "shortcuts",
		keys: ["?"],
		label: "shortcuts.labels.shortcuts",
		section: "general",
		inFields: false,
	},
	{
		id: "goDashboard",
		keys: ["g>d"],
		label: "shortcuts.labels.goDashboard",
		section: "navigation",
		inFields: false,
	},
	{
		id: "goAccounts",
		keys: ["g>c"],
		label: "shortcuts.labels.goAccounts",
		section: "navigation",
		inFields: false,
	},
	{
		id: "goOperations",
		keys: ["g>o"],
		label: "shortcuts.labels.goOperations",
		section: "navigation",
		inFields: false,
	},
	{
		id: "goSettings",
		keys: ["g>s"],
		label: "shortcuts.labels.goSettings",
		section: "navigation",
		inFields: false,
	},
	{
		id: "newTransaction",
		keys: ["n"],
		label: "shortcuts.labels.newTransaction",
		section: "actions",
		inFields: false,
	},
	{
		id: "importFile",
		keys: ["i"],
		label: "shortcuts.labels.importFile",
		section: "actions",
		inFields: false,
	},
	{
		id: "search",
		keys: ["/"],
		label: "shortcuts.labels.search",
		section: "lists",
		inFields: false,
	},
	{
		id: "nextRow",
		keys: ["j", "arrowdown"],
		label: "shortcuts.labels.nextRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "previousRow",
		keys: ["k", "arrowup"],
		label: "shortcuts.labels.previousRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "openRow",
		keys: ["e", "enter"],
		label: "shortcuts.labels.openRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "categoriseRow",
		keys: ["c"],
		label: "shortcuts.labels.categoriseRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "setMerchantRow",
		keys: ["m"],
		label: "shortcuts.labels.setMerchantRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "setTagsRow",
		keys: ["t"],
		label: "shortcuts.labels.setTagsRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "toggleRow",
		keys: ["x"],
		label: "shortcuts.labels.toggleRow",
		section: "lists",
		inFields: false,
	},
	{
		id: "extendNext",
		keys: ["shift+j", "shift+arrowdown"],
		label: "shortcuts.labels.extendNext",
		section: "lists",
		inFields: false,
	},
	{
		id: "extendPrevious",
		keys: ["shift+k", "shift+arrowup"],
		label: "shortcuts.labels.extendPrevious",
		section: "lists",
		inFields: false,
	},
	{
		id: "clearSelection",
		keys: ["escape"],
		label: "shortcuts.labels.clearSelection",
		section: "lists",
		inFields: false,
	},
] as const satisfies readonly {
	id: string;
	keys: readonly [string, ...string[]];
	label: `shortcuts.labels.${string}`;
	section: ShortcutSection;
	inFields: boolean;
}[];

export type Shortcut = (typeof SHORTCUTS)[number];

export type ShortcutId = Shortcut["id"];

export function shortcutOf(id: ShortcutId): Shortcut {
	const shortcut = SHORTCUTS.find((candidate) => candidate.id === id);

	if (shortcut === undefined) {
		throw new Error(`Unknown shortcut ${id}`);
	}

	return shortcut;
}

export function isApplePlatform(platform: string): boolean {
	return /mac|iphone|ipad|ipod/iu.test(platform);
}

export const APPLE =
	typeof navigator !== "undefined" &&
	isApplePlatform(navigator.platform === "" ? navigator.userAgent : navigator.platform);

/**
 * The keys handed to react-hotkeys-hook. `mod` becomes `meta` on Apple
 * platforms and `ctrl` elsewhere, decided like the labels rather than by the
 * library's user-agent test, so the key shown is the key bound. `Ctrl+K`
 * stays free on macOS, where it deletes to the end of the line in a field.
 */
export function hotkeysOf(shortcut: Shortcut, apple: boolean = APPLE): string {
	return shortcut.keys.map((keys) => keys.replace("mod+", apple ? "meta+" : "ctrl+")).join(",");
}

// `?` and `/` need Shift on AZERTY, so Shift is allowed on punctuation. On a
// letter, an arrow or Enter it makes another shortcut: `Shift+J` extends the
// selection, and must not also move as `j` does.
export function hasForeignModifier(event: {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): boolean {
	return (
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		(event.shiftKey && /^(?:[a-z]|arrow\w+|enter)$/iu.test(event.key))
	);
}

const KEY_NAMES: Record<string, string> = {
	arrowdown: "↓",
	arrowup: "↑",
	enter: "↵",
	escape: "Esc",
};

function keyName(key: string): string {
	return KEY_NAMES[key] ?? key.toUpperCase();
}

/** One binding as shown to the user: `⌘K` on Apple platforms, `Ctrl K` elsewhere, `G C`. */
export function keysText(keys: string, apple: boolean): string {
	if (keys.includes(">")) {
		return keys.split(">").map(keyName).join(" ");
	}

	const parts = keys.split("+");
	const key = keyName(parts.at(-1) ?? "");
	const modifiers = parts.slice(0, -1).map((modifier) => {
		if (modifier === "mod") {
			return apple ? "⌘" : "Ctrl";
		}

		return modifier === "shift" ? (apple ? "⇧" : "Shift") : modifier;
	});

	return apple ? [...modifiers, key].join("") : [...modifiers, key].join(" ");
}

/** Every binding of a shortcut as shown to the user, the main one first. */
export function shortcutTexts(id: ShortcutId, apple: boolean = APPLE): string[] {
	return shortcutOf(id).keys.map((keys) => keysText(keys, apple));
}

/**
 * Whether a key event comes from where text is typed. Single-letter shortcuts
 * stay quiet there: typing « gc » in the search field must not navigate.
 */
export function isTypingTarget(target: unknown): boolean {
	if (typeof target !== "object" || target === null) {
		return false;
	}

	if ("isContentEditable" in target && target.isContentEditable === true) {
		return true;
	}

	if (!("tagName" in target) || typeof target.tagName !== "string") {
		return false;
	}

	return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName.toUpperCase());
}

// Radix marks every open dialog, sheet, menu, popover and select this way.
// Tooltips are left out: one is open whenever a button with a hint is hovered.
const OPEN_LAYER = [
	'[role="dialog"][data-state="open"]',
	'[role="alertdialog"][data-state="open"]',
	'[role="menu"][data-state="open"]',
	'[role="listbox"][data-state="open"]',
].join(",");

/**
 * Whether a dialog, sheet, menu or popover is open. Shortcuts are off then:
 * layers stack one deep (EXPERIENCE.md), and `g o` must not leave a sheet
 * holding unsaved changes.
 */
export function isLayerOpen(root: { querySelector: (selectors: string) => unknown }): boolean {
	return root.querySelector(OPEN_LAYER) !== null;
}

/**
 * The row to focus after a `j` or `k`. With no row focused (`current` is -1)
 * either key lands on the first row, as in Linear. It never passes either end
 * of the page.
 */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
	if (count === 0) {
		return -1;
	}

	if (current === -1) {
		return 0;
	}

	return Math.min(Math.max(current + step, 0), count - 1);
}

function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

/** Whether a palette entry matches what is typed, case and accents aside, word by word. */
export function matchesCommand(text: string, query: string): boolean {
	const haystack = fold(text);

	return fold(query)
		.split(/\s+/u)
		.filter((word) => word !== "")
		.every((word) => haystack.includes(word));
}
