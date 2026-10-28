import type { ServiceDeps } from "../deps.ts";

import { eq } from "drizzle-orm";

import { settings } from "@archant/data/schema/settings";

import { AppError } from "../../lib/errors.ts";

/** The `settings` row of Sure's `families.recurring_transactions_disabled`. */
const DISABLED_SETTING = "recurring_transactions_disabled";

/** « Activer les transactions récurrentes », as « Réglages › Transactions récurrentes » shows it. */
export type RecurringSettings = { enabled: boolean };

/**
 * Whether the household follows recurring transactions: yes unless the row
 * holds `"true"`, so a household that never touched the switch does, as
 * Sure's column defaults to `false`.
 */
export async function recurringEnabled(deps: Pick<ServiceDeps, "db">): Promise<boolean> {
	const row = await deps.db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, DISABLED_SETTING))
		.get();

	return row?.value !== "true";
}

export async function recurringSettings(deps: Pick<ServiceDeps, "db">): Promise<RecurringSettings> {
	return { enabled: await recurringEnabled(deps) };
}

/**
 * Sure's `update_settings`. Turning it off deletes and changes nothing: the
 * series wait, and the next run after it is turned on again picks them up.
 */
export async function saveRecurringSettings(
	deps: Pick<ServiceDeps, "db">,
	{ enabled }: RecurringSettings,
): Promise<RecurringSettings> {
	const updatedAt = Date.now();
	const value = String(!enabled);

	await deps.db
		.insert(settings)
		.values({ key: DISABLED_SETTING, value, updatedAt })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });

	return { enabled };
}

/** Sure's `ensure_recurring_enabled`: a bill read or write refused while the switch is off. */
export async function ensureRecurringEnabled(deps: Pick<ServiceDeps, "db">): Promise<void> {
	if (!(await recurringEnabled(deps))) {
		throw new AppError("RECURRING_DISABLED", "Recurring transactions are disabled.");
	}
}
