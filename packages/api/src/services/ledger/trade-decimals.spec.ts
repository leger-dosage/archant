import { asc, sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@archant/data/client";
import { createDb } from "@archant/data/client";
import { scaledQuantity, scaledTradePrice } from "@archant/data/decimals";
import { runMigrations } from "@archant/data/migrate";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { migrateBefore } from "@archant/data/testing/migrations";

import { quantity, tradePrice } from "../../testing/decimals.ts";
import { createAccount } from "./accounts.ts";
import { historyStartOf, recomputeBalances } from "./balances.ts";
import { oneByOne } from "./shared.ts";
import { recordTrade } from "./trades.ts";

// Migration 0080 turns the millionths of a quantity and a trade price into
// canonical decimal text. A household's trades are recorded on a database
// migrated whole; the same rows, written back in millionths, are then copied
// into one stopped before 0080, which migrates them: every quantity and price
// must read back the same, and the holdings and balances it stored must be
// what a recompute writes after.

const TIME_ZONE = "Europe/Paris";
const user = { origin: "user" } as const;

let directory: string;
const opened: Database[] = [];

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
	directory = await mkdtemp(join(tmpdir(), "archant-decimals-"));
});

afterEach(async () => {
	vi.useRealTimers();
	for (const db of opened.splice(0)) {
		db.$client.close();
	}
	await rm(directory, { recursive: true, force: true });
});

async function open(name: string) {
	const db = await createDb(`file:${join(directory, name)}`);
	opened.push(db);

	return db;
}

const millionths = (scaled: bigint, unit: bigint) => Number(scaled / unit);

/** A PEA with a buy, a partial sale and a dividend, recorded by today's ledger. */
async function household(db: Database) {
	const deps = { db, timeZone: TIME_ZONE };
	const pea = await createAccount(
		deps,
		{
			name: "PEA",
			type: "investment",
			subtype: "pea",
			currency: "EUR",
			openingBalance: toMinorUnits(2_500_000),
			openingDate: "2026-09-01",
		},
		user,
	);
	const securityId = crypto.randomUUID();
	await db.insert(securities).values({
		id: securityId,
		isin: "FR0000121014",
		ticker: "MC.PA",
		mic: "XPAR",
		name: "LVMH",
		currency: "EUR",
		provider: null,
		createdAt: 0,
		updatedAt: 0,
	});
	const security = { source: "known", id: securityId } as const;
	await recordTrade(
		deps,
		pea.id,
		{
			side: "buy",
			security,
			date: "2026-09-10",
			quantity: quantity("1.5"),
			price: tradePrice("612.4"),
			fee: toMinorUnits(250),
		},
		user,
	);
	await recordTrade(
		deps,
		pea.id,
		{
			side: "sell",
			security,
			date: "2026-09-12",
			quantity: quantity("0.000001"),
			price: tradePrice("650.123456"),
			fee: toMinorUnits(0),
		},
		user,
	);
	await recordTrade(
		deps,
		pea.id,
		{ side: "dividend", security, date: "2026-09-15", amount: toMinorUnits(1234) },
		user,
	);

	return pea;
}

const read = (db: Database) =>
	Promise.all([
		db.select().from(trades).orderBy(asc(trades.entryId)),
		db.select().from(holdings).orderBy(asc(holdings.date), asc(holdings.securityId)),
		db.select().from(balances).orderBy(asc(balances.date)),
	]);

describe("migration 0080", () => {
	it("reads every quantity and price back the same, the stored holdings and balances those a recompute writes", async () => {
		const current = await open("current.db");
		await runMigrations(`file:${join(directory, "current.db")}`);
		const pea = await household(current);
		const [tradeRows, holdingRows, balanceRows] = await read(current);

		const url = `file:${join(directory, "upgraded.db")}`;
		await migrateBefore(url, "0080");
		const before = await open("upgraded.db");
		await before.insert(securities).values(await current.select().from(securities));
		await before.insert(accounts).values(await current.select().from(accounts));
		await before.insert(entries).values(await current.select().from(entries));
		await before.insert(balances).values(balanceRows);
		await oneByOne(tradeRows, async (row) =>
			before.run(
				sql`insert into trades (entry_id, security_id, income_kind, quantity, price, fee) values (${row.entryId}, ${row.securityId}, ${row.incomeKind}, ${millionths(scaledQuantity(row.quantity), 10n ** 12n)}, ${millionths(scaledTradePrice(row.price), 10_000n)}, ${row.fee})`,
			),
		);
		await oneByOne(holdingRows, async (row) =>
			before.run(
				sql`insert into holdings (account_id, security_id, date, quantity, price, amount, cost_basis) values (${row.accountId}, ${row.securityId}, ${row.date}, ${millionths(scaledQuantity(row.quantity), 10n ** 12n)}, ${row.price}, ${row.amount}, ${row.costBasis})`,
			),
		);
		await expect(
			before.all(sql`select typeof(quantity) as kind from holdings group by kind`),
		).resolves.toEqual([{ kind: "integer" }]);

		await runMigrations(url);
		const upgraded = await open("upgraded.db");

		await expect(read(upgraded)).resolves.toEqual([tradeRows, holdingRows, balanceRows]);
		await upgraded.transaction(
			async (tx) =>
				recomputeBalances(tx, pea, await historyStartOf(tx, pea.id, "2026-09-21"), TIME_ZONE),
			{ behavior: "immediate" },
		);
		await expect(read(upgraded)).resolves.toEqual([tradeRows, holdingRows, balanceRows]);
		expect(holdingRows.map((row) => row.quantity)).toContain("1.499999");
	});
});
