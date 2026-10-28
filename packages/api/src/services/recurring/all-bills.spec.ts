import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { merchants } from "@archant/data/schema/merchants";
import {
	recurringAllocations,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { account, addRows, bill, firstOf, query, refusal, stored } from "../../testing/bills.ts";
import { deps, occurrencesOf, temp, useRecurringDatabase } from "../../testing/recurring.ts";
import { updateTransaction } from "../ledger/edits.ts";
import { oneByOne } from "../ledger/shared.ts";
import { allBills, billDetail } from "./all-bills.ts";
import { billsOverview } from "./bill-overview.ts";
import { declareBill, editBill } from "./bills.ts";
import { addPayment, editOccurrence, markPaid } from "./payments.ts";
import { runRecurring } from "./pipeline.ts";
import { addRecurringFromEntry, setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

/** A recorded price change, as detection writes one. */
async function priceChange(
	seriesId: string,
	effectiveOn: string,
	previousAmount: number,
	newAmount: number,
) {
	const now = Date.now();

	await temp.db.insert(recurringPriceChanges).values({
		id: `change-${seriesId}-${effectiveOn}`,
		recurringTransactionId: seriesId,
		effectiveOn,
		previousAmount,
		newAmount,
		currency: "EUR",
		createdAt: now,
		updatedAt: now,
	});
}

/** Ends a series and drops its occurrences, as a dismissed suggestion has none. */
async function endWithoutOccurrences(seriesId: string) {
	await temp.db
		.update(recurringTransactions)
		.set({ status: "ended" })
		.where(eq(recurringTransactions.id, seriesId));
	await temp.db
		.delete(recurringOccurrences)
		.where(eq(recurringOccurrences.recurringTransactionId, seriesId));
}

const names = (rows: readonly { name: string | null }[]) => rows.map((row) => row.name);

const filtered = async (status: Parameters<typeof allBills>[1]["status"]) =>
	names((await allBills(deps(), query({ status }))).bills);

const searched = async (q: string) =>
	(await allBills(deps(), query({ q }))).bills.map((row) => row.name ?? row.merchantName);

const subscribe = async (accountOf: string, name: string, amount: string) => {
	const created = await declareBill(deps(), bill(accountOf, { name, amount }));
	await editBill(deps(), created.id, { billType: "subscription" });

	return created;
};

describe("allBills", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
	});

	it("lists every series but the suggestions, active, then ended, then paused, each by next date", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "LOYER", -80_000);
		await runRecurring(deps(), { backfill: true });
		const water = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "90,00", firstDueOn: "2026-10-20" }),
		);
		await editBill(deps(), water.id, { frequency: { preset: "quarterly" } });
		await declareBill(deps(), bill(accountId, { name: "Internet", firstDueOn: "2026-10-12" }));
		const gas = await declareBill(
			deps(),
			bill(accountId, { name: "Gaz", firstDueOn: "2026-10-08" }),
		);
		await setRecurringStatus(deps(), gas.id, "inactive");
		const old = await declareBill(
			deps(),
			bill(accountId, { name: "Ancien", firstDueOn: "2026-10-01" }),
		);
		await endWithoutOccurrences(old.id);

		const { bills, subscriptions } = await allBills(deps(), query());

		// The rent detection found is a suggestion, so not listed.
		await expect(stored()).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({ label: "LOYER", status: "suggested" })]),
		);
		// Sure orders its status strings: `active`, `ended`, `inactive`.
		expect(names(bills)).toEqual(["Internet", "Eau", "Ancien", "Gaz"]);
		expect(subscriptions).toBeNull();
		expect(bills[1]).toMatchObject({
			amount: -9000,
			monthlyEquivalent: 3000,
			currentOccurrence: {
				dueOn: "2026-10-20",
				state: "upcoming",
				expected: 9000,
				confirmed: 0,
				remaining: 9000,
			},
		});
		expect(bills[2]).toMatchObject({ status: "ended", currentOccurrence: null });
	});

	it("files each bill under its current occurrence's payment state, or paused or ended", async () => {
		const accountId = await account();
		await declareBill(deps(), bill(accountId, { name: "Électricité", firstDueOn: "2026-09-28" }));
		await declareBill(deps(), bill(accountId, { name: "Internet", firstDueOn: "2026-10-08" }));
		const partial = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "300,00", firstDueOn: "2026-10-20" }),
		);
		await addPayment(deps(), (await firstOf(partial.id)).id, {
			amount: "180,00",
			paidOn: "2026-10-06",
		});
		// Paid, then the next one is open and current: not « Payée ».
		const moved = await declareBill(
			deps(),
			bill(accountId, { name: "Loyer", firstDueOn: "2026-10-01" }),
		);
		await markPaid(deps(), (await firstOf(moved.id)).id, "2026-10-01");
		// Paused once paid: the paid one is its current occurrence.
		const settled = await declareBill(
			deps(),
			bill(accountId, { name: "Assurance", firstDueOn: "2026-10-02" }),
		);
		await markPaid(deps(), (await firstOf(settled.id)).id, "2026-10-02");
		await setRecurringStatus(deps(), settled.id, "inactive");
		const ended = await declareBill(
			deps(),
			bill(accountId, { name: "Ancien", firstDueOn: "2026-10-01" }),
		);
		await endWithoutOccurrences(ended.id);

		await expect(filtered("overdue")).resolves.toEqual(["Électricité"]);
		await expect(filtered("due")).resolves.toEqual(["Internet"]);
		await expect(filtered("partial")).resolves.toEqual(["Eau"]);
		await expect(filtered("paid")).resolves.toEqual(["Assurance"]);
		await expect(filtered("paused")).resolves.toEqual(["Assurance"]);
		await expect(filtered("ended")).resolves.toEqual(["Ancien"]);
	});

	it("files a paused bill under neither overdue nor due, reading it paused, and overdue again once resumed", async () => {
		const accountId = await account();
		const late = await declareBill(
			deps(),
			bill(accountId, { name: "Gaz", firstDueOn: "2026-09-28" }),
		);
		const near = await declareBill(
			deps(),
			// Within its grace days: past, so pausing keeps it.
			bill(accountId, { name: "Box", firstDueOn: "2026-10-04" }),
		);
		await setRecurringStatus(deps(), late.id, "inactive");
		await setRecurringStatus(deps(), near.id, "inactive");

		await expect(allBills(deps(), query({ status: "overdue" }))).resolves.toMatchObject({
			bills: [],
		});
		await expect(allBills(deps(), query({ status: "due" }))).resolves.toMatchObject({
			bills: [],
		});
		const { bills } = await allBills(deps(), query({ status: "paused" }));
		expect(bills.map((row) => [row.name, row.currentOccurrence?.state])).toEqual([
			["Gaz", "paused"],
			["Box", "paused"],
		]);
		expect(bills[0]?.currentOccurrence?.daysLate).toBeNull();

		await setRecurringStatus(deps(), late.id, "active");

		await expect(allBills(deps(), query({ status: "overdue" }))).resolves.toMatchObject({
			bills: [{ name: "Gaz", currentOccurrence: { state: "overdue", daysLate: 8 } }],
		});
	});

	it("searches the name, the merchant's name and the label, whatever their case", async () => {
		const accountId = await account();
		await temp.db.insert(merchants).values({
			id: "netflix",
			name: "Netflix",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const [entry = ""] = await addRows(accountId, ["2026-09-15"], "PRLV NFLX 4821", -1599);
		await updateTransaction(deps(), entry, { merchantId: "netflix" }, { origin: "user" });
		await addRecurringFromEntry(deps(), entry);
		await declareBill(deps(), bill(accountId, { name: "Eau du Grand Lyon" }));

		await expect(searched("NETFLIX")).resolves.toEqual(["Netflix"]);
		await expect(searched("nflx")).resolves.toEqual(["Netflix"]);
		await expect(searched("grand lyon")).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(searched("rien")).resolves.toEqual([]);
	});

	it("sorts by name in French order, then by amount; or by amount, the largest outflow first and incomes last", async () => {
		const accountId = await account();
		await declareBill(deps(), bill(accountId, { name: "gaz", amount: "40,00" }));
		await declareBill(deps(), bill(accountId, { name: "Électricité", amount: "60,00" }));
		await declareBill(deps(), bill(accountId, { name: "Eau", amount: "20,00" }));
		await declareBill(
			deps(),
			bill(accountId, { kind: "income", name: "Salaire", amount: "2 500,00" }),
		);

		await expect(allBills(deps(), query({ sort: "name" }))).resolves.toMatchObject({
			bills: [{ name: "Eau" }, { name: "Électricité" }, { name: "gaz" }, { name: "Salaire" }],
		});
		await expect(allBills(deps(), query({ sort: "amount" }))).resolves.toMatchObject({
			bills: [{ name: "Électricité" }, { name: "gaz" }, { name: "Eau" }, { name: "Salaire" }],
		});
	});

	it("sorts by the stored name, unnamed last, then by Sure's amount ascending: the smallest outflow first", async () => {
		const accountId = await account();
		await temp.db.insert(merchants).values({
			id: "free",
			name: "Free",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const [entry = ""] = await addRows(accountId, ["2026-09-15"], "PRLV FREE MOBILE", -1999);
		await updateTransaction(deps(), entry, { merchantId: "free" }, { origin: "user" });
		const free = await addRecurringFromEntry(deps(), entry);
		await declareBill(deps(), bill(accountId, { name: "Gaz", amount: "40,00" }));
		await declareBill(deps(), bill(accountId, { name: "Eau", amount: "30,00" }));
		await declareBill(deps(), bill(accountId, { name: "Eau", amount: "12,00" }));
		await declareBill(deps(), bill(accountId, { kind: "income", name: "Eau", amount: "25,00" }));

		const { bills } = await allBills(deps(), query({ sort: "name" }));

		expect(free.name).toBeNull();
		// Sure's outflow-positive amount ascending: the income, negative there, first.
		expect(bills.map((row) => [row.name ?? row.merchantName, row.amount])).toEqual([
			["Eau", 2500],
			["Eau", -1200],
			["Eau", -3000],
			["Gaz", -4000],
			["Free", -1999],
		]);
	});

	it("reads an amount that moves as an estimate only when its occurrence has none of its own", async () => {
		const accountId = await account();
		const moving = await declareBill(
			deps(),
			bill(accountId, { name: "Électricité", amount: "52,00", firstDueOn: "2026-10-20" }),
		);
		const fixed = await declareBill(
			deps(),
			bill(accountId, { name: "Gaz", amount: "52,00", firstDueOn: "2026-10-20" }),
		);
		await declareBill(deps(), bill(accountId, { name: "Eau", firstDueOn: "2026-10-20" }));
		await temp.db
			.update(recurringTransactions)
			.set({ expectedAmountMin: -6000, expectedAmountMax: -4000 })
			.where(inArray(recurringTransactions.id, [moving.id, fixed.id]));
		await editOccurrence(deps(), (await firstOf(fixed.id)).id, { expectedAmount: "52,00" });

		const { bills } = await allBills(deps(), query({ sort: "name" }));
		const overview = await billsOverview(deps());

		expect(bills.map((row) => [row.name, row.currentOccurrence?.amountRange])).toEqual([
			["Eau", null],
			["Électricité", { min: 4000, max: 6000 }],
			["Gaz", null],
		]);
		expect(Object.fromEntries(overview.month.map((row) => [row.name, row.amountRange]))).toEqual({
			Eau: null,
			Gaz: null,
			Électricité: { min: 4000, max: 6000 },
		});
	});

	it("rounds a weekly subscription's month and year once each, as Sure's rollup", async () => {
		const accountId = await account();
		const weekly = await declareBill(deps(), bill(accountId, { name: "Panier", amount: "10,00" }));
		await editBill(deps(), weekly.id, {
			billType: "subscription",
			frequency: { preset: "weekly", weekday: "1" },
		});

		await expect(allBills(deps(), query({ type: "subscription" }))).resolves.toMatchObject({
			bills: [{ monthlyEquivalent: 4348 }],
			subscriptions: { count: 1, monthly: 4348, annual: 52_179 },
		});
	});

	it("adds Sure's subscription rollup with the type: the active ones per month and per year, another currency named", async () => {
		const accountId = await account();
		const dollars = await account("USD", "Compte USD");
		const netflix = await subscribe(accountId, "Netflix", "15,99");
		await subscribe(accountId, "Spotify", "9,99");
		const paused = await subscribe(accountId, "Disney", "8,99");
		await setRecurringStatus(deps(), paused.id, "inactive");
		const hosting = await subscribe(dollars, "Hébergement", "5,00");
		// Any series' change counts, a year back at most.
		const water = await declareBill(deps(), bill(accountId, { name: "Eau" }));
		await priceChange(netflix.id, "2026-09-15", 1349, 1599);
		await priceChange(water.id, "2026-03-10", 3000, 2500);
		await priceChange(water.id, "2025-09-10", 2000, 3000);

		const { bills, subscriptions } = await allBills(deps(), query({ type: "subscription" }));

		expect(names(bills)).toHaveLength(4);
		expect(subscriptions).toEqual({
			currency: "EUR",
			count: 3,
			monthly: 2598,
			annual: 31_176,
			leftOut: [{ id: hosting.id, name: "Hébergement" }],
			priceChanges: [
				{
					id: `change-${netflix.id}-2026-09-15`,
					seriesId: netflix.id,
					name: "Netflix",
					effectiveOn: "2026-09-15",
					previousAmount: 1349,
					newAmount: 1599,
					currency: "EUR",
					percent: 185,
				},
				expect.objectContaining({ name: "Eau", percent: -167 }),
			],
		});

		await expect(
			allBills(deps(), query({ type: "subscription", q: "rien" })),
		).resolves.toMatchObject({
			bills: [],
			subscriptions: { count: 0, monthly: null, annual: null },
		});
	});
});

describe("billDetail", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
	});

	it("says what each paid occurrence cost, its range and the last account, and files each payment under its due month", async () => {
		const accountId = await account("EUR", "Compte joint");
		const mortgage = await declareBill(
			deps(),
			bill(accountId, { name: "Prêt immobilier", amount: "571,29", firstDueOn: "2026-09-30" }),
		);
		// August's, paid by hand before the bill was declared.
		const now = Date.now();
		await temp.db.insert(recurringOccurrences).values({
			id: "august",
			recurringTransactionId: mortgage.id,
			originalDueOn: "2026-08-30",
			dueOn: "2026-08-30",
			currency: "EUR",
			expectedAmount: 57_130,
			status: "paid",
			closedAt: now,
			closedSource: "user",
			createdAt: now,
			updatedAt: now,
		});
		await temp.db.insert(recurringAllocations).values({
			id: "august-payment",
			recurringOccurrenceId: "august",
			allocatedAmount: 57_130,
			state: "confirmed",
			source: "user_created",
			paidOn: "2026-08-30",
			createdAt: now,
			updatedAt: now,
		});
		const [paid = ""] = await addRows(accountId, ["2026-10-05"], "PRLV CREDIT AGRICOLE", -57_129);
		const september = (await occurrencesOf(mortgage.id)).find((one) => one.dueOn === "2026-09-30");
		await addPayment(deps(), september!.id, { entryId: paid });

		const detail = await billDetail(deps(), mortgage.id);

		expect(detail.record).toMatchObject({
			id: mortgage.id,
			name: "Prêt immobilier",
			monthlyEquivalent: 57_129,
			currentOccurrence: { dueOn: "2026-10-30", confirmed: 0, remaining: 57_129 },
		});
		// (57 130 + 57 129) / 2 = 57 129,5, half up; 57 129 a month, 12 times.
		expect(detail.analytics).toEqual({
			average: 57_130,
			lowest: 57_129,
			highest: 57_130,
			annualized: 685_548,
			paidThisYear: 114_259,
		});
		expect(detail.yearly).toEqual([{ year: 2026, total: 114_259, average: 57_130 }]);
		expect(detail.upcoming).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
		// Latest first; August's was paid by hand, so it names no transaction.
		expect(detail.history).toEqual([
			{
				id: september!.id,
				dueOn: "2026-09-30",
				status: "paid",
				paid: 57_129,
				payments: 1,
				label: "PRLV CREDIT AGRICOLE",
			},
			{ id: "august", dueOn: "2026-08-30", status: "paid", paid: 57_130, payments: 1, label: null },
		]);
		// Linked by hand, the payment taught the matcher its label; its amount was within tolerance.
		expect(detail.rules).toEqual({ aliases: ["PRLV CREDIT AGRICOLE"], learnedTolerance: null });
		expect(detail.lastAccount).toEqual({ id: accountId, name: "Compte joint" });
		expect(detail.installment).toBeNull();
		expect(detail.priceChanges).toEqual([]);
		expect(detail.months).toHaveLength(12);
		expect(detail.months[0]).toEqual({ month: "2025-11", paid: 0 });
		// Paid on 5 October for the occurrence due 30 September.
		expect(detail.months.slice(-3)).toEqual([
			{ month: "2026-08", paid: 57_130 },
			{ month: "2026-09", paid: 57_129 },
			{ month: "2026-10", paid: 0 },
		]);
	});

	it("has no average before a payment, counts an installment's payments and lists the five latest price changes", async () => {
		const accountId = await account();
		const car = await declareBill(
			deps(),
			bill(accountId, { name: "Voiture", amount: "250,00", firstDueOn: "2026-09-01" }),
		);
		await editBill(deps(), car.id, { billType: "installment", endAfterCount: "12" });
		await markPaid(deps(), (await firstOf(car.id)).id, "2026-09-01");
		await oneByOne(
			["2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01", "2026-01-01", "2026-06-01"],
			(date) => priceChange(car.id, date, 1599, 1349),
		);
		const fresh = await declareBill(deps(), bill(accountId, { name: "Neuve" }));

		const detail = await billDetail(deps(), car.id);

		expect(detail.installment).toEqual({ paid: 1, total: 12 });
		expect(detail.priceChanges.map((change) => change.effectiveOn)).toEqual([
			"2026-06-01",
			"2026-01-01",
			"2025-01-01",
			"2024-01-01",
			"2023-01-01",
		]);
		expect(detail.priceChanges[0]).toMatchObject({
			previousAmount: 1599,
			newAmount: 1349,
			percent: -156,
		});
		// A payment made by hand has no transaction, so no account.
		expect(detail.lastAccount).toBeNull();
		await expect(billDetail(deps(), fresh.id)).resolves.toMatchObject({
			analytics: null,
			yearly: [],
			history: [],
			lastAccount: null,
			installment: null,
		});
		await expect(refusal(billDetail(deps(), "nope"))).resolves.toMatchObject({ code: "NOT_FOUND" });
	});

	it("sums each due year's payments over their count, four years latest first, and reads the history's statuses, counts and hints", async () => {
		const accountId = await account();
		const water = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "10,00", firstDueOn: "2026-09-15" }),
		);
		await temp.db
			.update(recurringTransactions)
			.set({ nameAliases: ["EAU DU GRAND LYON"], learnedTolerance: 125 })
			.where(eq(recurringTransactions.id, water.id));
		const now = Date.now();
		const closedOn = async (
			id: string,
			dueOn: string,
			status: "paid" | "skipped" | "missed",
			amounts: number[],
			paidOn = dueOn,
		) => {
			await temp.db.insert(recurringOccurrences).values({
				id,
				recurringTransactionId: water.id,
				originalDueOn: dueOn,
				dueOn,
				currency: "EUR",
				expectedAmount: 1000,
				status,
				closedAt: now,
				closedSource: "user",
				createdAt: now,
				updatedAt: now,
			});
			await oneByOne(
				amounts.map((amount, index) => ({ amount, index })),
				({ amount, index }) =>
					temp.db.insert(recurringAllocations).values({
						id: `${id}-${index}`,
						recurringOccurrenceId: id,
						allocatedAmount: amount,
						state: "confirmed",
						source: "user_created",
						paidOn,
						createdAt: now,
						updatedAt: now,
					}),
			);
		};
		await closedOn("y2021", "2021-03-15", "paid", [900]);
		await closedOn("y2022", "2022-03-15", "paid", [950]);
		await closedOn("y2023", "2023-03-15", "paid", [960]);
		await closedOn("y2024", "2024-03-15", "paid", [970]);
		await closedOn("y2025a", "2025-03-15", "paid", [1000]);
		await closedOn("y2025b", "2025-04-15", "paid", [500, 601]);
		// Due in December, paid in January: 2025's row, this year's payments.
		await closedOn("december", "2025-12-15", "paid", [800], "2026-01-05");
		await closedOn("skipped", "2026-07-15", "skipped", []);
		await closedOn("y2026", "2026-08-15", "missed", []);

		const detail = await billDetail(deps(), water.id);

		// 2025: 800 + 1 000 + 500 + 601 over four payments, 725,25 rounded half up. 2021 is the fifth year.
		expect(detail.yearly).toEqual([
			{ year: 2025, total: 2901, average: 725 },
			{ year: 2024, total: 970, average: 970 },
			{ year: 2023, total: 960, average: 960 },
			{ year: 2022, total: 950, average: 950 },
		]);
		expect(
			detail.history.map(({ id, status, payments, paid }) => [id, status, payments, paid]),
		).toEqual([
			["y2026", "missed", 0, 0],
			["skipped", "skipped", 0, 0],
			["december", "paid", 1, 800],
			["y2025b", "paid", 2, 1101],
			["y2025a", "paid", 1, 1000],
			["y2024", "paid", 1, 970],
			["y2023", "paid", 1, 960],
			["y2022", "paid", 1, 950],
			["y2021", "paid", 1, 900],
		]);
		expect(detail.history.every((row) => row.label === null)).toBe(true);
		// Only December's payment was made this year.
		expect(detail.analytics).toMatchObject({ paidThisYear: 800, annualized: 12_000 });
		expect(detail.rules).toEqual({ aliases: ["EAU DU GRAND LYON"], learnedTolerance: 125 });
	});
});
