import type { TradeInput } from "./trades.ts";

import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { costBasisLocks, holdings } from "@archant/data/schema/holdings";
import { securities, securityPrices } from "@archant/data/schema/securities";

import {
	deps,
	link,
	newBankAccount,
	openChecking,
	openPea,
	setToday,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { deleteAccount } from "./accounts.ts";
import * as ledgerBalances from "./balances.ts";
import { currentHoldings, lockCostBasis, revalueHoldings, unlockCostBasis } from "./holdings.ts";
import { deleteTrade, recordTrade, updateTrade } from "./trades.ts";

/** A buy or a sale, as the helpers below build them. */
type OrderInput = Extract<TradeInput, { side: "buy" | "sell" }>;

useLedgerDatabase();

const user = { origin: "user" } as const;

async function newSecurity(name = "LVMH") {
	const id = crypto.randomUUID();
	await temp.db.insert(securities).values({
		id,
		isin: "FR0000121014",
		ticker: `MC${id.slice(0, 8)}.PA`,
		mic: "XPAR",
		name,
		currency: "EUR",
		provider: "yahoo",
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

/** Story 22.3's d: a buy of 10 at 612.40 € with 2.50 € of fees on 2026-09-10. */
function buy(securityId: string, overrides: Partial<OrderInput> = {}): OrderInput {
	return {
		side: "buy",
		security: { source: "known", id: securityId },
		date: "2026-09-10",
		quantity: toMicros(10_000_000),
		price: toMicros(612_400_000),
		fee: toMinorUnits(250),
		...overrides,
	};
}

const sell = (securityId: string, overrides: Partial<OrderInput> = {}) =>
	buy(securityId, {
		side: "sell",
		price: toMicros(650_000_000),
		fee: toMinorUnits(0),
		...overrides,
	});

async function record(accountId: string, input: TradeInput) {
	return (await recordTrade(deps(), accountId, input, user)).id;
}

/** A provider's close, written as a price import writes it, without revaluing anything. */
async function storePrice(securityId: string, date: string, price: number) {
	await temp.db.insert(securityPrices).values({
		securityId,
		date,
		price: toMicros(price),
		currency: "EUR",
		source: "provider",
	});
}

/** `revalueHoldings` in a transaction of its own, as the price import calls it. */
async function revalue(securityId: string, from: string) {
	await temp.db.transaction(
		async (tx) => revalueHoldings(tx, securityId, from, "Europe/Paris", { origin: "provider" }),
		{ behavior: "immediate" },
	);
}

/** Each holding as `date quantity price amount costBasis`. */
async function holdingsOf(accountId: string) {
	const rows = await temp.db
		.select()
		.from(holdings)
		.where(eq(holdings.accountId, accountId))
		.orderBy(asc(holdings.date), asc(holdings.securityId));

	return rows.map(
		(row) => `${row.date} ${row.quantity} ${row.price} ${row.amount} ${row.costBasis}`,
	);
}

/** One day's stored balance and its cash. */
async function dayOf(accountId: string, date: string) {
	return temp.db
		.select({ balance: balances.balance, cash: balances.cash })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), eq(balances.date, date)))
		.get();
}

describe("holdings in the balance recompute", () => {
	it("values a buy at its own price, and counts it in the balance beside the cash", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();

		await record(pea.id, buy(securityId));

		const rows = await holdingsOf(pea.id);
		expect(rows).toHaveLength(12);
		expect(rows[0]).toBe("2026-09-10 10000000 612400000 612400 612400000");
		expect(rows.at(-1)).toBe("2026-09-21 10000000 612400000 612400 612400000");
		await expect(dayOf(pea.id, "2026-09-09")).resolves.toEqual({
			balance: 2_500_000,
			cash: 2_500_000,
		});
		await expect(dayOf(pea.id, "2026-09-10")).resolves.toEqual({
			balance: 2_499_750,
			cash: 1_887_350,
		});
	});

	it("prefers a price stored for the trade's own day", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await storePrice(securityId, "2026-09-10", 640_000_000);

		await record(pea.id, buy(securityId));

		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-10 10000000 640000000 640000 612400000",
		);
		await expect(dayOf(pea.id, "2026-09-10")).resolves.toEqual({
			balance: 1_887_350 + 640_000,
			cash: 1_887_350,
		});
	});

	it("writes a sold-out security at zero, then starts its cost basis over on a rebuy", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await record(pea.id, sell(securityId, { date: "2026-09-12" }));

		await record(
			pea.id,
			buy(securityId, {
				date: "2026-09-15",
				quantity: toMicros(5_000_000),
				price: toMicros(700_000_000),
				fee: toMinorUnits(0),
			}),
		);

		const rows = await holdingsOf(pea.id);
		expect(rows.slice(2, 6)).toEqual([
			"2026-09-12 0 650000000 0 null",
			"2026-09-13 0 650000000 0 null",
			"2026-09-14 0 650000000 0 null",
			"2026-09-15 5000000 700000000 350000 700000000",
		]);
		await expect(dayOf(pea.id, "2026-09-14")).resolves.toEqual({
			balance: 2_500_000 - 612_650 + 650_000,
			cash: 2_500_000 - 612_650 + 650_000,
		});
	});

	it("lets a snapshot set the total, the cash becoming the total less the holdings", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await storePrice(securityId, "2026-09-11", 650_000_000);
		await revalue(securityId, "2026-09-11");

		await snapshot(pea.id, "2026-09-11", 3_000_000);

		await expect(dayOf(pea.id, "2026-09-11")).resolves.toEqual({
			balance: 3_000_000,
			cash: 2_350_000,
		});
		// The cash goes on from the snapshot, the holdings at their carried price.
		await expect(dayOf(pea.id, "2026-09-12")).resolves.toEqual({
			balance: 3_000_000,
			cash: 2_350_000,
		});
	});

	it("leaves an account without a trade as it was: no holding, the cash its balance", async () => {
		const pea = await openPea();

		await snapshot(pea.id, "2026-09-11", 2_600_000);

		await expect(holdingsOf(pea.id)).resolves.toEqual([]);
		await expect(dayOf(pea.id, "2026-09-10")).resolves.toEqual({
			balance: 2_500_000,
			cash: 2_500_000,
		});
		await expect(dayOf(pea.id, "2026-09-21")).resolves.toEqual({
			balance: 2_600_000,
			cash: 2_600_000,
		});
	});

	it("rewrites the holdings from the earliest day a write touched, the days before it kept", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId, { date: "2026-09-05" }));
		// A mark on a day before the next write: a rewrite would replace it.
		await temp.db
			.update(holdings)
			.set({ price: toMicros(1) })
			.where(and(eq(holdings.accountId, pea.id), eq(holdings.date, "2026-09-06")));

		const id = await record(pea.id, buy(securityId, { date: "2026-09-10" }));

		const rows = await holdingsOf(pea.id);
		expect(rows[1]).toBe("2026-09-06 10000000 1 612400 612400000");
		expect(rows[5]).toBe("2026-09-10 20000000 612400000 1224800 612400000");

		await updateTrade(deps(), id, { date: "2026-09-08" }, user);
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-08 20000000 612400000 1224800 612400000",
		);
		await deleteTrade(deps(), id, user);
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-08 10000000 612400000 612400 612400000",
		);
	});

	it("deletes the rows past the last balance day, as the balances", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));

		setToday("2026-09-15T10:00:00Z");
		await snapshot(pea.id, "2026-09-12", 2_600_000);

		const rows = await holdingsOf(pea.id);
		expect(rows.at(-1)).toMatch(/^2026-09-15 /u);
	});

	it("drops the holdings of an account computed backward from a bank balance", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		const bank = await newBankAccount();

		await link(pea.id, bank.id, 2_400_000);

		await expect(holdingsOf(pea.id)).resolves.toEqual([]);
		await expect(dayOf(pea.id, "2026-09-21")).resolves.toEqual({
			balance: 2_400_000,
			cash: 2_400_000,
		});
	});

	it("go with their account", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));

		await deleteAccount(deps(), pea.id, user);

		await expect(holdingsOf(pea.id)).resolves.toEqual([]);
	});
});

