import type { PreferencesInput } from "../schemas/preferences.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import type { AccountOrder } from "@archant/data/account-orders";
import { DEFAULT_ACCOUNT_ORDER } from "@archant/data/account-orders";
import { users } from "@archant/data/schema/auth";

/**
 * One user's preferences, Sure's `users` columns that « Préférences » edits,
 * and its `show_split_grouped`, which Sure keeps in « Apparence ».
 */
export type Preferences = { defaultAccountOrder: AccountOrder; showSplitGrouped: boolean };

/**
 * The signed-in user's preferences; the defaults for a user removed since
 * the session was checked.
 */
export async function getPreferences(deps: ServiceDeps, userId: string): Promise<Preferences> {
	const user = await deps.db
		.select({
			defaultAccountOrder: users.defaultAccountOrder,
			showSplitGrouped: users.showSplitGrouped,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	return {
		defaultAccountOrder: user?.defaultAccountOrder ?? DEFAULT_ACCOUNT_ORDER,
		showSplitGrouped: user?.showSplitGrouped ?? true,
	};
}

/**
 * Saves the user's preferences, as Sure's `PATCH /users/:id` from
 * « Préférences », not Better Auth's update endpoint, which should not take
 * an app setting. Only the fields given change; another user's are
 * untouched.
 */
export async function updatePreferences(
	deps: ServiceDeps,
	userId: string,
	input: PreferencesInput,
): Promise<Preferences> {
	const changes = {
		...(input.defaultAccountOrder !== undefined && {
			defaultAccountOrder: input.defaultAccountOrder,
		}),
		...(input.showSplitGrouped !== undefined && { showSplitGrouped: input.showSplitGrouped }),
	};

	if (Object.keys(changes).length > 0) {
		await deps.db.update(users).set(changes).where(eq(users.id, userId));
	}

	return getPreferences(deps, userId);
}
