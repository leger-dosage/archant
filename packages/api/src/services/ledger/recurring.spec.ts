import { describe, expect, it } from "vitest";

import { deps, matchedPair, splitInTwo, useLedgerDatabase } from "../../testing/ledger.ts";
import { matchableTransactions, paymentTransaction } from "./recurring.ts";

useLedgerDatabase();

describe("matchableTransactions", () => {
	it("reads a window's transactions, marking split parents and transfer sides", async () => {
		const pair = await matchedPair("2026-09-12");
		const split = await splitInTwo(pair.checking.id, { date: "2026-09-13" });

		const rows = await matchableTransactions(deps().db, { start: "2026-09-12", end: "2026-09-13" });

		expect(rows.find((row) => row.id === pair.outflow)).toMatchObject({
			splitParent: false,
			transfer: { kind: "internal_move" },
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
	it("reads a transaction's amount, date, currency and label, null for no such transaction", async () => {
		const pair = await matchedPair("2026-09-20");

		await expect(paymentTransaction(deps().db, pair.outflow)).resolves.toEqual({
			id: pair.outflow,
			amount: -pair.amount,
			date: "2026-09-20",
			currency: "EUR",
			label: "Boulangerie",
			splitParent: false,
		});
		await expect(paymentTransaction(deps().db, "nope")).resolves.toBeNull();
	});
});
