import type { TradeInput } from "./trades.ts";

import { and, asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { costBasisLocks, holdings } from "@archant/data/schema/holdings";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";
import { trades } from "@archant/data/schema/trades";

import { quantity as qty, tradePrice } from "../../testing/decimals.ts";
import {
	add,
	deps,
	excludedOf,
	link,
	lockTimes,
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
import {
	currentHoldings,
	deletePosition,
	lastHeldHoldings,
	liveCostBasisLocks,
	lockCostBasis,
	recomputeFeeCostBases,
	remapPosition,
	revalueHoldings,
	unlockCostBasis,
} from "./holdings.ts";
import { convertTransaction, deleteTrade, recordTrade, updateTrade } from "./trades.ts";

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
		quantity: qty("10"),
		price: tradePrice("612.4"),
		fee: toMinorUnits(250),
		...overrides,
	};
}

const sell = (securityId: string, overrides: Partial<OrderInput> = {}) =>
	buy(securityId, {
		side: "sell",
		price: tradePrice("650"),
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
		expect(rows[0]).toBe("2026-09-10 10 612400000 612400 612650000");
		expect(rows.at(-1)).toBe("2026-09-21 10 612400000 612400 612650000");
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

		await expect(holdingsOf(pea.id)).resolves.toContain("2026-09-10 10 640000000 640000 612650000");
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
				quantity: qty("5"),
				price: tradePrice("700"),
				fee: toMinorUnits(0),
			}),
		);

		const rows = await holdingsOf(pea.id);
		expect(rows.slice(2, 6)).toEqual([
			"2026-09-12 0 650000000 0 null",
			"2026-09-13 0 650000000 0 null",
			"2026-09-14 0 650000000 0 null",
			"2026-09-15 5 700000000 350000 700000000",
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
		expect(rows[1]).toBe("2026-09-06 10 1 612400 612650000");
		expect(rows[5]).toBe("2026-09-10 20 612400000 1224800 612650000");

		await updateTrade(deps(), id, { date: "2026-09-08" }, user);
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-08 20 612400000 1224800 612650000",
		);
		await deleteTrade(deps(), id, user);
		await expect(holdingsOf(pea.id)).resolves.toContain("2026-09-08 10 612400000 612400 612650000");
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

describe("recomputeFeeCostBases", () => {
	it("rolls its claim back with a failed recompute, so the next start tries again", async () => {
		const pea = await openPea();
		await record(pea.id, buy(await newSecurity()));
		vi.spyOn(ledgerBalances, "recomputeBalances").mockRejectedValueOnce(new Error("disk full"));

		await expect(recomputeFeeCostBases(deps())).rejects.toThrow("disk full");

		await expect(
			temp.db.select().from(settings).where(eq(settings.key, "fee_cost_basis_recomputed_at")).get(),
		).resolves.toBeUndefined();
	});

	it("puts each buy's fee in a stored cost basis once, every balance left as it was", async () => {
		const pea = await openPea();
		const checking = await openChecking();
		const wallet = await openPea({ name: "Crypto", type: "crypto", subtype: "wallet" });
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		// As a release before Story 27.5 stored it: the fee out.
		await temp.db
			.update(holdings)
			.set({ costBasis: toMicros(612_400_000) })
			.where(eq(holdings.accountId, pea.id));
		// This account's alone: another test's account ends on an earlier
		// today, which the recompute extends.
		const balancesOf = () =>
			temp.db
				.select()
				.from(balances)
				.where(eq(balances.accountId, pea.id))
				.orderBy(asc(balances.date));
		const before = await balancesOf();
		// The file's other tests opened investment accounts too, all recomputed,
		// and a crypto account holds securities as one does.
		const investments = await temp.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(inArray(accounts.type, ["investment", "crypto"]));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await expect(recomputeFeeCostBases(deps())).resolves.toBe(investments.length);

		const calls = recompute.mock.calls.map(([, account, from]) => [account.id, from]);
		expect(calls).toHaveLength(investments.length);
		expect(calls).toContainEqual([pea.id, "2026-09-01"]);
		expect(calls.flat()).toContain(wallet.id);
		expect(calls.flat()).not.toContain(checking.id);
		const rows = await holdingsOf(pea.id);
		expect(rows).toHaveLength(12);
		expect(rows.every((row) => row.endsWith(" 612650000"))).toBe(true);
		await expect(balancesOf()).resolves.toEqual(before);

		// Claimed: a second start recomputes nothing.
		await expect(recomputeFeeCostBases(deps())).resolves.toBe(0);
		expect(recompute).toHaveBeenCalledTimes(investments.length);
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
			"2026-09-10 10 612400000 612400 612650000",
			"2026-09-11 10 650000000 650000 612650000",
			"2026-09-12 10 650000000 650000 612650000",
		]);
		await expect(dayOf(pea.id, "2026-09-11")).resolves.toEqual({
			balance: 2_537_350,
			cash: 1_887_350,
		});

		// A later import starts from the price stored before it.
		await storePrice(securityId, "2026-09-14", 660_000_000);
		await revalue(securityId, "2026-09-14");
		await expect(holdingsOf(pea.id)).resolves.toContain("2026-09-13 10 650000000 650000 612650000");
		await expect(holdingsOf(pea.id)).resolves.toContain("2026-09-15 10 660000000 660000 612650000");
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

		await expect(holdingsOf(pea.id)).resolves.toContain("2026-09-14 10 650000000 650000 612650000");
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
				quantity: qty("5"),
				price: tradePrice("100"),
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
					quantity: "10",
					price: 650_000_000,
					amount: 650_000,
					costBasis: 612_650_000,
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
					quantity: "5",
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
		await record(pea.id, buy(securityId, { date: "2026-09-15", price: tradePrice("700") }));

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

	it("lists a position below zero by its negative value, after those above, as Sure's `qty <> 0`", async () => {
		const pea = await openPea();
		const held = await newSecurity("Détenu");
		const short = await newSecurity("Vendu à découvert");
		await record(pea.id, buy(held));
		await record(pea.id, buy(short));
		await record(pea.id, sell(short, { date: "2026-09-12", quantity: qty("15") }));

		const { holdings: rows } = await currentHoldings(temp.db, pea.id, "2026-09-21");

		expect(
			rows.map(({ security, quantity, amount, costBasis }) => [
				security.name,
				quantity,
				amount,
				costBasis,
			]),
		).toEqual([
			["Détenu", "10", 612_400, 612_650_000],
			["Vendu à découvert", "-5", -325_000, null],
		]);
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

describe("lastHeldHoldings", () => {
	it("reads each security's last day held, a sold-out one at its last quantity, with the cost basis standing that day", async () => {
		const pea = await openPea();
		const other = await openPea();
		const soldOut = await newSecurity("Vendu");
		const rebought = await newSecurity("Racheté");
		const lockedThenSold = await newSecurity("Verrou puis vente");
		const lockEnded = await newSecurity("Verrou levé");
		await record(pea.id, buy(soldOut));
		await record(pea.id, buy(rebought));
		await record(pea.id, buy(lockedThenSold));
		await record(pea.id, buy(lockEnded));
		await record(other.id, buy(soldOut));
		await record(pea.id, sell(soldOut, { date: "2026-09-12" }));
		await record(pea.id, sell(rebought, { date: "2026-09-12" }));
		await record(pea.id, buy(rebought, { date: "2026-09-14", price: tradePrice("700") }));
		setToday("2026-09-15T10:00:00Z");
		await lock(pea.id, lockedThenSold, 400_000_000);
		await lock(pea.id, lockEnded, 450_000_000);
		setToday("2026-09-21T10:00:00Z");
		await record(pea.id, sell(lockedThenSold, { date: "2026-09-16" }));
		await record(pea.id, sell(lockEnded, { date: "2026-09-16" }));
		await record(pea.id, buy(lockEnded, { date: "2026-09-18", price: tradePrice("700") }));
		// Locked after a full sale: it stands on the position bought back.
		await lock(pea.id, rebought, 650_000_000);

		const held = await lastHeldHoldings(temp.db, [pea.id], "2026-09-21");

		expect(
			held
				.map(({ accountId, security, date, quantity, amount, costBasis }) => ({
					accountId,
					name: security.name,
					date,
					quantity,
					amount,
					costBasis,
				}))
				.toSorted((a, b) => a.name.localeCompare(b.name)),
		).toEqual([
			{
				accountId: pea.id,
				name: "Racheté",
				date: "2026-09-21",
				quantity: "10",
				amount: 700_000,
				costBasis: 650_000_000,
			},
			{
				accountId: pea.id,
				name: "Vendu",
				date: "2026-09-11",
				quantity: "10",
				amount: 612_400,
				costBasis: 612_650_000,
			},
			// A full sale after the lock's day ended it: the rebuy is priced from its own buy.
			{
				accountId: pea.id,
				name: "Verrou levé",
				date: "2026-09-21",
				quantity: "10",
				amount: 700_000,
				costBasis: 700_250_000,
			},
			// The lock stood on its last day held: the sale came after it.
			{
				accountId: pea.id,
				name: "Verrou puis vente",
				date: "2026-09-15",
				quantity: "10",
				amount: 612_400,
				costBasis: 400_000_000,
			},
		]);
		await expect(lastHeldHoldings(temp.db, [pea.id], "2026-09-09")).resolves.toEqual([]);
	});

	it("reads a position below zero at its last quantity, which is not zero", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await record(pea.id, sell(securityId, { date: "2026-09-12", quantity: qty("15") }));

		await expect(lastHeldHoldings(temp.db, [pea.id], "2026-09-21")).resolves.toMatchObject([
			{ date: "2026-09-21", quantity: "-5", amount: -325_000, costBasis: null },
		]);
		await expect(lastHeldHoldings(temp.db, [], "2026-09-21")).resolves.toEqual([]);
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
			holdings: [{ costBasis: 612_650_000, costBasisLocked: false }],
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

		await record(pea.id, buy(securityId, { date: "2026-09-15", price: tradePrice("700") }));
		await storePrice(securityId, "2026-09-16", 710_000_000);
		await revalue(securityId, "2026-09-16");

		const [position] = (await currentHoldings(temp.db, pea.id, "2026-09-21")).holdings;
		expect(position).toMatchObject({
			quantity: "20",
			costBasis: 400_000_000,
			costBasisLocked: true,
		});
		// The holdings still carry the calculated one.
		await expect(holdingsOf(pea.id)).resolves.toContain(
			"2026-09-21 20 710000000 1420000 656450000",
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

		await record(pea.id, sell(other, { date: "2026-09-16", quantity: qty("4") }));
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ costBasisLocked: true }, { costBasisLocked: true }],
		});

		await record(pea.id, sell(securityId, { date: "2026-09-16" }));
		await record(pea.id, buy(securityId, { date: "2026-09-18", price: tradePrice("700") }));

		const held = (await currentHoldings(temp.db, pea.id, "2026-09-21")).holdings;
		expect(held.find((holding) => holding.security.id === securityId)).toMatchObject({
			costBasis: 700_250_000,
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

	it("end with a sale that crosses zero, so the rebuy reads its calculated cost basis", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		setToday("2026-09-15T10:00:00Z");
		await lock(pea.id, securityId, 400_000_000);
		setToday("2026-09-21T10:00:00Z");

		await record(pea.id, sell(securityId, { date: "2026-09-16", quantity: qty("15") }));
		await record(
			pea.id,
			buy(securityId, {
				date: "2026-09-18",
				quantity: qty("8"),
				price: tradePrice("700"),
			}),
		);

		// 8 at 700 € and 2.50 € of fees, the tracker emptied by the sale.
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ quantity: "3", costBasis: 700_312_500, costBasisLocked: false }],
		});
		await expect(liveCostBasisLocks(temp.db, pea.id)).resolves.toEqual([]);
		await expect(lastHeldHoldings(temp.db, [pea.id], "2026-09-21")).resolves.toMatchObject([
			{ quantity: "3", costBasis: 700_312_500 },
		]);
	});

	it("refuse a cost basis whose book value no balance could hold", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		// A thousand units at a cost basis of a billion euros each.
		await record(pea.id, buy(securityId, { quantity: qty("1000"), price: tradePrice("1") }));

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
		const short = await newSecurity();
		await record(pea.id, buy(short));
		await record(pea.id, sell(short, { date: "2026-09-12", quantity: qty("15") }));

		await expect(lock(pea.id, traded, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		// Sure's `HoldingsController#update` checks `qty.positive?`.
		await expect(lock(pea.id, short, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(pea.id, never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(fresh.id, never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock("nope", never, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(lock(checking.id, never, 1)).rejects.toMatchObject({
			code: "TRADES_NOT_SUPPORTED",
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

/** Each trade on the account as `date securityId quantity`, oldest first. */
async function tradesOf(accountId: string) {
	const rows = await temp.db
		.select({ date: entries.date, securityId: trades.securityId, quantity: trades.quantity })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(eq(entries.accountId, accountId))
		.orderBy(asc(entries.date), asc(trades.quantity));

	return rows.map((row) => `${row.date} ${row.securityId} ${row.quantity}`);
}

/** The securities the account holds a row of on any day. */
async function heldSecurities(accountId: string) {
	const rows = await temp.db
		.selectDistinct({ securityId: holdings.securityId })
		.from(holdings)
		.where(eq(holdings.accountId, accountId));

	return rows.map((row) => row.securityId).toSorted();
}

async function locksOf(accountId: string) {
	return temp.db
		.select({ securityId: costBasisLocks.securityId, costBasis: costBasisLocks.costBasis })
		.from(costBasisLocks)
		.where(eq(costBasisLocks.accountId, accountId));
}

const dividendOf = (securityId: string): TradeInput => ({
	side: "dividend",
	security: { source: "known", id: securityId },
	date: "2026-09-15",
	amount: toMinorUnits(1234),
});

const remap = (
	accountId: string,
	securityId: string,
	choice: Parameters<typeof remapPosition>[3],
) => remapPosition(deps(), accountId, securityId, choice);

/** A transaction of the PEA converted into a buy of `securityId`. */
async function converted(accountId: string, securityId: string) {
	const source = await add(accountId, { date: "2026-09-10", amount: toMinorUnits(-612_650) });
	await convertTransaction(
		deps(),
		source,
		{
			side: "buy",
			security: { source: "known", id: securityId },
			quantity: qty("10"),
			price: tradePrice("612.4"),
		},
		user,
	);

	return source;
}

describe("deletePosition", () => {
	it("deletes every trade of the security, dividends too, and recomputes once", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const other = await newSecurity("Air Liquide");
		await record(pea.id, buy(securityId));
		await record(pea.id, buy(securityId, { date: "2026-09-12" }));
		await record(pea.id, sell(securityId, { date: "2026-09-14", quantity: qty("5") }));
		await record(pea.id, dividendOf(securityId));
		await record(pea.id, buy(other, { date: "2026-09-11" }));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await deletePosition(deps(), pea.id, securityId, user);

		expect(recompute).toHaveBeenCalledTimes(1);
		await expect(tradesOf(pea.id)).resolves.toEqual([`2026-09-11 ${other} 10`]);
		await expect(heldSecurities(pea.id)).resolves.toEqual([other]);
		// The opening 25 000 € less the other buy, at 612.40 € and 2.50 € of fees.
		await expect(dayOf(pea.id, "2026-09-21")).resolves.toEqual({
			balance: 2_499_750,
			cash: 1_887_350,
		});
		await expect(
			temp.db
				.select({ count: entries.id })
				.from(entries)
				.where(and(eq(entries.accountId, pea.id), eq(entries.kind, "trade"))),
		).resolves.toHaveLength(1);
		// The security stays, as history.
		await expect(
			temp.db.select().from(securities).where(eq(securities.id, securityId)),
		).resolves.toHaveLength(1);
	});

	it("deletes a short position too", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, sell(securityId));

		await deletePosition(deps(), pea.id, securityId, user);

		await expect(tradesOf(pea.id)).resolves.toEqual([]);
		await expect(heldSecurities(pea.id)).resolves.toEqual([]);
	});

	it("brings back a converted trade's transaction, its exclusion locked", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const source = await converted(pea.id, securityId);
		const locks = await lockTimes(source);
		setToday("2026-09-21T11:00:00Z");

		await deletePosition(deps(), pea.id, securityId, user);

		await expect(excludedOf(source)).resolves.toBe(false);
		await expect(lockTimes(source)).resolves.toEqual({
			...locks,
			excluded: Date.parse("2026-09-21T11:00:00Z"),
		});
		await expect(tradesOf(pea.id)).resolves.toEqual([]);
		// The transaction counts again.
		await expect(dayOf(pea.id, "2026-09-21")).resolves.toMatchObject({ balance: 1_887_350 });
	});

	it("locks nothing for another origin", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const source = await converted(pea.id, securityId);
		const locks = await lockTimes(source);
		setToday("2026-09-21T11:00:00Z");

		await deletePosition(deps(), pea.id, securityId, { origin: "maintenance" });

		await expect(excludedOf(source)).resolves.toBe(false);
		await expect(lockTimes(source)).resolves.toEqual(locks);
	});

	it("drops the position's lock, so a later buy reads its calculated cost basis", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await lock(pea.id, securityId, 400_000_000);

		await deletePosition(deps(), pea.id, securityId, user);

		await expect(locksOf(pea.id)).resolves.toEqual([]);
		await record(pea.id, buy(securityId, { date: "2026-09-15" }));
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ costBasis: 612_650_000, costBasisLocked: false }],
		});
	});

	it("refuses a security the account never traded, and an account that is not an investment one", async () => {
		const pea = await openPea();
		const elsewhere = await openPea();
		const checking = await openChecking();
		const securityId = await newSecurity();
		await record(elsewhere.id, buy(securityId));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await expect(deletePosition(deps(), pea.id, securityId, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(deletePosition(deps(), "nope", securityId, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(deletePosition(deps(), checking.id, securityId, user)).rejects.toMatchObject({
			code: "TRADES_NOT_SUPPORTED",
		});
		expect(recompute).not.toHaveBeenCalled();
		await expect(tradesOf(elsewhere.id)).resolves.toHaveLength(1);
	});
});

describe("remapPosition", () => {
	it("moves every trade to a listing not stored yet, written in the same transaction", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		await record(pea.id, dividendOf(securityId));
		const ticker = `ai${crypto.randomUUID().slice(0, 8)}.pa`;

		const { securityId: target } = await remap(pea.id, securityId, {
			source: "listing",
			ticker,
			mic: "XPAR",
			name: "Air Liquide",
			currency: "EUR",
			provider: "yahoo",
		});

		expect(target).not.toBe(securityId);
		await expect(
			temp.db.select().from(securities).where(eq(securities.id, target)).get(),
		).resolves.toMatchObject({
			ticker: ticker.toUpperCase(),
			name: "Air Liquide",
			provider: "yahoo",
		});
		await expect(tradesOf(pea.id)).resolves.toEqual([
			`2026-09-10 ${target} 10`,
			`2026-09-15 ${target} 0`,
		]);
		await expect(heldSecurities(pea.id)).resolves.toEqual([target]);
		// The old security stays, as history.
		await expect(
			temp.db.select().from(securities).where(eq(securities.id, securityId)),
		).resolves.toHaveLength(1);
	});

	it("merges into a position the account holds, its cost basis from every buy", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		await record(pea.id, buy(target, { date: "2026-09-14", quantity: qty("5") }));
		await record(pea.id, buy(securityId));
		const before = await dayOf(pea.id, "2026-09-21");
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await remap(pea.id, securityId, { source: "known", id: target });

		// Recomputed once, from the earlier of the two first trades.
		expect(recompute).toHaveBeenCalledTimes(1);
		expect(recompute.mock.calls[0]?.[2]).toBe("2026-09-10");
		// 15 bought for 9 186 € and 5 € of fees.
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ security: { id: target }, quantity: "15", costBasis: 612_733_333 }],
		});
		await expect(heldSecurities(pea.id)).resolves.toEqual([target]);
		await expect(dayOf(pea.id, "2026-09-21")).resolves.toEqual(before);
	});

	it("moves a lock to a security with none, and drops it beside one", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		const locked = await newSecurity("Danone");
		await record(pea.id, buy(securityId));
		await record(pea.id, buy(target));
		await record(pea.id, buy(locked));
		await lock(pea.id, securityId, 400_000_000);
		await lock(pea.id, locked, 500_000_000);

		await remap(pea.id, securityId, { source: "known", id: target });

		await expect(locksOf(pea.id)).resolves.toEqual(
			expect.arrayContaining([
				{ securityId: target, costBasis: 400_000_000 },
				{ securityId: locked, costBasis: 500_000_000 },
			]),
		);
		await expect(locksOf(pea.id)).resolves.toHaveLength(2);

		await remap(pea.id, target, { source: "known", id: locked });

		await expect(locksOf(pea.id)).resolves.toEqual([
			{ securityId: locked, costBasis: 500_000_000 },
		]);
	});

	it("deletes a lock a full sale ended rather than move it onto a history that never reaches zero", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		await record(pea.id, buy(securityId));
		await record(pea.id, buy(target, { quantity: qty("5") }));
		setToday("2026-09-15T10:00:00Z");
		await lock(pea.id, securityId, 400_000_000);
		setToday("2026-09-21T10:00:00Z");
		await record(pea.id, sell(securityId, { date: "2026-09-16" }));
		await record(pea.id, buy(securityId, { date: "2026-09-18" }));

		await remap(pea.id, securityId, { source: "known", id: target });

		await expect(locksOf(pea.id)).resolves.toEqual([]);
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ security: { id: target }, quantity: "15", costBasisLocked: false }],
		});
	});

	it("moves a live lock onto a security whose own lock a full sale ended", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		await record(pea.id, buy(securityId));
		await record(pea.id, buy(target));
		setToday("2026-09-15T10:00:00Z");
		await lock(pea.id, target, 500_000_000);
		await lock(pea.id, securityId, 400_000_000);
		setToday("2026-09-21T10:00:00Z");
		await record(pea.id, sell(target, { date: "2026-09-16" }));
		await record(pea.id, buy(target, { date: "2026-09-18" }));

		await remap(pea.id, securityId, { source: "known", id: target });

		await expect(locksOf(pea.id)).resolves.toEqual([
			{ securityId: target, costBasis: 400_000_000 },
		]);
		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ security: { id: target }, costBasis: 400_000_000, costBasisLocked: true }],
		});
	});

	it("remaps a short position", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		await record(pea.id, sell(securityId));

		await remap(pea.id, securityId, { source: "known", id: target });

		await expect(currentHoldings(temp.db, pea.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ security: { id: target }, quantity: "-10" }],
		});
		await expect(heldSecurities(pea.id)).resolves.toEqual([target]);
	});

	it("recomputes from the target's first trade when it is the earlier", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity("Air Liquide");
		await record(pea.id, buy(target, { date: "2026-09-05", quantity: qty("5") }));
		await record(pea.id, buy(securityId));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await remap(pea.id, securityId, { source: "known", id: target });

		expect(recompute.mock.calls[0]?.[2]).toBe("2026-09-05");
		const rows = await holdingsOf(pea.id);
		expect(rows[0]).toBe("2026-09-05 5 612400000 306200 612900000");
		expect(rows).toContain("2026-09-09 5 612400000 306200 612900000");
		expect(rows).toContain("2026-09-10 15 612400000 918600 612733333");
		expect(rows.at(-1)).toBe("2026-09-21 15 612400000 918600 612733333");
	});

	it("writes nothing for the same security", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));
		const recompute = vi.spyOn(ledgerBalances, "recomputeBalances");

		await expect(remap(pea.id, securityId, { source: "known", id: securityId })).resolves.toEqual({
			securityId,
		});

		expect(recompute).not.toHaveBeenCalled();
		await expect(tradesOf(pea.id)).resolves.toEqual([`2026-09-10 ${securityId} 10`]);
	});

	it("refuses a security in another currency, and writes nothing", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const dollars = await newSecurity("Apple");
		await temp.db.update(securities).set({ currency: "USD" }).where(eq(securities.id, dollars));
		await record(pea.id, buy(securityId));
		const ticker = `AAPL${crypto.randomUUID().slice(0, 8)}`;

		await expect(remap(pea.id, securityId, { source: "known", id: dollars })).rejects.toMatchObject(
			{
				code: "VALIDATION_ERROR",
				fields: [{ path: "security", code: "currency_mismatch" }],
			},
		);
		await expect(
			remap(pea.id, securityId, {
				source: "listing",
				ticker,
				mic: "XNAS",
				name: "Apple",
				currency: "USD",
				provider: "yahoo",
			}),
		).rejects.toMatchObject({ fields: [{ path: "security", code: "currency_mismatch" }] });

		await expect(tradesOf(pea.id)).resolves.toEqual([`2026-09-10 ${securityId} 10`]);
		await expect(
			temp.db.select().from(securities).where(eq(securities.ticker, ticker)),
		).resolves.toEqual([]);
	});

	it("refuses a security the account never traded", async () => {
		const pea = await openPea();
		const securityId = await newSecurity();
		const target = await newSecurity();

		await expect(remap(pea.id, securityId, { source: "known", id: target })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("refuses an account that is not an investment one, and a known security that does not exist", async () => {
		const pea = await openPea();
		const checking = await openChecking();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));

		await expect(
			remap(checking.id, securityId, { source: "known", id: securityId }),
		).rejects.toMatchObject({ code: "TRADES_NOT_SUPPORTED" });
		await expect(remap(pea.id, securityId, { source: "known", id: "nope" })).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "security", code: "invalid_value" }],
		});
		await expect(tradesOf(pea.id)).resolves.toEqual([`2026-09-10 ${securityId} 10`]);
	});
});

