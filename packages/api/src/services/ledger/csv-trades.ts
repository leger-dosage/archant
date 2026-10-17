import type { IsoDate } from "../../domain/dates.ts";
import type { PlanAccount, PlanSecurity } from "../sure-import-plan.ts";
import type { Transaction } from "./shared.ts";
import type { ImportedAccount } from "./sure-import.ts";

import { and, asc, sql } from "drizzle-orm";

import type { Quantity, TradePrice } from "@archant/data/decimals";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import type { NewEntry } from "@archant/data/types";

import { minDate } from "../../domain/dates.ts";
import { AppError } from "../../lib/errors.ts";
import { recomputeBalances } from "./balances.ts";
import { oneByOne } from "./shared.ts";
import { clock, insertAll, insertSureAccounts, securityResolver } from "./sure-import.ts";

// What « Importer les investissements » writes to the ledger's tables (AD-2):
// Sure's `TradeImport#import!`, its trades in one bulk insert, then each
// account's balances and holdings recomputed once, as Sure's sync after it.

/** One buy or sale of the file, its quantity signed and its amount computed (AD-22). */
export type CsvTrade = {
	/** An existing account's id, or the `sourceId` of a new one. */
	accountKey: string;
	date: IsoDate;
	/** Upper case, as the securities' unique index compares it. */
	ticker: string;
	mic: string | null;
	quantity: Quantity;
	price: TradePrice;
	amount: MinorUnits;
};

/** A listing by its ticker and MIC, as Sure's `Security::Resolver` finds one. */
export function listingOf(ticker: string, mic: string | null): PlanSecurity {
	return {
		key: JSON.stringify(["listing", ticker, mic]),
		ticker,
		mic,
		isin: null,
		name: ticker,
		byHand: false,
	};
}

/**
 * The stored listing a row names, as Sure's `Security::Resolver#exact_match_from_db`
 * finds it: by upper-cased ticker and MIC, or by ticker alone, the first one,
 * when the row gives no MIC (`match_blank_mic: false`). `trades.csv` writes no
 * MIC, so its rows find the listings they came from.
 */
export async function storedListing(tx: Pick<Transaction, "select">, security: PlanSecurity) {
	return tx
		.select({ id: securities.id, currency: securities.currency })
		.from(securities)
		.where(
			and(
				sql`upper(${securities.ticker}) = ${security.ticker}`,
				security.mic === null ? undefined : sql`coalesce(${securities.mic}, '') = ${security.mic}`,
			),
		)
		.orderBy(asc(securities.createdAt), asc(securities.id))
		.get();
}

/**
 * Creates the accounts « Ajouter comme nouveau compte » asked for, then
 * writes every trade, fee zero, its security found or created in its
 * account's currency, then recomputes each account's balances and holdings
 * once from its oldest new day. Inside the caller's immediate transaction,
 * so nothing is written unless everything is.
 */
export async function insertCsvTrades(
	tx: Transaction,
	input: {
		existing: ReadonlyMap<string, ImportedAccount>;
		newAccounts: readonly PlanAccount[];
		trades: readonly CsvTrade[];
	},
	options: { now: number; timeZone: string },
): Promise<void> {
	const created = await insertSureAccounts(tx, input.newAccounts, options.now);
	const accounts = new Map([...input.existing, ...created]);
	const stamp = clock(options.now + input.newAccounts.length);
	const resolve = securityResolver(
		tx,
		stamp,
		() =>
			new AppError(
				"CSV_IMPORT_INVALID",
				"A security of the file is priced in another currency than its account.",
			),
		storedListing,
	);
	const entryRows: NewEntry[] = [];
	const tradeRows: (typeof trades.$inferInsert)[] = [];
	// Each account written to, from its oldest new day; a new one has a trade, its opening the day before.
	const oldest = new Map<string, { account: ImportedAccount; start: IsoDate }>();

	await oneByOne(input.trades, async (trade) => {
		const account = accounts.get(trade.accountKey);

		if (account === undefined) {
			throw new AppError("CSV_IMPORT_INVALID", "A trade names an account the import lacks.");
		}

		const id = crypto.randomUUID();
		const at = stamp();
		const start = oldest.get(trade.accountKey)?.start ?? trade.date;

		oldest.set(trade.accountKey, { account, start: minDate(start, trade.date) });
		entryRows.push({
			id,
			accountId: account.id,
			kind: "trade",
			date: trade.date,
			amount: trade.amount,
			currency: account.currency,
			createdAt: at,
			updatedAt: at,
		});
		tradeRows.push({
			entryId: id,
			securityId: await resolve(listingOf(trade.ticker, trade.mic), account.currency),
			incomeKind: null,
			quantity: trade.quantity,
			price: trade.price,
			fee: toMinorUnits(0),
		});
	});

	await insertAll(entryRows, (chunk) => tx.insert(entries).values(chunk));
	await insertAll(tradeRows, (chunk) => tx.insert(trades).values(chunk));

	await oneByOne([...oldest.values()], async ({ account, start }) =>
		recomputeBalances(tx, account, start, options.timeZone),
	);
}