describe("revalueHoldings", () => {
	it("values the holdings at an imported price, carried over the days without one", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await storePrice(securityId, "2026-09-11", 650_000_000);

		await revalue(securityId, "2026-09-11");

		const rows = await holdingsOf(pea.id);
		expect(rows.slice(0, 3)).toEqual([
			"2026-09-10 10000000 612400000 612400 612400000",
			"2026-09-11 10000000 650000000 650000 612400000",
			"2026-09-12 10000000 650000000 650000 612400000",
		]);
		await expect(dayOf(pea.id, "2026-09-11")).resolves.toEqual({
			balance: 2_537_350,
			cash: 1_887_350,
		});

		// A later import starts from the price stored before it.
		await storePrice(securityId, "2026-09-14", 660_000_000);
		await revalue(securityId, "2026-09-14");
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-13 10000000 650000000 650000 612400000",
		);
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-15 10000000 660000000 660000 612400000",
		);
	});

	it("starts a later write from the last price stored before it", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await storePrice(securityId, "2026-09-11", 640_000_000);
		await storePrice(securityId, "2026-09-12", 650_000_000);
		await revalue(securityId, "2026-09-11");

		// No price from 2026-09-14 on: the recompute reads the latest one before it.
		await snapshot(pea.id, "2026-09-14", 2_600_000);

		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-14 10000000 650000000 650000 612400000",
		);
		await expect(dayOf(pea.id, "2026-09-14")).resolves.toEqual({
			balance: 2_600_000,
			cash: 2_600_000 - 650_000,
		});
	});

	it("recomputes each holder from the later of the prices' day and its first trade, and no one else", async () => {
		const early = await openPea();
		const late = await openPea({ name: "Compte-titres", subtype: "brokerage" });
		const other = await openPea({ name: "Assurance vie", subtype: "assurance_vie" });
		const checking = await openChecking();
		const securityId = await newSecurity();
		const otherSecurity = await newSecurity();
		await record(early.id, buy(securityId, { date: "2026-09-03" }));
		await record(late.id, buy(securityId, { date: "2026-09-12" }));
		await record(other.id, buy(otherSecurity));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await revalue(securityId, "2026-09-08");

		const calls = recompute.mock.calls.map(([, account, from]) => [account.id, from]);
		expect(calls).toHaveLength(2);
		expect(calls).toEqual(
			expect.arrayContaining([
				[early.id, "2026-09-08"],
				[late.id, "2026-09-12"],
			]),
		);
		expect(calls.flat()).not.toContain(other.id);
		expect(calls.flat()).not.toContain(checking.id);
	});

	it("does nothing for a security no account traded", async () => {
		const securityId = await newSecurity();
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await revalue(securityId, "2026-09-08");

		expect(recompute).not.toHaveBeenCalled();
	});
});

