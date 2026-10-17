import { and, eq, lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { securities } from "@archant/data/schema/securities";

import { quantity as qty, tradePrice } from "../../testing/decimals.ts";
import {
	add,
	deps,
	history,
	link,
	newBankAccount,
	openChecking,
	openPea,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { setOpeningBalance } from "./opening.ts";
import { recordTrade } from "./trades.ts";

useLedgerDatabase();

/** `set_opening_balance`'s rule, Sure's `OpeningBalanceManager`. */
const user = { origin: "user", rule: "manager" } as const;
/** The « Solde d'ouverture » sheet's rule, Sure's valuation drawer. */
const drawer = { origin: "user", rule: "drawer" } as const;

/** The matrix's account: opened on 2026-01-10 at 1 500,00, with −120,00 on 2026-01-15. */
async function opened() {
	const account = await openChecking({
		openingBalance: toMinorUnits(150000),
		openingDate: "2026-01-10",
	});
	await add(account.id, { date: "2026-01-15", amount: toMinorUnits(-12000) });

	return account;
}

async function anchorOf(accountId: string) {
	return temp.db
		.select({ id: entries.id, date: entries.date, amount: entries.amount, notes: entries.notes })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "opening_anchor")))
		.get();
}

/** A PEA opened on 2026-09-01 at 25 000,00, with a buy of 10 at 612,40 € plus 2,50 € of fees on 2026-09-10. */
async function peaWithBuy() {
	const pea = await openPea();
	const securityId = crypto.randomUUID();
	await temp.db.insert(securities).values({
		id: securityId,
		isin: "FR0000121014",
		ticker: `MC${securityId.slice(0, 8)}.PA`,
		mic: "XPAR",
		name: "LVMH",
		currency: "EUR",
		provider: "yahoo",
		createdAt: 0,
		updatedAt: 0,
	});
	await recordTrade(
		deps(),
		pea.id,
		{
			side: "buy",
			security: { source: "known", id: securityId },
			date: "2026-09-10",
			quantity: qty("10"),
			price: tradePrice("612.4"),
			fee: toMinorUnits(250),
		},
		user,
	);

	return pea;
}

