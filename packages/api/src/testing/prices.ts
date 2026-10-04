import type { TempDatabase } from "./temp-database.ts";

import { randomUUID } from "node:crypto";

import { securities } from "@archant/data/schema/securities";

/**
 * LVMH on Euronext Paris, created on Monday 2026-09-14 in Paris, the week
 * before the clock `useSignedInApp` sets: `chartMcPa` holds its prices.
 */
export async function insertSecurity(
	db: TempDatabase["db"],
	fields: Partial<typeof securities.$inferInsert> = {},
): Promise<string> {
	const id = randomUUID();
	const createdAt = Date.parse("2026-09-14T08:00:00Z");

	await db.insert(securities).values({
		id,
		isin: "FR0000121014",
		ticker: "MC.PA",
		mic: "XPAR",
		name: "LVMH",
		currency: "EUR",
		provider: "yahoo",
		createdAt,
		updatedAt: createdAt,
		...fields,
	});

	return id;
}
