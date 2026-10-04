import type { IsoDate } from "../domain/dates.ts";
import type { CostBasisInput } from "../schemas/holdings.ts";
import type { ServiceDeps } from "./deps.ts";
import type { CurrentHolding } from "./ledger/holdings.ts";

import type { Micros } from "@archant/data/micros";
import { formatMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { today } from "../domain/dates.ts";
import { positionFigures, weightOf } from "../domain/holdings/positions.ts";
import { validationError } from "../lib/zod-error.ts";
import { costBasisSchema } from "../schemas/holdings.ts";
import { getAccount } from "./accounts.ts";
import {
	currentHoldings,
	lockCostBasis,
	notHeld,
	unlockCostBasis as unlockLedgerCostBasis,
} from "./ledger/holdings.ts";

/**
 * One position as the API answers it, Sure's holding row: quantities, prices
 * and percentages as plain decimal strings, amounts in minor units of the
 * account's currency.
 */
export type PositionData = {
	security: CurrentHolding["security"];
	quantity: string;
	/** Per unit, in the account's currency. */
	price: string;
	priceDate: IsoDate;
	/** The value: `quantity × price`. */
	amount: MinorUnits;
	/** « PRU », per unit: the lock's when `costBasisLocked`. */
	costBasis: string | null;
	costBasisLocked: boolean;
	bookValue: MinorUnits | null;
	/** « +/- value latente ». */
	gain: MinorUnits | null;
	/** Percent of the book value. */
	gainPercent: string | null;
	/** Percent of `total`; `null` when the total is not above zero. */
	weight: string | null;
};

export type HoldingsData = {
	accountId: string;
	currency: string;
	/** The holdings' day; `null` for an account that has never traded. */
	date: IsoDate | null;
	/** By value, then name. */
	positions: PositionData[];
	cash: MinorUnits;
	cashWeight: string | null;
	/** `cash` plus every position's value: the account's balance. */
	total: MinorUnits;
};

const percent = (value: Micros | null) => (value === null ? null : formatMicros(value));

/**
 * The positions of an account today, in `APP_TIMEZONE`, as Sure's holdings
 * table: each security held with its weight, its « PRU », its value and its
 * gain, then the cash. Any account answers; one that has never traded holds
 * nothing and its balance is all cash.
 */
export async function listPositions(deps: ServiceDeps, accountId: string): Promise<HoldingsData> {
	const account = await getAccount(deps, accountId);
	const held = await currentHoldings(deps.db, accountId, today(deps.timeZone));
	const total = toMinorUnits(
		held.holdings.reduce((sum, holding) => sum + holding.amount, Number(held.cash)),
	);

	return {
		accountId,
		currency: account.currency,
		date: held.date,
		positions: held.holdings.map((holding) => {
			const figures = positionFigures(holding, total, account.currency);

			return {
				security: holding.security,
				quantity: formatMicros(holding.quantity),
				price: formatMicros(holding.price),
				priceDate: holding.priceDate,
				amount: holding.amount,
				costBasis: holding.costBasis === null ? null : formatMicros(holding.costBasis),
				costBasisLocked: holding.costBasisLocked,
				bookValue: figures.bookValue,
				gain: figures.gain,
				gainPercent: percent(figures.gainPercent),
				weight: percent(figures.weight),
			};
		}),
		cash: held.cash,
		cashWeight: percent(weightOf(held.cash, total)),
		total,
	};
}

/** The account's position in `securityId` today. */
async function positionOf(
	deps: ServiceDeps,
	accountId: string,
	securityId: string,
): Promise<PositionData> {
	const { positions } = await listPositions(deps, accountId);
	const position = positions.find(({ security }) => security.id === securityId);

	if (position === undefined) {
		throw notHeld();
	}

	return position;
}

/**
 * Sets a position's cost basis by hand and locks it, as Sure's holding
 * drawer, on the user's behalf. Answers the position.
 */
export async function setCostBasis(
	deps: ServiceDeps,
	accountId: string,
	securityId: string,
	input: CostBasisInput,
): Promise<PositionData> {
	const parsed = costBasisSchema.safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	await lockCostBasis(deps, accountId, securityId, parsed.data.costBasis, { origin: "user" });

	return positionOf(deps, accountId, securityId);
}

/** Unlocks a position's cost basis, the calculated one back. Answers the position. */
export async function unlockCostBasis(
	deps: ServiceDeps,
	accountId: string,
	securityId: string,
): Promise<PositionData> {
	await unlockLedgerCostBasis(deps, accountId, securityId, { origin: "user" });

	return positionOf(deps, accountId, securityId);
}
