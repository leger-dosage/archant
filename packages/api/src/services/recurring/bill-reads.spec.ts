import { describe, expect, it } from "vitest";

import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addMonths } from "../../domain/dates.ts";
import { AppError } from "../../lib/errors.ts";
import {
	addRows,
	declareMortgage,
	deps,
	occurrencesOf,
	openAccount,
	setToday,
	temp,
	useRecurringDatabase,
	withMerchant,
} from "../../testing/recurring.ts";
import { oneByOne } from "../ledger/shared.ts";
import { billHistory, findBills } from "./bill-reads.ts";
import { declareBill, editBill } from "./bills.ts";
import { generateOccurrences } from "./occurrences.ts";
import { addPayment, editOccurrence, markPaid, skipOccurrence } from "./payments.ts";
import { setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

const ACTIVE = { status: "active" } as const;

const bill = (accountId: string, name: string, firstDueOn: string, amount = "20,00") =>
	declareBill(deps(), {
		kind: "bill",
		name,
		amount,
		accountId,
		firstDueOn,
		frequency: { preset: "monthly" },
	});

const names = async (query: Parameters<typeof findBills>[1]) =>
	(await findBills(deps(), query)).bills.map((found) => found.displayName);

describe("findBills", () => {
	it("dates a bill by its open occurrence, postponed or not, else by its next expected date", async () => {
		const accountId = await openAccount();
		const water = await bill(accountId, "Eau", "2026-10-02");
		const [first] = await occurrencesOf(water.id);
		await editOccurrence(deps(), first!.id, { snoozedUntil: "2026-10-20" });
		await bill(accountId, "Gaz", "2026-10-10");
		await temp.db.insert(recurringTransactions).values({
			id: "bare",
			accountId,
			labelKey: "box",
			label: "BOX",
			amount: -2999,
			currency: "EUR",
			expectedDayOfMonth: 14,
			lastOccurrenceDate: "2026-09-14",
			nextExpectedDate: "2026-10-14",
			occurrenceCount: 3,
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});

		const { bills } = await findBills(deps(), ACTIVE);

		expect(bills.map((found) => [found.displayName, found.nextDueDate])).toEqual([
			["Gaz", "2026-10-10"],
			["BOX", "2026-10-14"],
			["Eau", "2026-10-20"],
		]);
		expect(bills[1]?.currentOccurrence).toBeNull();
	});

	it("keeps overdue bills within any range, searches the merchant, and reads payment states", async () => {
		const accountId = await openAccount();
		const late = await bill(accountId, "Retard", "2026-09-10");
		const paid = await bill(accountId, "Payée", "2026-09-19");
		await markPaid(deps(), (await occurrencesOf(paid.id))[0]!.id);
		const skipped = await bill(accountId, "Sautée", "2026-09-20");
		await skipOccurrence(deps(), (await occurrencesOf(skipped.id))[0]!.id);
		const [row = ""] = await addRows(accountId, [{ date: "2026-09-01", amount: -2000 }]);
		await withMerchant([row]);
		const detected = await declareBill(deps(), {
			kind: "bill",
			name: "Crédit",
			amount: "20,00",
			accountId,
			firstDueOn: "2026-12-01",
			frequency: { preset: "monthly" },
			entryId: row,
		});
		await editBill(deps(), detected.id, { name: null });

		await expect(names({ ...ACTIVE, dueWithinDays: 1 })).resolves.toEqual(["Retard"]);
		await expect(names({ ...ACTIVE, search: "agricole" })).resolves.toEqual(["Crédit Agricole"]);
		await expect(names({ ...ACTIVE, paymentState: "overdue" })).resolves.toEqual(["Retard"]);
		// A paid occurrence leaves the next one current.
		await expect(names({ ...ACTIVE, paymentState: "paid" })).resolves.toEqual([]);
		await expect(names({ ...ACTIVE, paymentState: "upcoming" })).resolves.toEqual([
			"Payée",
			"Sautée",
			"Crédit Agricole",
		]);
		expect(late.status).toBe("active");
	});

	it("leaves a paused bill out of every schedule state and the overdue count, reading it paused", async () => {
		const accountId = await openAccount();
		const late = await bill(accountId, "Gaz", "2026-09-10");
		// Pausing drops future occurrences: both left are past, the second within its grace days.
		const near = await bill(accountId, "Box", "2026-09-19");
		await oneByOne([late, near], (series) => setRecurringStatus(deps(), series.id, "inactive"));
		const PAUSED = { status: "paused" } as const;

		await expect(names({ ...PAUSED, paymentState: "overdue" })).resolves.toEqual([]);
		await expect(names({ ...PAUSED, paymentState: "due" })).resolves.toEqual([]);
		await expect(names({ ...PAUSED, paymentState: "upcoming" })).resolves.toEqual([]);

		const found = await findBills(deps(), PAUSED);

		expect(found.bills.map((one) => one.currentOccurrence?.state)).toEqual(["paused", "paused"]);
		expect(found.totals.overdueCount).toBe(0);
		await expect(billHistory(deps(), late.id)).resolves.toMatchObject({
			open: [{ dueOn: "2026-09-10", state: "paused" }],
		});
	});

	it("reads a paid occurrence when no open one follows, and a series without occurrences in no state", async () => {
		const accountId = await openAccount();
		const once = await bill(accountId, "Unique", "2026-09-19");
		await editBill(deps(), once.id, { billType: "installment", endAfterCount: "1" });
		await markPaid(deps(), (await occurrencesOf(once.id))[0]!.id);
		const paused = await bill(accountId, "Pause", "2026-10-01");
		await setRecurringStatus(deps(), paused.id, "inactive");

		await expect(names({ status: "all", paymentState: "paid" })).resolves.toEqual(["Unique"]);
		await expect(names({ status: "paused", paymentState: "upcoming" })).resolves.toEqual([]);
		await expect(names({ status: "paused" })).resolves.toEqual(["Pause"]);
	});

	it("totals the active bills but incomes in the reporting currency, naming each other account once", async () => {
		const accountId = await openAccount();
		const dollars = await openAccount("USD");
		await bill(accountId, "Loyer", "2026-10-01", "800,00");
		await bill(accountId, "Retard", "2026-09-10");
		await bill(dollars, "Hosting", "2026-10-03", "12.00");
		await bill(dollars, "Domain", "2026-10-04", "1.00");
		await declareBill(deps(), {
			kind: "income",
			name: "Salaire",
			amount: "2 500,00",
			accountId,
			firstDueOn: "2026-09-28",
			frequency: { preset: "monthly" },
		});

		await expect(findBills(deps(), ACTIVE)).resolves.toMatchObject({
			totals: {
				currency: "EUR",
				activeCount: 5,
				overdueCount: 1,
				activeMonthly: 82_000,
				leftOut: [{ id: dollars }],
			},
		});
		await expect(findBills(deps(), { status: "ended" })).resolves.toMatchObject({
			bills: [],
			totals: { activeCount: 0, activeMonthly: 0, leftOut: [] },
		});
	});

	it("sums the active bills' monthly equivalents unrounded, then rounds once", async () => {
		const accountId = await openAccount();
		const weekly = async (name: string, amount: string) => {
			const created = await bill(accountId, name, "2026-09-28", amount);
			await editBill(deps(), created.id, { frequency: { preset: "weekly", weekday: "1" } });
		};
		await weekly("Panier", "10,00");
		await weekly("Pain", "5,01");

		// 43,482… + 21,784… = 65,266…: 65,27 €, where 43,48 + 21,78 would read 65,26 €.
		const found = await findBills(deps(), ACTIVE);

		expect(found.bills.map((one) => one.monthlyEquivalent).toSorted((a, b) => a - b)).toEqual([
			2178, 4348,
		]);
		expect(found.totals.activeMonthly).toBe(6527);
	});
});

describe("billHistory", () => {
	it("gives twelve closed occurrences at most, latest first, with the count of every one", async () => {
		const accountId = await openAccount();
		setToday("2025-06-01");
		const mortgage = await declareMortgage(accountId, { firstDueOn: "2025-06-05" });

		await oneByOne(
			Array.from({ length: 14 }, (_, month) => addMonths("2025-06-05", month)),
			async (due) => {
				setToday(due);
				await temp.db.transaction((tx) => generateOccurrences(tx, due));
				const open = (await occurrencesOf(mortgage.id)).find((row) => row.dueOn === due)!;
				await markPaid(deps(), open.id, due);
			},
		);

		setToday("2026-09-21");
		const history = await billHistory(deps(), mortgage.id);

		expect(history.closedCount).toBe(14);
		expect(history.closed).toHaveLength(12);
		expect(history.closed[0]?.dueOn).toBe("2026-07-05");
		expect(history.closed.at(-1)?.dueOn).toBe("2025-08-05");
		expect(history.bill.schedulePinned).toBe(false);
	});

	it("names the transaction a payment came from, and says when the owner pinned the schedule", async () => {
		const accountId = await openAccount();
		const mortgage = await declareMortgage(accountId, { firstDueOn: "2026-09-05" });
		const [entry = ""] = await addRows(accountId, [{ date: "2026-09-05", amount: -57_129 }]);
		const [open] = await occurrencesOf(mortgage.id);
		await addPayment(deps(), open!.id, { entryId: entry });
		await editBill(deps(), mortgage.id, { frequency: { preset: "monthly", dayOfMonth: "6" } });

		const history = await billHistory(deps(), mortgage.id);

		expect(history.closed).toEqual([
			{
				dueOn: "2026-09-05",
				effectiveDueOn: "2026-09-05",
				state: "paid",
				status: "paid",
				expected: 57_129,
				paid: 57_129,
				remaining: 0,
				currency: "EUR",
				payments: [
					{
						amount: 57_129,
						paidOn: "2026-09-05",
						source: "user_confirmed",
						state: "confirmed",
						transactionId: entry,
						transactionLabel: "Prêt immobilier",
					},
				],
			},
		]);
		expect(history.bill.schedulePinned).toBe(true);
		expect(history.nextDueDates).toEqual(["2026-10-06", "2026-11-06", "2026-12-06"]);
	});

	it("answers NOT_FOUND for an id no series has", async () => {
		await expect(billHistory(deps(), "nope")).rejects.toBeInstanceOf(AppError);
	});
});
