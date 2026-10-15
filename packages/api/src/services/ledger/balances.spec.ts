import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";

import {
	add,
	checking,
	deps,
	linkedChecking,
	openChecking,
	setToday,
	snapshot,
	splitInTwo,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createAccount } from "./accounts.ts";
import { balanceOn, balancesBetween, firstValuationOf, openingDateOf } from "./balances.ts";

useLedgerDatabase();

describe("balanceOn", () => {
	it("carries the last stored day forward past today", async () => {
		setToday("2026-09-21T10:00:00Z");
		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-12-31")).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
	});

	it("is null before the opening date", async () => {
		setToday("2026-09-21T10:00:00Z");
		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-08-31")).resolves.toBeNull();
	});
});

describe("balancesBetween", () => {
	it("returns each day of the range, both ends included, oldest first", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10" });

		await expect(balancesBetween(deps(), account.id, "2026-09-09", "2026-09-11")).resolves.toEqual([
			{ date: "2026-09-09", balance: 123456 },
			{ date: "2026-09-10", balance: 119166 },
			{ date: "2026-09-11", balance: 119166 },
		]);
	});

	it("leaves out the rows past the range, such as those of a future transaction", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-10-01" });

		const rows = await balancesBetween(deps(), account.id, "2026-09-01", "2026-09-21");

		expect(rows).toHaveLength(21);
		expect(rows.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("carries the last write's balance to today when nothing was written since", async () => {
		const account = await openChecking();
		setToday("2026-10-21T10:00:00Z");

		const rows = await balancesBetween(deps(), account.id, "2026-09-21", "2026-10-21");

		expect(rows).toHaveLength(31);
		expect(rows[0]).toEqual({ date: "2026-09-21", balance: 123456 });
		expect(rows.at(-1)).toEqual({ date: "2026-10-21", balance: 123456 });
	});

	it("is empty for an unknown account", async () => {
		await expect(balancesBetween(deps(), "nope", "2026-09-01", "2026-09-21")).resolves.toEqual([]);
	});
});

describe("openingDateOf", () => {
	it("returns the opening anchor's date, or null for an unknown account", async () => {
		const account = await openChecking();

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(openingDateOf(deps(), "nope")).resolves.toBeNull();
	});
});

describe("firstValuationOf", () => {
	it("returns the opening anchor's amount, or null for an unknown account", async () => {
		const account = await openChecking();

		await expect(firstValuationOf(deps(), account.id)).resolves.toBe(123456);
		await expect(firstValuationOf(deps(), "nope")).resolves.toBeNull();
	});

	it("picks the one written first of two valuations on the earliest day", async () => {
		const account = await openChecking();
		// The ledger keeps one snapshot a day and folds one on the opening date
		// into the anchor; only a bank's anchor beside a snapshot shares a day,
		// written here directly, the ids sorting against the creation order.
		const valuation = (
			id: string,
			kind: "reconciliation" | "current_anchor",
			amount: number,
			createdAt: number,
		) => ({
			id,
			accountId: account.id,
			kind: "valuation" as const,
			valuationKind: kind,
			date: "2026-08-01",
			amount,
			currency: "EUR",
			createdAt,
			updatedAt: createdAt,
		});
		await temp.db
			.insert(entries)
			.values([
				valuation("a-later", "reconciliation", 800, 2_000),
				valuation("z-first", "current_anchor", 700, 1_000),
			]);

		await expect(firstValuationOf(deps(), account.id)).resolves.toBe(700);
	});

	it("picks the earliest by date, whatever was written first", async () => {
		const account = await openChecking();
		await snapshot(account.id, "2026-09-15", 900);
		await snapshot(account.id, "2026-08-20", 700);

		await expect(firstValuationOf(deps(), account.id)).resolves.toBe(700);
	});
});

describe("balances and a split", () => {
	it("counts a split's money once when a later write recomputes over it, forward", async () => {
		const account = await openChecking();
		const { amount } = await splitInTwo(account.id, { date: "2026-09-10" });

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1_000) });

		await expect(balanceOn(deps(), account.id, "2026-09-10")).resolves.toMatchObject({
			amount: 123456 - 1_000 + amount,
		});
	});

	it("counts a split's money once when a later write recomputes over it, backward", async () => {
		const { account } = await linkedChecking(100_000);
		const { amount } = await splitInTwo(account.id, { date: "2026-09-10" });
		const before = await balanceOn(deps(), account.id, "2026-09-09");

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1_000) });

		await expect(balanceOn(deps(), account.id, "2026-09-09")).resolves.toEqual(before);
		await expect(balanceOn(deps(), account.id, "2026-09-10")).resolves.toMatchObject({
			amount: (before?.amount ?? 0) + amount,
		});
	});
});
