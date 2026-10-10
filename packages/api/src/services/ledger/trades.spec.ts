import type { SecurityChoice, TradeInput } from "./trades.ts";

import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";

import {
	add,
	contributionOf,
	counts,
	deps,
	excludedOf,
	firstPage,
	history,
	importStatement,
	keysOf,
	line,
	lockedFields,
	openChecking,
	revert,
	snapshot,
	splitInTwo,
	statementOf,
	temp,
	transferAmount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { deleteAccount } from "./accounts.ts";
import { bulkDeleteTransactions, deleteTransaction, updateTransaction } from "./edits.ts";
import { cashFlowByCategory } from "./queries.ts";
import { oneByOne } from "./shared.ts";
import { listSnapshots } from "./snapshots.ts";
import { editSplit, splitOf, splitTransaction, unsplitTransaction } from "./splits.ts";
import {
	convertTransaction,
	deleteTrade,
	findTrade,
	listTrades,
	recordTrade,
	tradedSecurities,
	updateTrade,
} from "./trades.ts";

/** A buy or a sale, as the helpers below build them. */
type OrderInput = Extract<TradeInput, { side: "buy" | "sell" }>;

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
function buy(securityId: string, overrides: Partial<OrderInput> = {}): OrderInput {
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

function sell(securityId: string, overrides: Partial<OrderInput> = {}): OrderInput {
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
			convertedFrom: null,
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

/** A dividend of 12,34 € on `securityId`, on 2026-09-15. */
function dividend(
	securityId: string,
	overrides: Partial<Extract<TradeInput, { side: "dividend" | "interest" }>> = {},
): TradeInput {
	return {
		side: "dividend",
		security: { source: "known", id: securityId },
		date: "2026-09-15",
		amount: toMinorUnits(1234),
		...overrides,
	};
}

/** The cash of the account's stored balance on `date`. */
async function cashOn(accountId: string, date: string) {
	const row = await temp.db
		.select({ cash: balances.cash })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), eq(balances.date, date)))
		.get();

	return row?.cash;
}

async function holdingRows(accountId: string) {
	return temp.db
		.select({ date: holdings.date, quantity: holdings.quantity, amount: holdings.amount })
		.from(holdings)
		.where(eq(holdings.accountId, accountId))
		.orderBy(holdings.date);
}

