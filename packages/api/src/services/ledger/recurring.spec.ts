import { describe, expect, it } from "vitest";

import { deps, matchedPair, splitInTwo, useLedgerDatabase } from "../../testing/ledger.ts";
import {
	matchableTransactions,
	paymentTransaction,
	transferDestinations,
	transferPair,
} from "./recurring.ts";

useLedgerDatabase();

describe("matchableTransactions", () => {
	it("reads a window's transactions, marking split parents and transfer sides, an outflow with the account it pays into", async () => {
		const pair = await matchedPair("2026-09-12");
		const split = await splitInTwo(pair.checking.id, { date: "2026-09-13" });

		const rows = await matchableTransactions(deps().db, { start: "2026-09-12", end: "2026-09-13" });

		expect(rows.find((row) => row.id === pair.outflow)).toMatchObject({
			splitParent: false,
			transfer: { kind: "internal_move", intoAccountId: pair.livret.id },
		});
		expect(rows.find((row) => row.id === pair.inflow)).toMatchObject({
			transfer: { kind: "internal_move", intoAccountId: null },
		});
		expect(rows.find((row) => row.id === split.parent)).toMatchObject({
			splitParent: true,
			transfer: null,
			label: "HYPERMARCHE",
			pending: false,
			// A split excludes its parent (AD-20).
			excluded: true,
		});
		expect(rows.find((row) => row.id === split.food)).toMatchObject({ splitParent: false });
		await expect(paymentTransaction(deps().db, split.parent)).resolves.toMatchObject({
			splitParent: true,
		});
		await expect(
			matchableTransactions(deps().db, { start: "2026-09-14", end: "2026-09-19" }),
		).resolves.toEqual([]);
	});
});

describe("paymentTransaction", () => {
	it("reads a transaction's account, amount, date, currency, label and transfer side, null for no such transaction", async () => {
		const pair = await matchedPair("2026-09-20");

		await expect(paymentTransaction(deps().db, pair.outflow)).resolves.toEqual({
			id: pair.outflow,
			accountId: pair.checking.id,
			amount: -pair.amount,
			date: "2026-09-20",
			currency: "EUR",
			label: "Boulangerie",
			splitParent: false,
			transfer: { kind: "internal_move", intoAccountId: pair.livret.id },
		});
		await expect(paymentTransaction(deps().db, "nope")).resolves.toBeNull();
	});
});

describe("transferPair and transferDestinations", () => {
	it("read a transfer's outflow and the account it pays into", async () => {
		const pair = await matchedPair("2026-09-20");

		await expect(transferPair(deps().db, pair.transfer.id)).resolves.toEqual({
			outflow: {
				accountId: pair.checking.id,
				amount: -pair.amount,
				currency: "EUR",
				date: "2026-09-20",
				label: "Boulangerie",
			},
			destination: { id: pair.livret.id, name: pair.livret.name, type: "depository" },
		});
		await expect(transferPair(deps().db, "nope")).resolves.toBeNull();
		expect((await transferDestinations(deps().db, "2026-09-20")).get(pair.outflow)).toBe(
			pair.livret.id,
		);
		expect((await transferDestinations(deps().db, "2026-09-21")).has(pair.outflow)).toBe(false);
	});
});
