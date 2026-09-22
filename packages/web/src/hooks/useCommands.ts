import type { CommandsContextValue, PageCommand } from "@/components/CommandsProvider";

import { useContext, useEffect } from "react";

import { CommandsContext } from "@/components/CommandsProvider";

export function useCommands(): CommandsContextValue {
	const value = useContext(CommandsContext);

	if (value === null) {
		throw new Error("useCommands needs a CommandsProvider above it.");
	}

	return value;
}

/** Offers these actions in the palette's « Actions » group while the caller is mounted. */
export function usePageCommands(commands: readonly PageCommand[]) {
	const { register } = useCommands();

	useEffect(() => register({ key: Symbol("page commands"), commands }), [commands, register]);
}
