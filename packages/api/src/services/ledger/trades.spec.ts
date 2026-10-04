import type { SecurityChoice, TradeInput } from "./trades.ts";

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";

import {
	add,
	deps,
	firstPage,
	history,
	openChecking,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { deleteAccount } from "./accounts.ts";
import { listSnapshots } from "./snapshots.ts";
import {
	deleteTrade,
	findTrade,
	listTrades,
	recordTrade,
	tradedSecurities,
	updateTrade,
} from "./trades.ts";

useLedgerDatabase();

const user = { origin: "user" } as const;

/** A PEA opened on 2026-09-01 with 25 000,00 €, the clock on 2026-09-21. */
async function openPea(currency: "EUR" | "USD" = "EUR") {
	return openChecking({
		name: "PEA",
		type: "investment",
		subtype: "pea",
		currency,
		openingBalance: toMinorUnits(2_500_000),
		openingDate: "2026-09-01",
	});
}

async function newSecurity(fields: Partial<typeof securities.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	await temp.db.insert(securities).values({
		id,
		isin: "FR0000121014",
		ticker: `MC${id.slice(0, 8)}.PA`,
		mic: "XPAR",
		name: "LVMH",
		currency: "EUR",
		provider: "yahoo",
		createdAt: 0,
		updatedAt: 0,
		...fields,
	});

	return id;
}

const known = (id: string): SecurityChoice => ({ source: "known", id });

/** A listing on no known venue, as a search may answer one. */
const listing = (ticker: string, currency: string | null): SecurityChoice => ({
	source: "listing",
	ticker,
	mic: null,
	name: ticker,
	currency,
	provider: "yahoo",
});

const manual = (isin: string | null): SecurityChoice => ({
	source: "manual",
	isin,
	name: "Fonds euros",
});

/** A buy of `quantity` at 612.40 € with 2.50 € of fees, on `date`. */
function buy(securityId: string, overrides: Partial<TradeInput> = {}): TradeInput {
	return {
		side: "buy",
		security: known(securityId),
		date: "2026-09-10",
		quantity: toMicros(10_000_000),
		price: toMicros(612_400_000),
		fee: toMinorUnits(250),
		...overrides,
	};
}

function sell(securityId: string, overrides: Partial<TradeInput> = {}): TradeInput {
	return buy(securityId, {
		side: "sell",
		price: toMicros(650_000_000),
		fee: toMinorUnits(0),
		...overrides,
	});
}

async function record(accountId: string, input: TradeInput) {
	return (await recordTrade(deps(), accountId, input, user)).id;
}

async function rowsOf(accountId: string) {
	const [entryCount] = await temp.db
		.select({ n: count() })
		.from(entries)
		.where(eq(entries.accountId, accountId));
	const [tradeCount] = await temp.db
		.select({ n: count() })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(eq(entries.accountId, accountId));

	return { entries: entryCount?.n, trades: tradeCount?.n };
}

async function stored(id: string) {
	return temp.db
		.select({
			kind: entries.kind,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			quantity: trades.quantity,
			price: trades.price,
			fee: trades.fee,
			securityId: trades.securityId,
		})
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(eq(trades.entryId, id))
		.get();
}

const securityCount = async () =>
	(await temp.db.select({ n: count() }).from(securities).get())?.n ?? 0;

describe("recordTrade", () => {
	it("records a buy as cash leaving the account, its quantity positive, the balance moved from its date by its fee", async () => {
		const account = await openPea();
		const securityId = await newSecurity();

		const id = await record(account.id, buy(securityId));

		await expect(stored(id)).resolves.toEqual({
			kind: "trade",
			date: "2026-09-10",
			amount: -612_650,
			currency: "EUR",
			quantity: 10_000_000,
			price: 612_400_000,
			fee: 250,
			securityId,
		});
		// The cash less the buy, plus the 10 shares at the buy's own price.
		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(2_500_000);
		expect(days.get("2026-09-10")).toBe(2_500_000 - 612_650 + 612_400);
		expect(days.get("2026-09-21")).toBe(2_500_000 - 612_650 + 612_400);
	});

	it("records a sale of what is held as cash coming in, its quantity negative", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId));

		const id = await record(
			account.id,
			sell(securityId, { date: "2026-09-15", quantity: toMicros(4_000_000) }),
		);

		await expect(stored(id)).resolves.toMatchObject({ amount: 260_000, quantity: -4_000_000 });
		// The 6 shares left are worth the sale's price.
		const days = await history(account.id);
		expect(days.get("2026-09-15")).toBe(2_500_000 - 612_650 + 260_000 + 390_000);
	});

	it("rounds the product to the cent", async () => {
		const account = await openPea();
		const securityId = await newSecurity();

		const id = await record(
			account.id,
			buy(securityId, {
				quantity: toMicros(3_000_000),
				price: toMicros(333_335),
				fee: toMinorUnits(0),
			}),
		);

		await expect(stored(id)).resolves.toMatchObject({ amount: -100 });
	});

	it("refuses a sale above what is held on its date, and writes nothing", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId));
		const before = await rowsOf(account.id);

		await expect(
			record(account.id, sell(securityId, { quantity: toMicros(11_000_000) })),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE", fields: undefined });
		// Held only from the 10th: a sale on the 9th is short too.
		await expect(
			record(account.id, sell(securityId, { date: "2026-09-09", quantity: toMicros(1_000_000) })),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });
		await expect(rowsOf(account.id)).resolves.toEqual(before);
	});

	it("refuses a sale that leaves a later one short", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId, { date: "2026-09-02" }));
		await record(account.id, sell(securityId, { date: "2026-09-06" }));

		await expect(
			record(account.id, sell(securityId, { date: "2026-09-04", quantity: toMicros(5_000_000) })),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });
	});

	it("nets a day's trades: a sale covered by a buy the same day holds", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId, { date: "2026-09-10" }));

		await expect(
			record(account.id, sell(securityId, { date: "2026-09-10", quantity: toMicros(10_000_000) })),
		).resolves.toBeTypeOf("string");
	});

	it("counts each account's holding apart", async () => {
		const pea = await openPea();
		const other = await openPea();
		const securityId = await newSecurity();
		await record(pea.id, buy(securityId));

		await expect(record(other.id, sell(securityId))).rejects.toMatchObject({
			code: "QUANTITY_UNAVAILABLE",
		});
	});

	it("refuses any account but an investment one", async () => {
		const checking = await openChecking();
		const securityId = await newSecurity();

		await expect(record(checking.id, buy(securityId))).rejects.toMatchObject({
			code: "NOT_AN_INVESTMENT_ACCOUNT",
		});
		await expect(rowsOf(checking.id)).resolves.toEqual({ entries: 1, trades: 0 });
	});

	it("refuses an unknown account", async () => {
		await expect(record("nope", buy("nope"))).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it.each([
		["the opening day, whose anchor fixes it", "2026-09-01", "not_after_opening_date"],
		["a day before it", "2026-08-20", "not_after_opening_date"],
		["tomorrow", "2026-09-22", "date_in_future"],
	])("refuses %s", async (_name, date, code) => {
		const account = await openPea();
		const securityId = await newSecurity();

		await expect(record(account.id, buy(securityId, { date }))).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "date", code }],
		});
	});

	it("refuses an amount no balance could hold, on the quantity", async () => {
		const account = await openPea();
		const securityId = await newSecurity();

		await expect(
			record(
				account.id,
				buy(securityId, {
					quantity: toMicros(100_000_000_000),
					price: toMicros(1_000_000_000_000),
				}),
			),
		).rejects.toMatchObject({ fields: [{ path: "quantity", code: "too_big" }] });
	});

	it("refuses a known security in another currency, or one that does not exist", async () => {
		const account = await openPea();
		const dollars = await newSecurity({ currency: "USD" });

		await expect(record(account.id, buy(dollars))).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "security", code: "currency_mismatch" }],
		});
		await expect(record(account.id, buy("nope"))).rejects.toMatchObject({
			fields: [{ path: "security", code: "invalid_value" }],
		});
	});

	it("creates a listing once, upper-cased, and finds it again whatever the case", async () => {
		const account = await openPea();
		const airLiquide: SecurityChoice = {
			source: "listing",
			ticker: "ai.pa",
			mic: "XPAR",
			name: "Air Liquide",
			currency: "EUR",
			provider: "yahoo",
		};
		const before = await securityCount();

		const first = await record(account.id, buy("", { security: airLiquide }));
		const second = await record(
			account.id,
			buy("", { security: { ...airLiquide, ticker: "AI.PA" } }),
		);

		expect(await securityCount()).toBe(before + 1);
		const firstRow = await stored(first);
		await expect(stored(second)).resolves.toMatchObject({ securityId: firstRow?.securityId });
		await expect(
			temp.db
				.select()
				.from(securities)
				.where(eq(securities.id, firstRow?.securityId ?? ""))
				.get(),
		).resolves.toMatchObject({
			isin: null,
			ticker: "AI.PA",
			mic: "XPAR",
			name: "Air Liquide",
			currency: "EUR",
			provider: "yahoo",
		});
	});

	it("gives a listing without a currency the account's, and refuses one in another", async () => {
		const account = await openPea();

		const id = await record(account.id, buy("", { security: listing("ZZZ1", null) }));

		const row = await stored(id);
		await expect(
			temp.db
				.select({ currency: securities.currency, mic: securities.mic })
				.from(securities)
				.where(eq(securities.id, row?.securityId ?? ""))
				.get(),
		).resolves.toEqual({ currency: "EUR", mic: null });
		// Found again with no venue, as the unique index's `coalesce` compares
		// it: the stored security's currency decides, not the search's.
		const again = await record(account.id, buy("", { security: listing("zzz1", "USD") }));
		await expect(stored(again)).resolves.toMatchObject({ securityId: row?.securityId });
		await expect(
			record(account.id, buy("", { security: listing("MSFT", "USD") })),
		).rejects.toMatchObject({ fields: [{ path: "security", code: "currency_mismatch" }] });
	});

	it("reuses a security typed by hand with the same ISIN, and creates one each time without", async () => {
		const account = await openPea();
		const before = await securityCount();

		const first = await stored(
			await record(account.id, buy("", { security: manual("FR0010315770") })),
		);
		const again = await stored(
			await record(account.id, buy("", { security: manual("FR0010315770") })),
		);
		await record(account.id, buy("", { security: manual(null) }));
		await record(account.id, buy("", { security: manual(null) }));

		expect(again?.securityId).toBe(first?.securityId);
		expect(await securityCount()).toBe(before + 3);
		await expect(
			temp.db
				.select()
				.from(securities)
				.where(eq(securities.id, first?.securityId ?? ""))
				.get(),
		).resolves.toMatchObject({
			isin: "FR0010315770",
			ticker: null,
			mic: null,
			name: "Fonds euros",
			currency: "EUR",
			provider: null,
		});
	});

	it("never reuses a listing for a security typed by hand, and refuses one typed in another currency", async () => {
		const pea = await openPea();
		const dollars = await openPea("USD");
		// A listing with this ISIN has a ticker: typing it by hand creates another.
		await newSecurity({ isin: "US0378331005", currency: "USD" });
		const typed: SecurityChoice = { source: "manual", isin: "US0378331005", name: "Apple" };
		const before = await securityCount();

		await record(dollars.id, buy("", { security: typed }));

		expect(await securityCount()).toBe(before + 1);
		await expect(record(pea.id, buy("", { security: typed }))).rejects.toMatchObject({
			fields: [{ path: "security", code: "currency_mismatch" }],
		});
	});

	it("creates no security when the trade is refused", async () => {
		const account = await openPea();
		const before = await securityCount();

		await expect(
			record(account.id, sell("", { security: { source: "manual", isin: null, name: "Vendu" } })),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });

		expect(await securityCount()).toBe(before);
	});
});

