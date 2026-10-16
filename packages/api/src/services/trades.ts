import type { TradeInput, TradePatchInput } from "../schemas/trades.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TradeRecord } from "./ledger/trades.ts";

import { holdsSecurities, supportsTrades } from "@archant/data/account-types";
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
	tradesNotSupported,
	updateTrade as updateLedgerTrade,
} from "./ledger/trades.ts";

/**
 * A trade as the API answers it: quantity and price as their canonical
 * decimal text, Sure's decimal, never a JSON number that would round them.
 */
export type TradeData = TradeRecord;

export type TradePage = { items: TradeData[]; page: number; pageSize: number; total: number };

/**
 * The account's currency, refused unless the account takes new trades,
 * Sure's `supports_trades?`, or with `held`, unless it holds securities,
 * which is all editing a trade asks (AD-22).
 */
export async function tradeCurrency(
	deps: ServiceDeps,
	accountId: string,
	{ held = false }: { held?: boolean } = {},
): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (held ? !holdsSecurities(account.type) : !supportsTrades(account)) {
		throw tradesNotSupported();
	}

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

/** One trade as the API answers it; `NOT_FOUND` when the id names none. */
export async function getTrade(deps: ServiceDeps, id: string): Promise<TradeData> {
	const record = await findTrade(deps, id);

	if (record === null) {
		throw new AppError("NOT_FOUND", "No trade has this id.");
	}

	return record;
}

/**
 * A page of one account's trades, most recent first, only those in
 * `securityId` when it is given. Any account answers, a page with no trade
 * for one that holds no securities.
 */
export async function listAccountTrades(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number; securityId?: string | undefined },
): Promise<TradePage> {
	await getAccount(deps, accountId);
	const { items, total } = await listTrades(deps, accountId, page);

	return { items, page: page.page, pageSize: page.pageSize, total };
}

/** Records a buy, a sale, a dividend or interest on the user's behalf. */
export async function createTrade(
	deps: ServiceDeps,
	accountId: string,
	input: TradeInput,
): Promise<TradeData> {
	const currency = await tradeCurrency(deps, accountId);
	const parsed = createTradeSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { id } = await recordTrade(deps, accountId, parsed.data, { origin: "user" });

	return getTrade(deps, id);
}

/**
 * Changes a trade's date and figures on the user's behalf: a buy or a
 * sale's side, quantity, price and fee, an income's amount.
 */
export async function updateTrade(
	deps: ServiceDeps,
	id: string,
	input: TradePatchInput,
): Promise<TradeData> {
	const current = await getTrade(deps, id);
	const currency = await tradeCurrency(deps, current.accountId, { held: true });
	const parsed = updateTradeSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	await updateLedgerTrade(deps, id, parsed.data, { origin: "user" });

	return getTrade(deps, id);
}

/** Deletes a trade for good; a converted one gives its transaction back. */
export async function deleteTrade(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await deleteLedgerTrade(deps, id, { origin: "user" });

	return { id };
}