const lock = (accountId: string, securityId: string, costBasis: number) =>
	lockCostBasis(deps(), accountId, securityId, toMicros(costBasis), user);

describe("currentHoldings", () => {
	it("reads each security held on the last holdings day by value, its price's day, and the cash", async () => {
		const pea = await openPea();
		const lvmh = await newSecurity();
		const fund = await newSecurity("Fonds euros");
		await record(pea.id, buy(lvmh));
		await storePrice(lvmh, "2026-09-11", 650_000_000);
		await revalue(lvmh, "2026-09-11");
		// Priced from its trade alone: no stored price.
		await record(
			pea.id,
			buy(fund, {
				date: "2026-09-12",
				quantity: toMicros(5_000_000),
				price: toMicros(100_000_000),
				fee: toMinorUnits(0),
			}),
		);

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toEqual({
			date: "2026-09-21",
			cash: 1_837_350,
			holdings: [
				{
					security: {
						id: lvmh,
						name: "LVMH",
						ticker: `MC${lvmh.slice(0, 8)}.PA`,
						mic: "XPAR",
						isin: "FR0000121014",
						provider: "yahoo",
						offline: false,
					},
					quantity: 10_000_000,
					price: 650_000_000,
					amount: 650_000,
					costBasis: 612_400_000,
					costBasisLocked: false,
					priceDate: "2026-09-11",
				},
				{
					security: {
						id: fund,
						name: "Fonds euros",
						ticker: `MC${fund.slice(0, 8)}.PA`,
						mic: "XPAR",
						isin: "FR0000121014",
						provider: "yahoo",
						offline: false,
					},
					quantity: 5_000_000,
					price: 100_000_000,
					amount: 50_000,
					costBasis: 100_000_000,
					costBasisLocked: false,
					priceDate: "2026-09-12",
				},
			],
		});
	});

	it("orders lines of the same value by name, and reads a past day without what came after", async () => {
		const pea = await openPea();
		const zinc = await newSecurity("Zinc");
		const acier = await newSecurity("Acier");
		await record(pea.id, buy(zinc));
		await record(pea.id, buy(acier));
		await storePrice(zinc, "2026-09-14", 700_000_000);
		await revalue(zinc, "2026-09-14");

		const past = await currentHoldings(temp.db, pea.id, "2026-09-11");

		expect(past.date).toBe("2026-09-11");
		expect(past.holdings.map((row) => [row.security.name, row.amount, row.priceDate])).toEqual([
			["Acier", 612_400, "2026-09-10"],
			["Zinc", 612_400, "2026-09-10"],
		]);
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [
				{ security: { name: "Zinc" }, priceDate: "2026-09-14" },
				{ security: { name: "Acier" } },
			],
		});
	});

	it("dates the price by a trade later than the last stored price", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await storePrice(securityId, "2026-09-11", 650_000_000);
		await revalue(securityId, "2026-09-11");
		await record(pea.id, buy(securityId, { date: "2026-09-15", price: toMicros(700_000_000) }));

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ price: 700_000_000, priceDate: "2026-09-15" }],
		});
	});

	it("never dates the price by a dividend, which sets none", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await record(pea.id, {
			side: "dividend",
			security: { source: "known", id: securityId },
			date: "2026-09-15",
			amount: toMinorUnits(1234),
		});

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ price: 612_400_000, priceDate: "2026-09-10" }],
		});
	});

	it("leaves a sold-out security out", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await record(pea.id, sell(securityId, { date: "2026-09-12" }));

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toEqual({
			date: "2026-09-21",
			holdings: [],
			cash: 2_500_000 - 612_650 + 650_000,
		});
	});

	it("answers an account that never traded with no day and its balance as cash, zero before it opened", async () => {
		const pea = await openPea();
		await snapshot(pea.id, "2026-09-11", 2_600_000);

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toEqual({
			date: null,
			holdings: [],
			cash: 2_600_000,
		});
		await expect(currentHoldings(temp.db, pea.id, "2026-08-31")).resolves.toEqual({
			date: null,
			holdings: [],
			cash: 0,
		});
	});
});