describe("updateTrade", () => {
	it("changes the side, date, quantity, price and fee, and recomputes from the earlier date", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const id = await record(account.id, buy(securityId, { date: "2026-09-10" }));
		await record(account.id, buy(securityId, { date: "2026-09-12" }));

		await updateTrade(
			deps(),
			id,
			{
				side: "sell",
				date: "2026-09-14",
				quantity: toMicros(5_000_000),
				price: toMicros(700_000_000),
				fee: toMinorUnits(100),
			},
			user,
		);

		await expect(stored(id)).resolves.toMatchObject({
			date: "2026-09-14",
			amount: 349_900,
			quantity: -5_000_000,
			price: 700_000_000,
			fee: 100,
			securityId,
		});
		const days = await history(account.id);
		expect(days.get("2026-09-10")).toBe(2_500_000);
		expect(days.get("2026-09-12")).toBe(2_500_000 - 612_650 + 612_400);
		// 5 shares left, at the sale's 700 €.
		expect(days.get("2026-09-14")).toBe(2_500_000 - 612_650 + 349_900 + 350_000);
	});

	it("keeps what the patch leaves out, the sign of a sale included", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId));
		const id = await record(account.id, sell(securityId, { quantity: toMicros(4_000_000) }));

		await updateTrade(deps(), id, { fee: toMinorUnits(500) }, user);

		await expect(stored(id)).resolves.toMatchObject({
			date: "2026-09-10",
			quantity: -4_000_000,
			price: 650_000_000,
			amount: 259_500,
		});
		await updateTrade(deps(), id, {}, user);
		await expect(stored(id)).resolves.toMatchObject({ amount: 259_500 });
	});

	it("moves a trade back and recomputes from its new date", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const id = await record(account.id, buy(securityId, { date: "2026-09-10" }));

		await updateTrade(deps(), id, { date: "2026-09-05" }, user);

		const days = await history(account.id);
		expect(days.get("2026-09-04")).toBe(2_500_000);
		expect(days.get("2026-09-05")).toBe(2_500_000 - 612_650 + 612_400);
	});

	it("refuses an edit that leaves a later sale short, and writes nothing", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const bought = await record(account.id, buy(securityId, { date: "2026-09-02" }));
		const sold = await record(account.id, sell(securityId, { date: "2026-09-06" }));

		await expect(
			updateTrade(deps(), bought, { quantity: toMicros(5_000_000) }, user),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });
		await expect(updateTrade(deps(), bought, { date: "2026-09-08" }, user)).rejects.toMatchObject({
			code: "QUANTITY_UNAVAILABLE",
		});
		await expect(updateTrade(deps(), sold, { side: "buy" }, user)).resolves.toBeUndefined();
		await expect(stored(bought)).resolves.toMatchObject({
			date: "2026-09-02",
			quantity: 10_000_000,
		});
	});

	it("refuses a date outside the account's life and an amount too big", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const id = await record(account.id, buy(securityId));

		await expect(updateTrade(deps(), id, { date: "2026-09-01" }, user)).rejects.toMatchObject({
			fields: [{ path: "date", code: "not_after_opening_date" }],
		});
		await expect(updateTrade(deps(), id, { date: "2026-09-30" }, user)).rejects.toMatchObject({
			fields: [{ path: "date", code: "date_in_future" }],
		});
		await expect(
			updateTrade(
				deps(),
				id,
				{ quantity: toMicros(100_000_000_000), price: toMicros(1_000_000_000_000) },
				user,
			),
		).rejects.toMatchObject({ fields: [{ path: "quantity", code: "too_big" }] });
	});

	it("refuses an id that names no trade", async () => {
		const account = await openPea();
		const valuation = await snapshot(account.id, "2026-09-05", 2_400_000);

		await expect(updateTrade(deps(), valuation, {}, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteTrade", () => {
	it("deletes the trade and recomputes from its date, the security kept", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const id = await record(account.id, buy(securityId));

		await deleteTrade(deps(), id, user);

		await expect(stored(id)).resolves.toBeUndefined();
		await expect(rowsOf(account.id)).resolves.toEqual({ entries: 1, trades: 0 });
		expect((await history(account.id)).get("2026-09-21")).toBe(2_500_000);
		await expect(
			temp.db.select().from(securities).where(eq(securities.id, securityId)).get(),
		).resolves.toBeDefined();
	});

	it("refuses to delete a buy a later sale needs", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const bought = await record(account.id, buy(securityId, { date: "2026-09-02" }));
		const sold = await record(account.id, sell(securityId, { date: "2026-09-06" }));

		await expect(deleteTrade(deps(), bought, user)).rejects.toMatchObject({
			code: "QUANTITY_UNAVAILABLE",
		});
		await deleteTrade(deps(), sold, user);
		await deleteTrade(deps(), bought, user);
		await expect(rowsOf(account.id)).resolves.toEqual({ entries: 1, trades: 0 });
	});

	it("refuses an id that names no trade", async () => {
		await expect(deleteTrade(deps(), "nope", user)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("balances with trades", () => {
	it("count a trade as cash beside booked transactions, and a snapshot's gap with its holdings", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(100_000), pending: false });
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1_000), pending: true });
		await record(account.id, buy(securityId));
		await snapshot(account.id, "2026-09-10", 2_000_000);

		const { items } = await listSnapshots(deps(), account.id, firstPage);

		expect(items[0]).toMatchObject({
			balance: 2_000_000,
			computed: 2_500_000 + 100_000 - 612_650 + 612_400,
			gap: 2_000_000 - (2_500_000 + 100_000 - 612_650 + 612_400),
		});
	});

	it("read a snapshot's gap from the day before's cash, its holdings valued on the day", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId));
		await snapshot(account.id, "2026-09-12", 2_400_000);

		const { items } = await listSnapshots(deps(), account.id, firstPage);

		expect(items[0]).toMatchObject({
			balance: 2_400_000,
			computed: 2_500_000 - 612_650 + 612_400,
			gap: 2_400_000 - (2_500_000 - 612_650 + 612_400),
		});
	});

	it("go with the account, its trades first, its securities kept", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await record(account.id, buy(securityId));

		await deleteAccount(deps(), account.id, user);

		await expect(rowsOf(account.id)).resolves.toEqual({ entries: 0, trades: 0 });
		await expect(
			temp.db.select().from(securities).where(eq(securities.id, securityId)).get(),
		).resolves.toBeDefined();
	});
});

