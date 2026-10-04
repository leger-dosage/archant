import type { TradeInput, TradePatchInput } from "../schemas/trades.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TradeRecord } from "./ledger/trades.ts";

import { formatMicros } from "@archant/data/micros";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { createTradeSchema, updateTradeSchema } from "../schemas/trades.ts";
import { getAccount } from "./accounts.ts";
import {
	deleteTrade as deleteLedgerTrade,
	findTrade,
	listTrades,
	recordTrade,
	updateTrade as updateLedgerTrade,
} from "./ledger/trades.ts";

/** A trade as the API answers it: quantity and price as plain decimal strings. */
export type TradeData = Omit<TradeRecord, "quantity" | "price"> & {
	/** Unsigned: `side` gives the sign. */
	quantity: string;
	/** Per unit, in the account's currency. */
	price: string;
};

export type TradePage = { items: TradeData[]; page: number; pageSize: number; total: number };

const notAnInvestmentAccount = () =>
	new AppError("NOT_AN_INVESTMENT_ACCOUNT", "Only an investment account holds trades.");

function toData({ quantity, price, ...record }: TradeRecord): TradeData {
	return { ...record, quantity: formatMicros(quantity), price: formatMicros(price) };
}

/** The account's currency, refused unless it is an investment account. */
async function investmentCurrency(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (account.type !== "investment") {
		throw notAnInvestmentAccount();
	}

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

async function found(deps: ServiceDeps, id: string): Promise<TradeData> {
	const record = await findTrade(deps, id);

	if (record === null) {
		throw new AppError("NOT_FOUND", "No trade has this id.");
	}

	return toData(record);
}

/**
 * A page of one account's trades, most recent first, only those in
 * `securityId` when it is given. Any account answers, a page with no trade
 * for one that is not an investment account.
 */
export async function listAccountTrades(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number; securityId?: string | undefined },
): Promise<TradePage> {
	await getAccount(deps, accountId);
	const { items, total } = await listTrades(deps, accountId, page);

	return { items: items.map(toData), page: page.page, pageSize: page.pageSize, total };
}

/** Records a buy or a sale on the user's behalf. */
export async function createTrade(
	deps: ServiceDeps,
	accountId: string,
	input: TradeInput,
): Promise<TradeData> {
	const currency = await investmentCurrency(deps, accountId);
	const parsed = createTradeSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { id } = await recordTrade(deps, accountId, parsed.data, { origin: "user" });

	return found(deps, id);
}

/** Changes a trade's side, date, quantity, price or fee on the user's behalf. */
export async function updateTrade(
	deps: ServiceDeps,
	id: string,
	input: TradePatchInput,
): Promise<TradeData> {
	const current = await found(deps, id);
	const currency = await investmentCurrency(deps, current.accountId);
	const parsed = updateTradeSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	await updateLedgerTrade(deps, id, parsed.data, { origin: "user" });

	return found(deps, id);
}

/** Deletes a trade for good. */
export async function deleteTrade(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await deleteLedgerTrade(deps, id, { origin: "user" });

	return { id };
}
