import type { TempDatabase } from "./temp-database.ts";

import { randomUUID } from "node:crypto";

import { toMicros } from "@archant/data/micros";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { securities } from "@archant/data/schema/securities";

import { addDays, today } from "../domain/dates.ts";
import { createAccount, deleteAccount } from "../services/ledger/accounts.ts";
import { oneByOne } from "../services/ledger/shared.ts";
import { recordTrade } from "../services/ledger/trades.ts";

const TIME_ZONE = "Europe/Paris";

/**
 * LVMH on Euronext Paris, created on Monday 2026-09-14 in Paris, the week
 * before the clock `useSignedInApp` sets: `chartMcPa` holds its prices.
 * Held from its creation day, by a buy of one share on an investment account
 * of its own, unless `held` is false: only a traded security is fetched.
 */
export async function insertSecurity(
	db: TempDatabase["db"],
	fields: Partial<typeof securities.$inferInsert> = {},
	{ held = true }: { held?: boolean } = {},
): Promise<string> {
	const id = randomUUID();
	const createdAt = Date.parse("2026-09-14T08:00:00Z");
	const row = {
		id,
		isin: "FR0000121014",
		ticker: "MC.PA",
		mic: "XPAR",
		name: "LVMH",
		currency: "EUR",
		provider: "yahoo" as const,
		createdAt,
		updatedAt: createdAt,
		...fields,
	};

	await db.insert(securities).values(row);

	if (held) {
		await holdSecurity(db, id, today(TIME_ZONE, new Date(row.createdAt)), row.currency);
	}

	return id;
}

/**
 * A buy of one share of `securityId` at 1.00 on `date`, on an investment
 * account opened 365 days before at zero. Returns the account's id.
 */
export async function holdSecurity(
	db: TempDatabase["db"],
	securityId: string,
	date: string,
	currency = "EUR",
): Promise<string> {
	if (!isCurrencyCode(currency)) {
		throw new Error(`${currency} is no ISO 4217 code.`);
	}

	const deps = { db, timeZone: TIME_ZONE };
	const account = await createAccount(
		deps,
		{
			name: "PEA",
			type: "investment",
			subtype: "pea",
			currency,
			openingBalance: toMinorUnits(0),
			openingDate: addDays(date, -365),
		},
		{ origin: "user" },
	);

	await recordTrade(
		deps,
		account.id,
		{
			side: "buy",
			security: { source: "known", id: securityId },
			date,
			quantity: toMicros(1_000_000),
			price: toMicros(1_000_000),
			fee: toMinorUnits(0),
		},
		{ origin: "user" },
	);

	return account.id;
}

/** Deletes every account, their trades with them, then every security and its prices. */
export async function deleteSecurities(db: TempDatabase["db"]): Promise<void> {
	const deps = { db, timeZone: TIME_ZONE };
	const rows = await db.select({ id: accounts.id }).from(accounts);

	await oneByOne(rows, async ({ id }) => deleteAccount(deps, id, { origin: "user" }));

	await db.delete(securities);
}