describe("lockCostBasis and unlockCostBasis", () => {
	it("lock a cost basis every reader takes, the holdings and balances untouched, and unlock it", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		const rows = await holdingsOf(pea.id);
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await lock(pea.id, securityId, 600_000_000);
		await lock(pea.id, securityId, 590_000_000);

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ costBasis: 590_000_000, costBasisLocked: true }],
		});
		await expect(holdingsOf(pea.id)).resolves.toEqual(rows);
		expect(recompute).not.toHaveBeenCalled();

		await unlockCostBasis(deps(), pea.id, securityId, user);

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ costBasis: 612_400_000, costBasisLocked: false }],
		});
		expect(recompute).not.toHaveBeenCalled();
		// Unlocking what is not locked changes nothing.
		await expect(unlockCostBasis(deps(), pea.id, securityId, user)).resolves.toBeUndefined();
	});

	it("keep the lock through a trade or a price that recomputes the account", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await lock(pea.id, securityId, 400_000_000);

		await record(pea.id, buy(securityId, { date: "2026-09-15", price: toMicros(700_000_000) }));
		await storePrice(securityId, "2026-09-16", 710_000_000);
		await revalue(securityId, "2026-09-16");

		const [position] = (await currentHoldings(temp.db, pea.id, "2026-09-21")).holdings;
		expect(position).toMatchObject({
			quantity: 20_000_000,
			costBasis: 400_000_000,
			costBasisLocked: true,
		});
		// The holdings still carry the calculated one.
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-21 20000000 710000000 1420000 656200000",
		);
	});

	it("end with a full sale, so a rebuy starts from its own buys, a partial sale keeping it", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const other = await newSecurity("Air Liquide");
		await record(pea.id, buy(securityId));
		await record(pea.id, buy(other));
		setToday("2026-09-15T10:00:00Z");
		await lock(pea.id, securityId, 400_000_000);
		await lock(pea.id, other, 500_000_000);
		// A sale and a rebuy on one day keep the position, held at the day's end.
		await record(pea.id, sell(securityId, { date: "2026-09-15" }));
		await record(pea.id, buy(securityId, { date: "2026-09-15" }));
		setToday("2026-09-21T10:00:00Z");

		await record(pea.id, sell(other, { date: "2026-09-16", quantity: toMicros(4_000_000) }));
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ costBasisLocked: true }, { costBasisLocked: true }],
		});

		await record(pea.id, sell(securityId, { date: "2026-09-16" }));
		await record(pea.id, buy(securityId, { date: "2026-09-18", price: toMicros(700_000_000) }));

		const held = (await currentHoldings(temp.db, pea.id, "2026-09-21")).holdings;
		expect(held.find((holding) => holding.security.id === securityId)).toMatchObject({
			costBasis: 700_000_000,
			costBasisLocked: false,
		});
		expect(held.find((holding) => holding.security.id === other)).toMatchObject({
			costBasis: 500_000_000,
			costBasisLocked: true,
		});
		// Locked again, it stands on the new position.
		await lock(pea.id, securityId, 650_000_000);
		const relocked = (await currentHoldings(temp.db, pea.id, "2026-09-21")).holdings;
		expect(relocked.find((holding) => holding.security.id === securityId)).toMatchObject({
			costBasis: 650_000_000,
			costBasisLocked: true,
		});
	});

	it("refuse a cost basis whose book value no balance could hold", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		// A thousand units at a cost basis of a billion euros each.
		await record(
			pea.id,
			buy(securityId, { quantity: toMicros(1_000_000_000), price: toMicros(1_000_000) }),
		);

		await expect(lock(pea.id, securityId, 1_000_000_000_000_000)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "costBasis", code: "too_big" }],
		});
	});

	it("refuse an account that holds none of the security today", async () => {
		const pea = await openPea();
		const traded = await newSecurity();
		const never = await newSecurity();
		const fresh = await openPea();
		const checking = await openChecking();
		await record(pea.id, buy(traded));
		await record(pea.id, sell(traded, { date: "2026-09-12" }));

		await expect(lock(pea.id, traded, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(pea.id, never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(fresh.id, never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock("nope", never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(checking.id, never, 1)).rejects.toMatchObject({
			code: "NOT_AN_INVESTMENT_ACCOUNT",
		});
		await expect(unlockCostBasis(deps(), pea.id, traded, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			temp.db.select().from(costBasisLocks).where(eq(costBasisLocks.accountId, pea.id)),
		).resolves.toEqual([]);
	});

	it("go with their account", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await lock(pea.id, securityId, 1);

		await deleteAccount(deps(), pea.id, user);

		await expect(
			temp.db.select().from(costBasisLocks).where(eq(costBasisLocks.accountId, pea.id)),
		).resolves.toEqual([]);
	});
});