describe("dividends and interest", () => {
	it("records a dividend on a held security as a trade of quantity zero that moves cash only", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));
		const held = await holdingRows(account.id);

		const id = await record(account.id, dividend(fund));

		await expect(stored(id)).resolves.toEqual({
			kind: "trade",
			date: "2026-09-15",
			amount: 1234,
			currency: "EUR",
			quantity: 0,
			price: 0,
			fee: 0,
			securityId: fund,
		});
		await expect(cashOn(account.id, "2026-09-15")).resolves.toBe(2_500_000 - 612_650 + 1234);
		await expect(cashOn(account.id, "2026-09-14")).resolves.toBe(2_500_000 - 612_650);
		// Holdings drop a trade of quantity zero, as Sure's `PortfolioCache`.
		await expect(holdingRows(account.id)).resolves.toEqual(held);
		await expect(findTrade(deps(), id)).resolves.toMatchObject({
			side: "dividend",
			quantity: 0,
			amount: 1234,
			security: { id: fund },
			convertedFrom: null,
		});
		// Only a buy or a sale asks for prices.
		expect((await tradedSecurities(temp.db)).filter((row) => row.securityId === fund)).toEqual([
			{ securityId: fund, from: "2026-09-10" },
		]);
	});

	it("records interest on the account's cash, with no security, and counts neither as income, where both made 15,34 €", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));

		const onCash = await record(account.id, {
			side: "interest",
			security: null,
			date: "2026-09-16",
			amount: toMinorUnits(300),
		});
		await record(account.id, dividend(fund));

		await expect(stored(onCash)).resolves.toMatchObject({ securityId: null, quantity: 0 });
		await expect(findTrade(deps(), onCash)).resolves.toMatchObject({
			side: "interest",
			security: null,
		});
		await expect(cashOn(account.id, "2026-09-16")).resolves.toBe(2_500_000 - 612_650 + 1234 + 300);
		// No trade counts, as Sure's `trades_subquery_sql`.
		await expect(
			cashFlowByCategory(deps(), {
				from: "2026-09-01",
				to: "2026-09-30",
				accountIds: [account.id],
			}),
		).resolves.toEqual([]);
		expect(
			(await tradedSecurities(temp.db)).every((row) => typeof row.securityId === "string"),
		).toBe(true);
	});

	it("records interest on a held security", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));

		const id = await record(account.id, dividend(fund, { side: "interest" }));

		await expect(stored(id)).resolves.toMatchObject({ securityId: fund, amount: 1234 });
	});

	it("refuses a security not bought on this account by the trade's date, or a dividend on cash", async () => {
		const account = await openPea();
		const other = await openPea();
		const fund = await newSecurity();
		const never = await newSecurity();
		await record(account.id, buy(fund));
		await record(other.id, buy(never));
		const before = await rowsOf(account.id);

		await oneByOne(
			[
				dividend(never),
				// Bought on the 10th only.
				dividend(fund, { date: "2026-09-09" }),
				dividend("nope"),
			],
			async (input) =>
				expect(record(account.id, input)).rejects.toMatchObject({
					code: "VALIDATION_ERROR",
					fields: [{ path: "security", code: "not_held" }],
				}),
		);

		await expect(record(account.id, dividend(fund, { security: null }))).rejects.toMatchObject({
			fields: [{ path: "security", code: "too_small" }],
		});
		await expect(rowsOf(account.id)).resolves.toEqual(before);
	});

	it("refuses an amount that is not money in, and a date outside the account's life", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));

		await expect(
			record(account.id, dividend(fund, { amount: toMinorUnits(0) })),
		).rejects.toMatchObject({ fields: [{ path: "amount", code: "not_positive" }] });
		await expect(
			record(account.id, dividend(fund, { amount: toMinorUnits(-1234) })),
		).rejects.toMatchObject({ fields: [{ path: "amount", code: "not_positive" }] });
		await expect(record(account.id, dividend(fund, { date: "2026-09-22" }))).rejects.toMatchObject({
			fields: [{ path: "date", code: "date_in_future" }],
		});
	});

	it("edits an income's date and amount, never its kind or a buy's figures", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const bought = await record(account.id, buy(fund));
		const id = await record(account.id, dividend(fund));

		await updateTrade(deps(), id, { date: "2026-09-12", amount: toMinorUnits(2000) }, user);

		await expect(stored(id)).resolves.toMatchObject({ date: "2026-09-12", amount: 2000 });
		await expect(cashOn(account.id, "2026-09-12")).resolves.toBe(2_500_000 - 612_650 + 2000);
		await updateTrade(deps(), id, {}, user);
		await expect(stored(id)).resolves.toMatchObject({ amount: 2000 });

		const patch = {
			side: "buy",
			quantity: toMicros(1_000_000),
			price: toMicros(1_000_000),
			fee: toMinorUnits(1),
		} as const;
		await oneByOne(["side", "quantity", "price", "fee"] as const, async (field) =>
			expect(updateTrade(deps(), id, { [field]: patch[field] }, user)).rejects.toMatchObject({
				fields: [{ path: field, code: "invalid_value" }],
			}),
		);

		await expect(updateTrade(deps(), id, { amount: toMinorUnits(0) }, user)).rejects.toMatchObject({
			fields: [{ path: "amount", code: "not_positive" }],
		});
		// Before the buy, the account held none of it.
		await expect(updateTrade(deps(), id, { date: "2026-09-05" }, user)).rejects.toMatchObject({
			fields: [{ path: "security", code: "not_held" }],
		});
		await expect(
			updateTrade(deps(), bought, { amount: toMinorUnits(1) }, user),
		).rejects.toMatchObject({ fields: [{ path: "amount", code: "invalid_value" }] });
		await expect(stored(id)).resolves.toMatchObject({ date: "2026-09-12", amount: 2000 });
	});

	it("deletes an income without a quantity check, and gives its cash back", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));
		const id = await record(account.id, dividend(fund));

		await deleteTrade(deps(), id, user);

		await expect(stored(id)).resolves.toBeUndefined();
		await expect(cashOn(account.id, "2026-09-15")).resolves.toBe(2_500_000 - 612_650);
	});

	it("keeps an income whose buy is deleted, its amount editable, its date not movable", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const bought = await record(account.id, buy(fund));
		const id = await record(account.id, dividend(fund));

		await deleteTrade(deps(), bought, user);
		await updateTrade(deps(), id, { amount: toMinorUnits(2000) }, user);

		await expect(stored(id)).resolves.toMatchObject({ amount: 2000 });
		await expect(updateTrade(deps(), id, { date: "2026-09-16" }, user)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "security", code: "not_held" }],
		});
	});

	it("leaves the buy that sets a position's last price, never a dividend after it", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund));
		await record(account.id, dividend(fund, { date: "2026-09-18" }));

		const rows = await holdingRows(account.id);

		expect(rows.at(-1)).toMatchObject({ quantity: 10_000_000, amount: 612_400 });
	});
});

