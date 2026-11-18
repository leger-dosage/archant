import { eq } from "drizzle-orm";

import type { Database } from "@archant/data/client";
import { settings } from "@archant/data/schema/settings";

const KEY = "manual_reconciliation";

export async function manualReconciliationEnabled(db: Pick<Database, "select">): Promise<boolean> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, KEY))
		.get();

	return row?.value === "true";
}

export async function saveManualReconciliation(
	db: Pick<Database, "insert">,
	enabled: boolean,
): Promise<void> {
	const value = String(enabled);
	const updatedAt = Date.now();

	await db
		.insert(settings)
		.values({ key: KEY, value, updatedAt })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });
}
