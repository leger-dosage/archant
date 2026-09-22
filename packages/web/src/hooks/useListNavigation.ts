import type { RefObject } from "react";

import { useShortcut } from "@/hooks/useShortcut";
import { stepIndex } from "@/lib/shortcuts";

const ROW = "[data-transaction-id]";

function rowsOf(container: RefObject<HTMLElement | null>): HTMLElement[] {
	return [...(container.current?.querySelectorAll<HTMLElement>(ROW) ?? [])];
}

function focusedRow(container: RefObject<HTMLElement | null>): HTMLElement | undefined {
	return rowsOf(container).find((row) => row === document.activeElement);
}

const isArrow = (event: KeyboardEvent) => event.key.startsWith("Arrow");

/**
 * `j` / `k` move focus between the rows of a transaction list, from the first
 * row when none has focus; the arrows do the same once a row has focus, and
 * otherwise keep scrolling the page. `e` or `Enter` opens the focused row.
 */
export function useListNavigation(container: RefObject<HTMLElement | null>) {
	const move = (step: 1 | -1) => {
		const rows = rowsOf(container);
		const current = rows.findIndex((row) => row === document.activeElement);

		rows[stepIndex(current, rows.length, step)]?.focus();
	};
	const movable = (event: KeyboardEvent) =>
		rowsOf(container).length > 0 && (!isArrow(event) || focusedRow(container) !== undefined);

	useShortcut("nextRow", () => move(1), { when: movable });
	useShortcut("previousRow", () => move(-1), { when: movable });
	useShortcut("openRow", () => focusedRow(container)?.click(), {
		when: () => focusedRow(container) !== undefined,
	});
}
