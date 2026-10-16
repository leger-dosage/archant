import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_TYPE_IDS, transactionsMoveBalance } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { settings } from "@archant/data/schema/settings";

import {
	add,
	checking,
	deps,
	history,
	linkedChecking,
	openChecking,
	openLoan,
	setToday,
	snapshot,
	splitInTwo,
	temp,
	transferAmount,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createAccount } from "./accounts.ts";
import {
	balanceOn,
	balancesBetween,
	firstValuationOf,
	openingDateOf,
	recomputeBalances,
	recomputeLinkedBalances,
	recomputeNonCashBalances,
} from "./balances.ts";
import * as shared from "./shared.ts";
import { findSnapshot } from "./snapshots.ts";

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

// A home opened at 300 000 € on 2026-09-01, as Story 28.9's matrix.
const HOME = 30_000_000;

const openHome = () =>
	openChecking({
		name: "Maison",
		type: "property",
		subtype: "single_family_home",
		openingBalance: toMinorUnits(HOME),
	});

const openCar = () =>
	openChecking({
		name: "Voiture",
		type: "vehicle",
		subtype: null,
		openingBalance: toMinorUnits(1_850_000),
	});

const builder = { amount: toMinorUnits(-500_000), label: "Maçon" };

describe("a property's or a vehicle's balances", () => {
	it("keep the value every day a builder is paid from it", async () => {
		const home = await openHome();
		await add(home.id, { ...builder, date: "2026-09-10" });

		const rows = await history(home.id);

		expect(rows.size).toBe(21);
		expect([...rows.values()].every((balance) => balance === HOME)).toBe(true);
	});

	it("move only on a valuation, from its own day, with no gap from the day's lines", async () => {
		const home = await openHome();
		await add(home.id, { ...builder, date: "2026-09-10" });
		await add(home.id, { ...builder, date: "2026-09-15" });

		const id = await snapshot(home.id, "2026-09-15", 32_000_000);

		const rows = await history(home.id);
		expect(rows.get("2026-09-14")).toBe(HOME);
		expect(rows.get("2026-09-15")).toBe(32_000_000);
		expect(rows.get("2026-09-21")).toBe(32_000_000);
		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({
			computed: HOME,
			gap: 2_000_000,
		});
	});

	it("start from zero at a line before the opening", async () => {
		const car = await openCar();
		await add(car.id, { ...builder, date: "2026-08-01" });

		const rows = await history(car.id);

		expect(rows.get("2026-08-01")).toBe(0);
		expect(rows.get("2026-08-31")).toBe(0);
		expect(rows.get("2026-09-01")).toBe(1_850_000);
	});

	it("run to a future line, the value unchanged", async () => {
		const home = await openHome();
		await add(home.id, { ...builder, date: "2026-10-15" });

		const rows = await history(home.id);

		expect([...rows.keys()].at(-1)).toBe("2026-10-15");
		expect(rows.get("2026-10-15")).toBe(HOME);
	});

	it("give the same rows from a later day as from the history start", async () => {
		const home = await openHome();
		await add(home.id, { ...builder, date: "2026-09-10" });
		await snapshot(home.id, "2026-09-15", 32_000_000);
		// Recomputes from 09-12 only.
		await add(home.id, { ...builder, date: "2026-09-12" });
		const incremental = await history(home.id);

		await temp.db.transaction(async (tx) =>
			recomputeBalances(tx, home, "2026-09-01", deps().timeZone),
		);

		await expect(history(home.id)).resolves.toEqual(incremental);
	});

	it("leave a loan's payment lowering its debt", async () => {
		const loan = await openLoan();
		await add(loan.id, { amount: toMinorUnits(100_000), date: "2026-09-10" });

		await expect(balanceOn(deps(), loan.id, "2026-09-10")).resolves.toMatchObject({
			amount: 18_000_000 - 100_000,
		});
	});
});

// Story 28.10's matrix: jewellery worth 5 000 € and 2 000 € owed to a relative.
const RING = 500_000;
const DEBT = 200_000;

const openJewellery = () =>
	openChecking({
		name: "Bijoux",
		type: "other_asset",
		subtype: null,
		openingBalance: toMinorUnits(RING),
		openingDate: "2026-05-01",
	});

const openRelativeLoan = () =>
	openChecking({
		name: "Prêt de Marie",
		type: "other_liability",
		subtype: null,
		openingBalance: toMinorUnits(DEBT),
		openingDate: "2026-05-01",
	});

