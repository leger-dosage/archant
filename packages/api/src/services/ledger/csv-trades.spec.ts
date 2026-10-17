import type { CsvTrade } from "./csv-trades.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Quantity, TradePrice } from "@archant/data/decimals";
import { parseQuantity, parseTradePrice } from "@archant/data/decimals";
import { toMinorUnits } from "@archant/data/money";

import { AppError } from "../../lib/errors.ts";
import { openPea, temp, useLedgerDatabase } from "../../testing/ledger.ts";
import { insertSecurity } from "../../testing/prices.ts";
import { insertCsvTrades } from "./csv-trades.ts";

useLedgerDatabase();

function decimal<Value>(parse: (text: string) => Value | null, text: string): Value {
	const value = parse(text);

	if (value === null) {
		throw new Error(`${text} does not read.`);
	}

	return value;
}

const trade = (overrides: Partial<CsvTrade> = {}): CsvTrade => ({
	accountKey: "",
	date: "2026-09-10",
	ticker: "AI.PA",
	mic: null,
	quantity: decimal<Quantity>(parseQuantity, "2"),
	price: decimal<TradePrice>(parseTradePrice, "150"),
	amount: toMinorUnits(-30000),
	...overrides,
});

const newAccount = {
	sourceId: "new Courtier",
	name: "Courtier CSV",
	type: "investment" as const,
	subtype: null,
	currency: "EUR" as const,
	active: true,
	excludedFromReports: false,
	institutionName: null,
	institutionDomain: null,
	notes: null,
	details: null,
	opening: { date: "2026-09-09", amount: toMinorUnits(0) },
};

async function write(input: Parameters<typeof insertCsvTrades>[1]) {
	await temp.db.transaction(
		async (tx) => insertCsvTrades(tx, input, { now: Date.now(), timeZone: "Europe/Paris" }),
		{ behavior: "immediate" },
	);
}

async function failure(input: Parameters<typeof insertCsvTrades>[1]) {
	const error: unknown = await write(input).then(
		() => null,
		(caught: unknown) => caught,
	);

	if (!(error instanceof AppError)) {
		throw new Error("The write did not fail with an AppError.");
	}

	return error.code;
}

describe("insertCsvTrades", () => {
	it("writes each trade on its account, a new one included, and recomputes their balances", async () => {
		const pea = await openPea({ name: "PEA CSV" });

		await write({
			existing: new Map([[pea.id, pea]]),
			newAccounts: [newAccount],
			trades: [
				trade({ accountKey: pea.id, ticker: "MC.PA", mic: "XPAR" }),
				trade({ accountKey: "new Courtier" }),
				trade({ accountKey: "new Courtier", date: "2026-09-12" }),
			],
		});

		expect(
			await temp.db.all(sql`select a.name, e.date, e.amount, t.fee, s.ticker, s.provider
				from trades t join entries e on e.id = t.entry_id join accounts a on a.id = e.account_id
				join securities s on s.id = t.security_id
				where a.name in ('PEA CSV', 'Courtier CSV') order by a.name, e.date`),
		).toEqual([
			{
				name: "Courtier CSV",
				date: "2026-09-10",
				amount: -30000,
				fee: 0,
				ticker: "AI.PA",
				provider: "yahoo",
			},
			{
				name: "Courtier CSV",
				date: "2026-09-12",
				amount: -30000,
				fee: 0,
				ticker: "AI.PA",
				provider: "yahoo",
			},
			{
				name: "PEA CSV",
				date: "2026-09-10",
				amount: -30000,
				fee: 0,
				ticker: "MC.PA",
				provider: "yahoo",
			},
		]);
		// Four shares at the last trade's price, against the cash both buys took.
		expect(
			await temp.db.all(sql`select b.balance from balances b join accounts a on a.id = b.account_id
				where a.name = 'Courtier CSV' and b.date = '2026-09-12'`),
		).toEqual([{ balance: 0 }]);
	});

	it("refuses a trade naming an account the import lacks", async () => {
		await expect(
			failure({ existing: new Map(), newAccounts: [], trades: [trade({ accountKey: "x" })] }),
		).resolves.toBe("CSV_IMPORT_INVALID");
	});

	it("refuses a security stored in another currency than its account", async () => {
		const pea = await openPea({ name: "PEA en euros" });
		await insertSecurity(temp.db, { ticker: "VTI", mic: null, isin: null, currency: "USD" });

		await expect(
			failure({
				existing: new Map([[pea.id, pea]]),
				newAccounts: [],
				trades: [trade({ accountKey: pea.id, ticker: "VTI" })],
			}),
		).resolves.toBe("CSV_IMPORT_INVALID");
		expect(
			await temp.db.all(sql`select e.id from entries e join accounts a on a.id = e.account_id
				where a.name = 'PEA en euros' and e.kind = 'trade'`),
		).toEqual([]);
	});
});
