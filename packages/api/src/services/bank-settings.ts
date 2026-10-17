import type { ServiceDeps } from "./deps.ts";

import { eq, inArray, sql } from "drizzle-orm";

import { settings } from "@archant/data/schema/settings";

import { AUTO_SYNC_TIME_FORMAT } from "../schemas/bank-connections.ts";

/** The `settings` row of Sure's `Setting.syncs_include_pending`. */
const INCLUDE_PENDING_SETTING = "syncs_include_pending";

/** The `settings` row of Sure's `Setting.auto_sync_enabled`. */
const AUTO_SYNC_ENABLED_SETTING = "auto_sync_enabled";

/** The `settings` row of Sure's `Setting.auto_sync_time`, `HH:MM`. */
const AUTO_SYNC_TIME_SETTING = "auto_sync_time";

/** Sure's default `auto_sync_time`. */
const DEFAULT_AUTO_SYNC_TIME = "02:22";

const SYNC_SETTINGS = [INCLUDE_PENDING_SETTING, AUTO_SYNC_ENABLED_SETTING, AUTO_SYNC_TIME_SETTING];

/** The bank synchronisation settings « Réglages › Banques » shows. */
export type BankSyncSettings = {
	includePending: boolean;
	autoSyncEnabled: boolean;
	/** `HH:MM`, two-digit hours, in `APP_TIMEZONE`. */
	autoSyncTime: string;
};

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

/**
 * Sure's `AUTO_SYNC_TIME_FORMAT` read into two-digit hours, `7:05` becoming
 * `07:05`; `null` for anything else.
 */
function normalizedSyncTime(value: string): string | null {
	const match = AUTO_SYNC_TIME_FORMAT.exec(value);

	return match === null ? null : `${(match[1] ?? "").padStart(2, "0")}:${match[2] ?? ""}`;
}

/**
 * « Paramètres de synchronisation », as « Réglages › Banques » shows them.
 * Each switch is on unless its row holds `"false"`, as Sure's defaults; a
 * time missing, or one no longer readable, is Sure's 02:22, as its
 * scheduler falls back to it.
 */
export async function bankSyncSettings(deps: Pick<ServiceDeps, "db">): Promise<BankSyncSettings> {
	const rows = await deps.db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(inArray(settings.key, SYNC_SETTINGS));
	const value = (key: string) => rows.find((row) => row.key === key)?.value;
	const time = value(AUTO_SYNC_TIME_SETTING);

	return {
		includePending: value(INCLUDE_PENDING_SETTING) !== "false",
		autoSyncEnabled: value(AUTO_SYNC_ENABLED_SETTING) !== "false",
		autoSyncTime: (time === undefined ? null : normalizedSyncTime(time)) ?? DEFAULT_AUTO_SYNC_TIME,
	};
}

/**
 * Saves the three settings together. Turning pending lines off
 * deletes no stored pending entry: Sure only empties its raw payload, and a
 * booked line still claims them. The schedule reads the auto sync rows at
 * its next wake, within the minute.
 */
export async function saveBankSyncSettings(
	deps: Pick<ServiceDeps, "db">,
	input: BankSyncSettings,
): Promise<BankSyncSettings> {
	const updatedAt = Date.now();
	const values = [
		{ key: INCLUDE_PENDING_SETTING, value: String(input.includePending), updatedAt },
		{ key: AUTO_SYNC_ENABLED_SETTING, value: String(input.autoSyncEnabled), updatedAt },
		{
			key: AUTO_SYNC_TIME_SETTING,
			value: normalizedSyncTime(input.autoSyncTime) ?? DEFAULT_AUTO_SYNC_TIME,
			updatedAt,
		},
	];

	// One statement, so a failure saves none of the three.
	await deps.db
		.insert(settings)
		.values(values)
		.onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedAt } });

	return bankSyncSettings(deps);
}