describe("an other asset's or an other liability's balances", () => {
	it("keep the value when a ring is sold from it", async () => {
		const jewellery = await openJewellery();
		await add(jewellery.id, { amount: toMinorUnits(30_000), label: "Bague", date: "2026-05-10" });

		const rows = await history(jewellery.id);

		expect(rows.get("2026-05-10")).toBe(RING);
		expect([...rows.values()].every((balance) => balance === RING)).toBe(true);
	});

	it("move only on a valuation, from its own day", async () => {
		const jewellery = await openJewellery();
		await add(jewellery.id, { amount: toMinorUnits(30_000), label: "Bague", date: "2026-05-10" });

		await snapshot(jewellery.id, "2026-05-20", 600_000);

		const rows = await history(jewellery.id);
		expect(rows.get("2026-05-19")).toBe(RING);
		expect(rows.get("2026-05-20")).toBe(600_000);
		expect(rows.get("2026-09-21")).toBe(600_000);
	});

	it("keep the debt when a relative is repaid by a transfer, a card payment as Sure's", async () => {
		const relative = await openRelativeLoan();
		const checkingAccount = await openChecking({ name: "Compte courant" });
		const amount = transferAmount();
		const outflow = await add(checkingAccount.id, {
			amount: toMinorUnits(-amount),
			date: "2026-09-10",
		});
		await add(relative.id, { amount: toMinorUnits(amount), date: "2026-09-10" });

		await expect(transferRows(outflow)).resolves.toMatchObject([{ kind: "credit_card_payment" }]);
		const rows = await history(relative.id);
		expect([...rows.values()].every((balance) => balance === DEBT)).toBe(true);
		await expect(balanceOn(deps(), checkingAccount.id, "2026-09-10")).resolves.toMatchObject({
			amount: 123_456 - amount,
		});
	});
});

const claim = () =>
	temp.db.select().from(settings).where(eq(settings.key, "non_cash_balances_recomputed_at")).get();

describe("recomputeNonCashBalances", () => {
	it("rolls its claim back with a failed recompute, so the next start tries again", async () => {
		await openHome();
		vi.spyOn(shared, "oneByOne").mockRejectedValueOnce(new Error("disk full"));

		await expect(recomputeNonCashBalances(deps())).rejects.toThrow("disk full");

		await expect(claim()).resolves.toBeUndefined();
	});

	it("drops the transactions a stored value counted, once, every other account left as it was", async () => {
		const home = await openHome();
		const checkingAccount = await openChecking();
		await add(home.id, { ...builder, date: "2026-09-10" });
		await add(checkingAccount.id, { date: "2026-09-10" });
		// As a release before Story 28.9 stored it: the builder's line counted.
		await temp.db
			.update(balances)
			.set({ balance: toMinorUnits(HOME - 500_000), cash: toMinorUnits(HOME - 500_000) })
			.where(and(eq(balances.accountId, home.id), gte(balances.date, "2026-09-10")));
		const checkingBefore = await history(checkingAccount.id);
		// The file's other tests opened other non-cash accounts too, all recomputed.
		const nonCash = await temp.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(
				inArray(
					accounts.type,
					ACCOUNT_TYPE_IDS.filter((type) => !transactionsMoveBalance(type)),
				),
			);

		await expect(recomputeNonCashBalances(deps())).resolves.toBe(nonCash.length);

		const rows = await temp.db
			.select({ balance: balances.balance, cash: balances.cash })
			.from(balances)
			.where(eq(balances.accountId, home.id));
		expect(rows.every((row) => row.balance === HOME && row.cash === HOME)).toBe(true);
		await expect(history(checkingAccount.id)).resolves.toEqual(checkingBefore);
		await expect(claim()).resolves.toBeDefined();

		// Claimed: a second start recomputes nothing.
		await expect(recomputeNonCashBalances(deps())).resolves.toBe(0);
	});
});

const linkedClaim = () =>
	temp.db.select().from(settings).where(eq(settings.key, "linked_balances_recomputed_at")).get();

describe("recomputeLinkedBalances", () => {
	it("rolls its claim back with a failed recompute, so the next start tries again", async () => {
		await linkedChecking();
		vi.spyOn(shared, "oneByOne").mockRejectedValueOnce(new Error("disk full"));

		await expect(recomputeLinkedBalances(deps())).rejects.toThrow("disk full");

		await expect(linkedClaim()).resolves.toBeUndefined();
	});

	it("ends a linked account's opening day at its amount, once, every other account left as it was", async () => {
		const { account } = await linkedChecking();
		const manual = await openChecking();
		await add(manual.id, { date: "2026-09-10" });
		// As a release before Story 28.17 stored it: the opening day derived
		// backward from the bank's balance.
		await temp.db
			.update(balances)
			.set({ balance: toMinorUnits(100000), cash: toMinorUnits(100000) })
			.where(and(eq(balances.accountId, account.id), eq(balances.date, "2026-09-01")));
		const manualBefore = await history(manual.id);
		const linked = await temp.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(isNotNull(accounts.bankAccountId));

		await expect(recomputeLinkedBalances(deps())).resolves.toBe(linked.length);

		const days = await history(account.id);
		expect(days.get("2026-09-01")).toBe(123456);
		expect(days.get("2026-09-02")).toBe(100000);
		await expect(history(manual.id)).resolves.toEqual(manualBefore);
		await expect(linkedClaim()).resolves.toBeDefined();

		// Claimed: a second start recomputes nothing.
		await expect(recomputeLinkedBalances(deps())).resolves.toBe(0);
	});
});
