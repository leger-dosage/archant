import type { ShortcutId } from "@/lib/shortcuts";

import { useHotkeys } from "react-hotkeys-hook";

import {
	hasForeignModifier,
	hotkeysOf,
	isLayerOpen,
	isTypingTarget,
	shortcutOf,
} from "@/lib/shortcuts";

// Key presses that began while a layer was open. Radix closes a popover on
// `Escape` from a capture listener, and React re-renders before the
// shortcuts' own listener runs: by then the layer looks closed, and the
// `Escape` that closed a bulk bar's combobox also cleared the selection.
// Recorded on the window, whose capture listeners run before Radix's.
const beganInLayer = new WeakSet<KeyboardEvent>();

if (typeof window !== "undefined") {
	window.addEventListener(
		"keydown",
		(event) => {
			if (isLayerOpen(document)) {
				beganInLayer.add(event);
			}
		},
		{ capture: true },
	);
}

type ShortcutOptions = {
	enabled?: boolean;
	/** A condition read on each key press; the key keeps its default action when false. */
	when?: (event: KeyboardEvent) => boolean;
};

/**
 * Binds a shortcut of the catalogue. Every shortcut is off while a dialog,
 * sheet, menu or popover is open; single-letter ones also while typing.
 */
export function useShortcut(
	id: ShortcutId,
	handler: (event: KeyboardEvent) => void,
	{ enabled = true, when }: ShortcutOptions = {},
) {
	const shortcut = shortcutOf(id);
	const hasModifier = shortcut.keys.some((keys) => keys.includes("+"));
	const isSequence = shortcut.keys.some((keys) => keys.includes(">"));

	const ignored = (event: KeyboardEvent) => {
		if (isLayerOpen(document) || beganInLayer.has(event)) {
			// The library returns before its own `preventDefault` here, and
			// `Ctrl+K` under a sheet would reach the browser, which focuses its
			// address bar on Windows and Linux.
			if (hasModifier && !isSequence) {
				event.preventDefault();
			}

			return true;
		}

		return (
			(!shortcut.inFields && isTypingTarget(event.target)) ||
			(!hasModifier && hasForeignModifier(event)) ||
			(when !== undefined && !when(event))
		);
	};

	useHotkeys(
		hotkeysOf(shortcut),
		(event) => {
			// react-hotkeys-hook skips `ignoreEventWhen` for sequences.
			if (isSequence && ignored(event)) {
				return;
			}
			handler(event);
		},
		{
			enabled,
			useKey: true,
			// The modifier check is ours: the library would refuse the Shift of `?`.
			ignoreModifiers: !hasModifier,
			enableOnFormTags: shortcut.inFields,
			enableOnContentEditable: shortcut.inFields,
			ignoreEventWhen: ignored,
			preventDefault: true,
		},
	);
}
