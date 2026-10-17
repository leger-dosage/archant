import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { settings } from "@archant/data/schema/settings";

/** The `settings` row of Sure's `Setting.syncs_include_pending`. */
const INCLUDE_PENDING_SETTING = "syncs_include_pending";

/** The bank synchronisation settings « Réglages › Banques » shows. */
export type BankSyncSettings = { includePending: boolean };

/**
 * Whether syncs read the bank's pending lines: yes unless the row holds
 * `"false"`, so a household that never touched the switch reads them, as
 * Sure's default does.
 */
export async function includesPending(deps: Pick<ServiceDeps, "db">): Promise<boolean> {
	const row = await deps.db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, INCLUDE_PENDING_SETTING))
		.get();

	return row?.value !== "false";
}

/** « Paramètres de synchronisation », as « Réglages › Banques » shows them. */
export async function bankSyncSettings(deps: Pick<ServiceDeps, "db">): Promise<BankSyncSettings> {
	return { includePending: await includesPending(deps) };
}

/**
 * Saves the switch. Turning it off deletes no stored pending entry: Sure only
 * empties its raw payload, and a booked line still claims them.
 */
export async function saveBankSyncSettings(
	deps: Pick<ServiceDeps, "db">,
	input: BankSyncSettings,
): Promise<BankSyncSettings> {
	const value = String(input.includePending);
	const updatedAt = Date.now();

	await deps.db
		.insert(settings)
		.values({ key: INCLUDE_PENDING_SETTING, value, updatedAt })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });

	return bankSyncSettings(deps);
}