describe("setOpeningBalance", () => {
	it("moves the anchor to an earlier date in place and computes the balances from there", async () => {
		const account = await opened();
		const before = await anchorOf(account.id);

		const result = await setOpeningBalance(
			deps(),
			account.id,
			{ date: "2025-12-01", balance: toMinorUnits(100000), notes: "Relevé d'ouverture" },
			user,
		);

		expect(result).toEqual({
			status: "set",
			changed: true,
			before: { date: "2026-01-10", balance: 150000 },
			after: { date: "2025-12-01", balance: 100000 },
			pinnedBy: null,
		});
		await expect(anchorOf(account.id)).resolves.toEqual({
			id: before?.id,
			date: "2025-12-01",
			amount: 100000,
			notes: "Relevé d'ouverture",
		});
		const days = await history(account.id);
		expect([...days.keys()][0]).toBe("2025-12-01");
		expect(days.get("2026-01-10")).toBe(100000);
		expect(days.get("2026-01-15")).toBe(88000);
		expect(days.get("2026-09-21")).toBe(88000);
	});

	it("deletes the rows before a later date", async () => {
		const account = await opened();

		await setOpeningBalance(
			deps(),
			account.id,
			{ date: "2026-01-12", balance: toMinorUnits(150000) },
			user,
		);

		const days = await history(account.id);
		expect([...days.keys()][0]).toBe("2026-01-12");
		expect(days.get("2026-01-12")).toBe(150000);
		expect(days.get("2026-09-21")).toBe(138000);
	});

	it("keeps the date when none is given", async () => {
		const account = await opened();

		const result = await setOpeningBalance(
			deps(),
			account.id,
			{ balance: toMinorUnits(75000) },
			user,
		);

		expect(result).toMatchObject({ after: { date: "2026-01-10", balance: 75000 } });
		await expect(anchorOf(account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: 75000,
		});
		expect((await history(account.id)).get("2026-09-21")).toBe(63000);
	});

	it("refuses a date on or after the oldest entry under Sure's manager, a snapshot or a pending line included", async () => {
		const account = await opened();
		const before = await history(account.id);

		await expect(
			setOpeningBalance(deps(), account.id, { date: "2026-01-15", balance: toMinorUnits(1) }, user),
		).resolves.toEqual({
			status: "rejected",
			reason: "NOT_BEFORE_OLDEST_ENTRY",
			oldestEntryDate: "2026-01-15",
		});

		await add(account.id, { date: "2026-01-13", amount: toMinorUnits(-100), pending: true });
		await expect(
			setOpeningBalance(deps(), account.id, { date: "2026-01-14", balance: toMinorUnits(1) }, user),
		).resolves.toMatchObject({ oldestEntryDate: "2026-01-13" });

		await snapshot(account.id, "2026-01-11", 150000);
		await expect(
			setOpeningBalance(deps(), account.id, { date: "2026-01-12", balance: toMinorUnits(1) }, user),
		).resolves.toMatchObject({ oldestEntryDate: "2026-01-11" });
		await expect(anchorOf(account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: 150000,
		});
		expect((await history(account.id)).get("2026-01-10")).toBe(before.get("2026-01-10"));
	});

	it("saves a future date under Sure's manager, the balances running to it", async () => {
		const account = await openChecking({ openingDate: "2026-09-01" });

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-10-01", balance: toMinorUnits(50000) },
				user,
			),
		).resolves.toMatchObject({ status: "set", after: { date: "2026-10-01", balance: 50000 } });

		const days = await history(account.id);
		expect([...days.keys()]).toEqual(["2026-10-01"]);
		expect(days.get("2026-10-01")).toBe(50000);
	});

	it("refuses a date more than a year ahead under Sure's manager, as no entry may be dated", async () => {
		const account = await openChecking({ openingDate: "2026-09-01" });

		await expect(
			setOpeningBalance(deps(), account.id, { date: "2027-09-22", balance: toMinorUnits(1) }, user),
		).resolves.toMatchObject({ status: "set" });
		await expect(
			setOpeningBalance(deps(), account.id, { date: "2027-09-23", balance: toMinorUnits(1) }, user),
		).resolves.toEqual({ status: "rejected", reason: "DATE_TOO_LATE" });
	});

	it("checks no unchanged date from the sheet, an amount alone saving on the bank balance's day", async () => {
		const account = await openChecking({ openingDate: "2026-09-21" });
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000);

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-09-21", balance: toMinorUnits(5000) },
				drawer,
			),
		).resolves.toMatchObject({ status: "set", after: { date: "2026-09-21", balance: 5000 } });
	});

	it("checks no unchanged future opening date from the sheet, an assistant having set it", async () => {
		const account = await openChecking({ openingDate: "2026-09-01" });
		await setOpeningBalance(
			deps(),
			account.id,
			{ date: "2026-10-01", balance: toMinorUnits(1000) },
			user,
		);

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-10-01", balance: toMinorUnits(2000) },
				drawer,
			),
		).resolves.toMatchObject({ status: "set", after: { date: "2026-10-01", balance: 2000 } });
	});

	it("checks nothing without a date under Sure's manager, an opening date after a line kept", async () => {
		const account = await opened();
		await setOpeningBalance(
			deps(),
			account.id,
			{ date: "2026-01-20", balance: toMinorUnits(150000) },
			drawer,
		);

		await expect(
			setOpeningBalance(deps(), account.id, { balance: toMinorUnits(100000) }, user),
		).resolves.toMatchObject({ status: "set", after: { date: "2026-01-20", balance: 100000 } });
	});

	it("saves a date after the oldest entry from the sheet, the balances starting at that entry", async () => {
		const account = await opened();

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-01-20", balance: toMinorUnits(100000) },
				drawer,
			),
		).resolves.toMatchObject({ status: "set", changed: true });

		await expect(anchorOf(account.id)).resolves.toMatchObject({
			date: "2026-01-20",
			amount: 100000,
		});
		const days = await history(account.id);
		// Sure's `opening_starting_balances`: zero before the anchor, which sets its own day.
		expect([...days.keys()][0]).toBe("2026-01-15");
		expect(days.get("2026-01-15")).toBe(-12000);
		expect(days.get("2026-01-20")).toBe(100000);
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("refuses a future date from the sheet, as Sure's field's max", async () => {
		const account = await openChecking({ openingDate: "2026-09-01" });

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-09-22", balance: toMinorUnits(1) },
				drawer,
			),
		).resolves.toEqual({ status: "rejected", reason: "DATE_IN_FUTURE" });
	});

	it("refuses from the sheet a day a snapshot or the bank's balance holds, writing nothing", async () => {
		const account = await opened();
		await snapshot(account.id, "2026-02-01", 200000);

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-02-01", balance: toMinorUnits(1) },
				drawer,
			),
		).resolves.toEqual({ status: "rejected", reason: "SNAPSHOT_EXISTS" });
		await expect(anchorOf(account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: 150000,
		});

		const linked = await openChecking();
		const bank = await newBankAccount();
		await link(linked.id, bank.id, 100000);

		await expect(
			setOpeningBalance(
				deps(),
				linked.id,
				{ date: "2026-09-21", balance: toMinorUnits(1) },
				drawer,
			),
		).resolves.toEqual({ status: "rejected", reason: "SNAPSHOT_EXISTS" });
	});

	it("moves a linked account's, its history ending the opening day there, today staying the bank's", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-2000) });
		await link(account.id, bank.id, 100000);

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-08-20", balance: toMinorUnits(50000) },
				user,
			),
		).resolves.toMatchObject({ status: "set", changed: true });

		const days = await history(account.id);
		expect([...days.keys()][0]).toBe("2026-08-20");
		expect(days.get("2026-08-20")).toBe(50000);
		// The day after keeps the bank's side: the gap is Sure's cash adjustment.
		expect(days.get("2026-08-21")).toBe(102000);
		expect(days.get("2026-09-10")).toBe(100000);
		expect(days.get("2026-09-21")).toBe(100000);
	});

	it("names a later snapshot, which keeps today's balance", async () => {
		const account = await opened();
		await snapshot(account.id, "2026-02-01", 200000);

		const result = await setOpeningBalance(
			deps(),
			account.id,
			{ balance: toMinorUnits(100000) },
			user,
		);

		expect(result).toMatchObject({ pinnedBy: "2026-02-01" });
		const days = await history(account.id);
		expect(days.get("2026-01-31")).toBe(88000);
		expect(days.get("2026-09-21")).toBe(200000);
	});

	it("writes nothing on a dry run, and says nothing changed", async () => {
		const account = await opened();
		const before = await history(account.id);

		const result = await setOpeningBalance(
			deps(),
			account.id,
			{ date: "2025-12-01", balance: toMinorUnits(100000) },
			{ ...user, dryRun: true },
		);

		expect(result).toMatchObject({
			status: "set",
			changed: false,
			after: { date: "2025-12-01", balance: 100000 },
		});
		await expect(anchorOf(account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: 150000,
		});
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("answers unchanged when neither the date nor the amount moves", async () => {
		const account = await opened();

		await expect(
			setOpeningBalance(
				deps(),
				account.id,
				{ date: "2026-01-10", balance: toMinorUnits(150000) },
				user,
			),
		).resolves.toMatchObject({ status: "set", changed: false });
	});

	it("computes an investment account's holdings again from the new date", async () => {
		const pea = await peaWithBuy();

		await setOpeningBalance(
			deps(),
			pea.id,
			{ date: "2026-08-01", balance: toMinorUnits(3_000_000) },
			user,
		);

		const days = await history(pea.id);
		expect([...days.keys()][0]).toBe("2026-08-01");
		expect(days.get("2026-09-09")).toBe(3_000_000);
		// The buy's cash, 6 124,00 + 2,50 of fees, out; the holding's 6 124,00 in.
		expect(days.get("2026-09-10")).toBe(2_999_750);
		const held = await temp.db
			.select({ date: holdings.date })
			.from(holdings)
			.where(eq(holdings.accountId, pea.id))
			.orderBy(holdings.date);
		expect(held[0]?.date).toBe("2026-09-10");
		expect(held.at(-1)?.date).toBe("2026-09-21");
	});

	it("leaves no holding row before a later date on an investment account", async () => {
		const pea = await peaWithBuy();

		await setOpeningBalance(
			deps(),
			pea.id,
			{ date: "2026-09-05", balance: toMinorUnits(2_500_000) },
			user,
		);

		const early = await temp.db
			.select({ date: holdings.date })
			.from(holdings)
			.where(and(eq(holdings.accountId, pea.id), lt(holdings.date, "2026-09-05")));
		expect(early).toEqual([]);
		const days = await history(pea.id);
		expect([...days.keys()][0]).toBe("2026-09-05");
		expect(days.get("2026-09-10")).toBe(2_499_750);
	});
});
