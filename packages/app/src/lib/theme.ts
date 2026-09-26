import { useSyncExternalStore } from "react";

export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

// index.html reads this key before the first paint; rename both together.
const STORAGE_KEY = "archant.theme";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function isThemeChoice(value: string | null): value is ThemeChoice {
	return THEME_CHOICES.some((choice) => choice === value);
}

function readChoice(): ThemeChoice {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);

		return isThemeChoice(stored) ? stored : "system";
	} catch {
		// Storage can be disabled; the system preference still applies.
		return "system";
	}
}

let choice: ThemeChoice = "system";
const listeners = new Set<() => void>();

export function isDark(current: ThemeChoice): boolean {
	return current === "dark" || (current === "system" && darkQuery().matches);
}

function apply() {
	document.documentElement.classList.toggle("dark", isDark(choice));
	for (const listener of listeners) {
		listener();
	}
}

/** Reads the stored choice and follows the system while the choice is "system". */
export function initTheme() {
	choice = readChoice();
	darkQuery().addEventListener("change", apply);
	apply();
}

export function setThemeChoice(next: ThemeChoice) {
	choice = next;
	try {
		if (next === "system") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, next);
		}
	} catch {
		// The choice still applies for this visit.
	}
	apply();
}

function subscribe(listener: () => void) {
	listeners.add(listener);

	return () => listeners.delete(listener);
}

export function useThemeChoice(): ThemeChoice {
	return useSyncExternalStore(subscribe, () => choice);
}

/**
 * The theme actually on screen, for components that must pick one. The
 * resolved value is the snapshot itself: with the choice as snapshot, an OS
 * switch under "system" would change nothing React can see.
 */
export function useResolvedTheme(): "light" | "dark" {
	return useSyncExternalStore(subscribe, () => (isDark(choice) ? "dark" : "light"));
}