describe("reading trades", () => {
	it("lists an account's trades most recent first, a page at a time, each with its security", async () => {
		const account = await openPea();
		const securityId = await newSecurity({ name: "LVMH", isin: "FR0000121014" });
		const first = await record(account.id, buy(securityId, { date: "2026-09-02" }));
		const sale = await record(
			account.id,
			sell(securityId, { date: "2026-09-08", quantity: toMicros(2_500_000) }),
		);
		await record(account.id, buy(securityId, { date: "2026-09-05" }));

		const page = await listTrades(deps(), account.id, { page: 1, pageSize: 2 });

		expect(page.total).toBe(3);
		expect(page.items.map((item) => item.id)).toHaveLength(2);
		expect(page.items[0]).toEqual({
			id: sale,
			accountId: account.id,
			date: "2026-09-08",
			side: "sell",
			quantity: 2_500_000,
			price: 650_000_000,
			fee: 0,
			amount: 162_500,
			currency: "EUR",
			security: {
				id: securityId,
				name: "LVMH",
				ticker: `MC${securityId.slice(0, 8)}.PA`,
				mic: "XPAR",
				isin: "FR0000121014",
			},
		});
		const last = await listTrades(deps(), account.id, { page: 2, pageSize: 2 });
		expect(last.items.map((item) => item.id)).toEqual([first]);
		await expect(findTrade(deps(), first)).resolves.toMatchObject({
			side: "buy",
			amount: -612_650,
		});
		await expect(findTrade(deps(), "nope")).resolves.toBeNull();
	});

	it("lists only one security's trades when asked, as a position's sheet does", async () => {
		const account = await openPea();
		const lvmh = await newSecurity();
		const other = await newSecurity();
		const bought = await record(account.id, buy(lvmh, { date: "2026-09-02" }));
		await record(account.id, buy(other, { date: "2026-09-03" }));
		const sold = await record(
			account.id,
			sell(lvmh, { date: "2026-09-04", quantity: toMicros(1_000_000) }),
		);

		const page = await listTrades(deps(), account.id, { page: 1, pageSize: 50, securityId: lvmh });

		expect(page.total).toBe(2);
		expect(page.items.map((item) => item.id)).toEqual([sold, bought]);
	});

	it("names each traded security from its first trade on any account, a sold one included", async () => {
		const pea = await openPea();
		const other = await openPea();
		const sold = await newSecurity();
		const held = await newSecurity();
		const never = await newSecurity();
		await record(pea.id, buy(sold, { date: "2026-09-03" }));
		await record(pea.id, sell(sold, { date: "2026-09-04" }));
		await record(other.id, buy(held, { date: "2026-09-08" }));
		await record(pea.id, buy(held, { date: "2026-09-02" }));

		const traded = await tradedSecurities(temp.db);

		expect(traded).toEqual(
			expect.arrayContaining([
				{ securityId: held, from: "2026-09-02" },
				{ securityId: sold, from: "2026-09-03" },
			]),
		);
		expect(traded.map(({ securityId }) => securityId)).not.toContain(never);
		const order = traded.map(({ securityId }) => securityId);
		expect(order.indexOf(held)).toBeLessThan(order.indexOf(sold));
	});
});
