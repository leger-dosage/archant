import type { TradeInput } from "./ledger/trades.ts";

import { describe, expect, it } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { securities, securityPrices } from "@archant/data/schema/securities";

import {
	deps,
	openChecking,
	openPea,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../testing/ledger.ts";
import { listPositions, setCostBasis, unlockCostBasis } from "./holdings.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
import { recordTrade } from "./ledger/trades.ts";

useLedgerDatabase();

async function newSecurity(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(securities).values({
		id,
		isin: null,
		ticker: null,
		mic: null,
		name,
		currency: "EUR",
		provider: null,
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

async function buy(accountId: string, securityId: string, fields: Partial<TradeInput> = {}) {
	await recordTrade(
		deps(),
		accountId,
		{
			side: "buy",
			security: { source: "known", id: securityId },
			date: "2026-09-10",
			quantity: toMicros(100_000_000),
			price: toMicros(50_000_000),
			fee: toMinorUnits(0),
			...fields,
		},
		{ origin: "user" },
	);
}

/** A price typed for `securityId` on 2026-09-15, its holders valued at it. */
async function price(securityId: string, value: number) {
	await temp.db.transaction(
		async (tx) => {
			await tx.insert(securityPrices).values({
				securityId,
				date: "2026-09-15",
				price: toMicros(value),
				currency: "EUR",
				source: "manual",
			});
			await revalueHoldings(tx, securityId, "2026-09-15", "Europe/Paris", { origin: "user" });
		},
		{ behavior: "immediate" },
	);
}

/**
 * The matrix's two lines: 100 of A bought at 50 € and now worth 6 000 €, a
 * free share of B worth nothing, and 4 000 € of cash, from an opening of
 * `opening` minor units.
 */
async function twoLines(opening = 900_000) {
	const pea = await openPea({ openingBalance: toMinorUnits(opening) });
	const a = await newSecurity("A");
	const b = await newSecurity("B");
	await buy(pea.id, a);
	await buy(pea.id, b, { quantity: toMicros(10_000_000), price: toMicros(0) });
	await price(a, 60_000_000);

	return { pea, a, b };
}

describe("listPositions", () => {
	it("gives each line its weight, its book value and its gain, then the cash", async () => {
		const { pea, a, b } = await twoLines();

		await expect(listPositions(deps(), pea.id)).resolves.toEqual({
			accountId: pea.id,
			currency: "EUR",
			date: "2026-09-21",
			positions: [
				{
					security: {
						id: a,
						name: "A",
						ticker: null,
						mic: null,
						isin: null,
						provider: null,
						offline: false,
					},
					quantity: "100",
					price: "60",
					priceDate: "2026-09-15",
					amount: 600_000,
					costBasis: "50",
					costBasisLocked: false,
					bookValue: 500_000,
					gain: 100_000,
					gainPercent: "20",
					weight: "60",
				},
				{
					security: {
						id: b,
						name: "B",
						ticker: null,
						mic: null,
						isin: null,
						provider: null,
						offline: false,
					},
					quantity: "10",
					price: "0",
					priceDate: "2026-09-10",
					amount: 0,
					costBasis: "0",
					costBasisLocked: false,
					bookValue: 0,
					gain: 0,
					gainPercent: null,
					weight: "0",
				},
			],
			cash: 400_000,
			cashWeight: "40",
			total: 1_000_000,
		});
	});

	it("leaves every weight out when the total is not above zero", async () => {
		const { pea } = await twoLines(-200_000);

		const holdings = await listPositions(deps(), pea.id);

		expect(holdings.cash).toBe(-700_000);
		expect(holdings.total).toBe(-100_000);
		expect(holdings.cashWeight).toBeNull();
		expect(holdings.positions.map((position) => position.weight)).toEqual([null, null]);
	});

	it("answers an account that never traded, an investment one or not, with its balance as cash", async () => {
		const pea = await openPea();
		await snapshot(pea.id, "2026-09-12", 2_600_000);
		const checking = await openChecking();

		await expect(listPositions(deps(), pea.id)).resolves.toEqual({
			accountId: pea.id,
			currency: "EUR",
			date: null,
			positions: [],
			cash: 2_600_000,
			cashWeight: "100",
			total: 2_600_000,
		});
		await expect(listPositions(deps(), checking.id)).resolves.toMatchObject({
			date: null,
			positions: [],
			cash: 123_456,
		});
		await expect(listPositions(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("setCostBasis and unlockCostBasis", () => {
	it("lock a cost basis typed the French way, answer the position, and unlock it", async () => {
		const { pea, a } = await twoLines();

		await expect(setCostBasis(deps(), pea.id, a, { costBasis: "40,00" })).resolves.toMatchObject({
			security: { id: a },
			costBasis: "40",
			costBasisLocked: true,
			bookValue: 400_000,
			gain: 200_000,
			gainPercent: "50",
		});

		await expect(unlockCostBasis(deps(), pea.id, a)).resolves.toMatchObject({
			costBasis: "50",
			costBasisLocked: false,
			gainPercent: "20",
		});
	});

	it("refuse a cost basis below zero or unread, an account that is not an investment one, and an unknown one", async () => {
		const { pea, a } = await twoLines();
		const checking = await openChecking();

		await expect(setCostBasis(deps(), pea.id, a, { costBasis: "-1" })).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "costBasis", code: "invalid_price" }],
		});
		await expect(setCostBasis(deps(), pea.id, a, { costBasis: "4O" })).rejects.toMatchObject({
			fields: [{ path: "costBasis", code: "invalid_price" }],
		});
		await expect(setCostBasis(deps(), checking.id, a, { costBasis: "40" })).rejects.toMatchObject({
			code: "NOT_AN_INVESTMENT_ACCOUNT",
		});
		await expect(unlockCostBasis(deps(), checking.id, a)).rejects.toMatchObject({
			code: "NOT_AN_INVESTMENT_ACCOUNT",
		});
		await expect(setCostBasis(deps(), "nope", a, { costBasis: "40" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(listPositions(deps(), pea.id)).resolves.toMatchObject({
			positions: [{ costBasisLocked: false }, { costBasisLocked: false }],
		});
	});
});