/** A line of `amount` on the PEA, booked by hand, never another test's transfer. */
async function lineOn(
	accountId: string,
	amount: number,
	overrides: Parameters<typeof add>[1] = {},
) {
	return add(accountId, { date: "2026-09-10", amount: toMinorUnits(amount), ...overrides });
}

const convertBuy = (securityId: string, price = 612_400_000) => ({
	side: "buy" as const,
	security: known(securityId),
	quantity: toMicros(10_000_000),
	price: toMicros(price),
});

async function convert(id: string, input: Parameters<typeof convertTransaction>[2]) {
	return (await convertTransaction(deps(), id, input, user)).id;
}

describe("convertTransaction", () => {
	it("turns an imported buy into a trade that takes its date and amount, the rest its fee", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const statement = statementOf(
			line({ date: "2026-09-10", amount: toMinorUnits(-612_650), label: "ACHAT 10 LVMH" }),
		);
		await importStatement(account.id, statement);
		const [{ id: source } = { id: "" }] = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.kind, "transaction")));
		const keys = await keysOf(source);
		const cashBefore = await cashOn(account.id, "2026-09-21");

		const id = await convert(source, convertBuy(fund));

		await expect(stored(id)).resolves.toEqual({
			kind: "trade",
			date: "2026-09-10",
			amount: -612_650,
			currency: "EUR",
			quantity: 10_000_000,
			price: 612_400_000,
			fee: 250,
			securityId: fund,
		});
		// The cash does not move: the trade moves what the line moved, and the line no longer counts.
		await expect(cashOn(account.id, "2026-09-21")).resolves.toBe(cashBefore);
		await expect(excludedOf(source)).resolves.toBe(true);
		await expect(lockedFields(source)).resolves.toContain("excluded");
		await expect(keysOf(source)).resolves.toEqual(keys);
		await expect(findTrade(deps(), id)).resolves.toMatchObject({
			convertedFrom: { id: source, label: "ACHAT 10 LVMH" },
		});
		await expect(holdingRows(account.id)).resolves.toContainEqual({
			date: "2026-09-21",
			quantity: 10_000_000,
			amount: 612_400,
		});
		// Its keys stay on it: the same file again writes nothing.
		const again = await importStatement(account.id, statement);
		expect(counts(again.result)).toMatchObject({ created: 0, present: 1 });
		await expect(rowsOf(account.id)).resolves.toMatchObject({ trades: 1 });
	});

	it("turns a sale, a dividend and interest on cash into trades", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		await record(account.id, buy(fund, { date: "2026-09-05" }));
		const sale = await lineOn(account.id, 259_750);
		const paid = await lineOn(account.id, 1234, { date: "2026-09-15" });
		const interest = await lineOn(account.id, 300, { date: "2026-09-16" });

		const sold = await convert(sale, {
			side: "sell",
			security: known(fund),
			quantity: toMicros(4_000_000),
			price: toMicros(650_000_000),
		});
		const dividendId = await convert(paid, {
			side: "dividend",
			security: { source: "known", id: fund },
		});
		const interestId = await convert(interest, { side: "interest", security: null });

		await expect(stored(sold)).resolves.toMatchObject({
			amount: 259_750,
			quantity: -4_000_000,
			fee: 250,
		});
		await expect(stored(dividendId)).resolves.toMatchObject({ amount: 1234, quantity: 0 });
		await expect(stored(interestId)).resolves.toMatchObject({ amount: 300, securityId: null });
	});

	it("creates the security a conversion names when it is new", async () => {
		const account = await openPea();
		const source = await lineOn(account.id, -10_000);

		const id = await convert(source, {
			side: "buy",
			security: manual(null),
			quantity: toMicros(100_000_000),
			price: toMicros(1_000_000),
		});

		await expect(findTrade(deps(), id)).resolves.toMatchObject({
			security: { name: "Fonds euros" },
			fee: 0,
		});
	});

	it("refuses a type whose sign the amount does not have, and a fee below zero", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const outflow = await lineOn(account.id, -600_000);
		const inflow = await lineOn(account.id, 5000);

		await expect(convert(inflow, convertBuy(fund))).rejects.toMatchObject({
			fields: [{ path: "side", code: "sign_mismatch" }],
		});
		await expect(
			convert(outflow, { side: "dividend", security: { source: "known", id: fund } }),
		).rejects.toMatchObject({ fields: [{ path: "side", code: "sign_mismatch" }] });
		await expect(convert(outflow, { ...convertBuy(fund), side: "sell" })).rejects.toMatchObject({
			fields: [{ path: "side", code: "sign_mismatch" }],
		});
		// 10 at 612,40 is 6 124 €: 6 000 € leaves a fee below zero.
		await expect(convert(outflow, convertBuy(fund))).rejects.toMatchObject({
			fields: [{ path: "price", code: "amount_mismatch" }],
		});
		await expect(excludedOf(outflow)).resolves.toBe(false);
		await expect(rowsOf(account.id)).resolves.toMatchObject({ trades: 0 });
	});

	it("refuses a sale of what is not held, and an income on what is not held, as a trade does", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const inflow = await lineOn(account.id, 260_000);

		await expect(
			convert(inflow, { ...convertBuy(fund, 260_000_000), side: "sell" }),
		).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });
		await expect(
			convert(inflow, { side: "dividend", security: { source: "known", id: fund } }),
		).rejects.toMatchObject({ fields: [{ path: "security", code: "not_held" }] });
	});

	it("refuses a transfer side, a pending, excluded or flagged line, a split's rows and a converted one", async () => {
		const account = await openPea();
		const current = await openChecking({ name: "Compte courant" });
		const fund = await newSecurity();
		const { inflow } = await contributionOf(current.id, account.id);
		const pending = await lineOn(account.id, -transferAmount(), { pending: true });
		const excluded = await lineOn(account.id, -transferAmount());
		await temp.db
			.update(transactions)
			.set({ excluded: true })
			.where(eq(transactions.entryId, excluded));
		const flagged = await lineOn(account.id, -transferAmount());
		await temp.db
			.update(transactions)
			.set({ possibleDuplicate: true })
			.where(eq(transactions.entryId, flagged));
		const { parent, food } = await splitInTwo(account.id);
		const converted = await lineOn(account.id, -612_650);
		await convert(converted, convertBuy(fund));
		const cashBefore = await cashOn(account.id, "2026-09-21");

		await oneByOne([inflow, pending, excluded, flagged, parent, food, converted], async (id) =>
			expect(convert(id, { side: "interest", security: null })).rejects.toMatchObject({
				code: "NOT_CONVERTIBLE",
			}),
		);

		// A contribution's inflow stays a transaction, counted in cash (AD-11).
		await expect(excludedOf(inflow)).resolves.toBe(false);
		await expect(cashOn(account.id, "2026-09-21")).resolves.toBe(cashBefore);
	});

	it("refuses an account other than an investment one, an unknown line and a future date", async () => {
		const current = await openChecking({ name: "Courant" });
		const account = await openPea();
		const outflow = await lineOn(current.id, -transferAmount());
		const later = await lineOn(account.id, 300, { date: "2026-09-25" });

		await expect(convert(outflow, { side: "interest", security: null })).rejects.toMatchObject({
			code: "NOT_AN_INVESTMENT_ACCOUNT",
		});
		await expect(convert("nope", { side: "interest", security: null })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(convert(later, { side: "interest", security: null })).rejects.toMatchObject({
			fields: [{ path: "date", code: "date_in_future" }],
		});
	});

	it("keeps a converted trade on its transaction's date and amount", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const source = await lineOn(account.id, -612_650);
		const id = await convert(source, convertBuy(fund));

		await expect(updateTrade(deps(), id, { date: "2026-09-11" }, user)).rejects.toMatchObject({
			code: "TRANSACTION_SPLIT",
		});
		await expect(updateTrade(deps(), id, { fee: toMinorUnits(300) }, user)).rejects.toMatchObject({
			code: "TRANSACTION_SPLIT",
		});
		// The same amount, otherwise made up, is still the transaction's.
		await updateTrade(deps(), id, { price: toMicros(612_450_000), fee: toMinorUnits(200) }, user);
		await expect(stored(id)).resolves.toMatchObject({ amount: -612_650, fee: 200 });
		// The transaction's own date and amount move only with the conversion.
		await expect(
			updateTransaction(deps(), source, { amount: toMinorUnits(-1) }, user),
		).rejects.toMatchObject({ code: "TRANSACTION_SPLIT" });
	});

	it("is undone by deleting its trade: the transaction counts again, its exclusion still locked", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const source = await lineOn(account.id, -612_650);
		const cashBefore = await cashOn(account.id, "2026-09-21");
		const id = await convert(source, convertBuy(fund));

		await deleteTrade(deps(), id, user);

		await expect(excludedOf(source)).resolves.toBe(false);
		await expect(lockedFields(source)).resolves.toContain("excluded");
		await expect(cashOn(account.id, "2026-09-21")).resolves.toBe(cashBefore);
		await expect(holdingRows(account.id)).resolves.toEqual([]);
		// Converted again, as an unsplit transaction may be split again.
		await expect(convert(source, convertBuy(fund))).resolves.toBeTypeOf("string");
	});

	it("is no split: the split functions answer NOT_FOUND and splitting it is refused", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const source = await lineOn(account.id, -612_650);
		const id = await convert(source, convertBuy(fund));
		const whole = [{ label: "Tout", amount: toMinorUnits(-612_650), categoryId: null }];

		await expect(splitOf(deps(), source)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(splitOf(deps(), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(editSplit(deps(), source, whole, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(unsplitTransaction(deps(), source, user)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(splitTransaction(deps(), source, whole, user)).rejects.toMatchObject({
			code: "NOT_SPLITTABLE",
		});
		await expect(stored(id)).resolves.toBeDefined();
	});

	it("goes with its transaction, deleted alone, in bulk or by a revert", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const one = await lineOn(account.id, -612_650);
		const two = await lineOn(account.id, -612_651);
		await convert(one, convertBuy(fund));
		await convert(two, convertBuy(fund));
		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-11", amount: toMinorUnits(-612_652), label: "ACHAT" })),
		);
		const [{ id: imported } = { id: "" }] = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(eq(entries.importId, importId));
		await convert(imported, convertBuy(fund));
		const cashBefore = await cashOn(account.id, "2026-09-21");

		await deleteTransaction(deps(), one, user);
		await bulkDeleteTransactions(deps(), { ids: [two] }, user);
		await revert(importId);

		await expect(rowsOf(account.id)).resolves.toMatchObject({ trades: 0 });
		await expect(holdingRows(account.id)).resolves.toEqual([]);
		await expect(cashOn(account.id, "2026-09-21")).resolves.toBe(
			(cashBefore ?? 0) + 612_650 + 612_651 + 612_652,
		);
	});

	it("refuses to delete a converted buy a later sale needs, by any path", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const source = await lineOn(account.id, -612_650);
		await convert(source, convertBuy(fund));
		await record(account.id, sell(fund, { date: "2026-09-15" }));

		await expect(deleteTransaction(deps(), source, user)).rejects.toMatchObject({
			code: "QUANTITY_UNAVAILABLE",
		});
		await expect(bulkDeleteTransactions(deps(), { ids: [source] }, user)).rejects.toMatchObject({
			code: "QUANTITY_UNAVAILABLE",
		});

		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-11", amount: toMinorUnits(-612_652), label: "ACHAT" })),
		);
		const [{ id: imported } = { id: "" }] = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(eq(entries.importId, importId));
		await convert(imported, convertBuy(fund));
		await record(account.id, sell(fund, { date: "2026-09-16" }));

		await expect(revert(importId)).rejects.toMatchObject({ code: "QUANTITY_UNAVAILABLE" });
		await expect(rowsOf(account.id)).resolves.toMatchObject({ trades: 4 });
	});

	it("reverts an import whose converted buy and the converted sale it covers fall in two chunks", async () => {
		const account = await openPea();
		const fund = await newSecurity();
		const fillers = Array.from({ length: 499 }, (_, index) =>
			line({ date: "2026-09-11", amount: toMinorUnits(-(index + 1)), label: `FRAIS ${index}` }),
		);
		const { importId } = await importStatement(
			account.id,
			statementOf(
				line({ date: "2026-09-10", amount: toMinorUnits(-612_650), label: "ACHAT" }),
				...fillers,
				line({ date: "2026-09-12", amount: toMinorUnits(650_000), label: "VENTE" }),
			),
		);
		const lineOf = async (amount: number) => {
			const [row] = await temp.db
				.select({ id: entries.id })
				.from(entries)
				.where(and(eq(entries.importId, importId), eq(entries.amount, amount)));

			return row?.id ?? "";
		};
		await convert(await lineOf(-612_650), convertBuy(fund));
		await convert(await lineOf(650_000), {
			side: "sell",
			security: known(fund),
			quantity: toMicros(10_000_000),
			price: toMicros(650_000_000),
		});

		await revert(importId);

		await expect(rowsOf(account.id)).resolves.toMatchObject({ trades: 0 });
	});
});
