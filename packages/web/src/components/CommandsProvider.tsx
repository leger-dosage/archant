import type { ShortcutId } from "@/lib/shortcuts";
import type { ReactNode } from "react";

import { createContext, useCallback, useMemo, useState } from "react";

/** An action a page offers to the palette while it is on screen. */
export type PageCommand = {
	id: string;
	label: string;
	shortcut?: ShortcutId;
	run: () => void;
};

export type Registration = { key: symbol; commands: readonly PageCommand[] };

export type CommandsContextValue = {
	paletteOpen: boolean;
	setPaletteOpen: (open: boolean) => void;
	shortcutsOpen: boolean;
	setShortcutsOpen: (open: boolean) => void;
	creatingAccount: boolean;
	setCreatingAccount: (open: boolean) => void;
	pageCommands: readonly PageCommand[];
	register: (registration: Registration) => () => void;
};

export const CommandsContext = createContext<CommandsContextValue | null>(null);

/**
 * Holds what the root layout's palette and dialogs need from any page: their
 * open state, and the actions of the page on screen.
 */
export function CommandsProvider({ children }: { children: ReactNode }) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [creatingAccount, setCreatingAccount] = useState(false);
	const [registrations, setRegistrations] = useState<readonly Registration[]>([]);
	// Stable, so a page registering its actions does not register again each
	// time the list changes.
	const register = useCallback((registration: Registration) => {
		setRegistrations((current) => [...current, registration]);

		return () =>
			setRegistrations((current) => current.filter((entry) => entry.key !== registration.key));
	}, []);

	const value = useMemo<CommandsContextValue>(
		() => ({
			paletteOpen,
			setPaletteOpen,
			shortcutsOpen,
			setShortcutsOpen,
			creatingAccount,
			setCreatingAccount,
			pageCommands: registrations.flatMap((registration) => registration.commands),
			register,
		}),
		[creatingAccount, paletteOpen, register, registrations, shortcutsOpen],
	);

	return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}