describe("crypto accounts", () => {
	it("keep their positions once an exchange becomes a wallet: listed, locked, remapped and deleted as an investment's", async () => {
		const exchange = await openPea({ name: "Crypto", type: "crypto", subtype: "exchange" });
		const bitcoin = await newSecurity("Bitcoin");
		const ether = await newSecurity("Ether");
		await record(
			exchange.id,
			buy(bitcoin, { quantity: qty("0.5"), price: tradePrice("60000"), fee: toMinorUnits(0) }),
		);
		await temp.db.update(accounts).set({ subtype: "wallet" }).where(eq(accounts.id, exchange.id));

		await expect(currentHoldings(temp.db, exchange.id, "2026-09-21")).resolves.toMatchObject({
			holdings: [{ quantity: "0.5", amount: 3_000_000, costBasis: 60_000_000_000 }],
		});
		await lock(exchange.id, bitcoin, 50_000_000_000);
		await expect(liveCostBasisLocks(temp.db, exchange.id)).resolves.toHaveLength(1);
		await remapPosition(deps(), exchange.id, bitcoin, { source: "known", id: ether });
		await expect(heldSecurities(exchange.id)).resolves.toEqual([ether]);
		await deletePosition(deps(), exchange.id, ether, user);
		await expect(tradesOf(exchange.id)).resolves.toEqual([]);
	});
});
