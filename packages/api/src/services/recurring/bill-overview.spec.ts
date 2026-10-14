import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { account, addRows, bill, firstOf, refusal } from "../../testing/bills.ts";
import { deps, temp, useRecurringDatabase } from "../../testing/recurring.ts";
import { billsOverview, occurrenceDetail, upcomingRecurring } from "./bill-overview.ts";
import { declareBill } from "./bills.ts";
import { addPayment, editOccurrence, skipOccurrence } from "./payments.ts";
import { setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

const shown = (rows: readonly { name: string; dueOn: string }[]) =>
	rows.map((row) => `${row.name} ${row.dueOn}`);

/** A suggested payment written as the matcher would, at `confidence`, created at `at`. */
const suggest = async (occurrenceId: string, entryId: string, confidence: number, at: number) =>
	temp.db.insert(recurringAllocations).values({
		id: `suggestion-${confidence}`,
		recurringOccurrenceId: occurrenceId,
		entryId,
		allocatedAmount: 2000,
		state: "suggested",
		source: "auto_matched",
		matchConfidence: confidence,
		matchSignals: { name: 3500, amount: 2300, date: 1300, account: 1000 },
		paidOn: "2026-10-04",
		createdAt: at,
		updatedAt: at,
	});

describe("billsOverview", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
	});

	it("files each open occurrence as Sure's index on today, the later ones once per series", async () => {
		const accountId = await account();
		const late = await declareBill(
			deps(),
			bill(accountId, { name: "Électricité", firstDueOn: "2026-10-01" }),
		);
		await declareBill(
			deps(),
			bill(accountId, { name: "Internet", amount: "39,99", firstDueOn: "2026-10-04" }),
		);
		const snoozed = await declareBill(
			deps(),
			bill(accountId, { name: "Assurance", amount: "45,00", firstDueOn: "2026-10-01" }),
		);
		await declareBill(
			deps(),
			bill(accountId, { name: "Loyer", amount: "800,00", firstDueOn: "2026-10-25" }),
		);
		await editOccurrence(deps(), (await firstOf(snoozed.id)).id, { snoozedUntil: "2026-10-12" });

		const overview = await billsOverview(deps());

		expect(overview.attention).toEqual([
			{
				occurrenceId: (await firstOf(late.id)).id,
				seriesId: late.id,
				name: "Électricité",
				accountId,
				accountName: "Compte",
				destinationAccountId: null,
				merchantName: null,
				dueOn: "2026-10-01",
				effectiveDueOn: "2026-10-01",
				snoozedUntil: null,
				days: -5,
				state: "overdue",
				expected: 8420,
				confirmed: 0,
				remaining: 8420,
				currency: "EUR",
				suggestionId: null,
				amountRange: null,
			},
		]);
		expect(shown(overview.month)).toEqual([
			"Assurance 2026-10-01",
			"Internet 2026-10-04",
			"Loyer 2026-10-25",
		]);
		// Inside its grace: due, not overdue; postponed: upcoming, on its new date.
		expect(
			overview.month.map(({ state, days, effectiveDueOn }) => ({ state, days, effectiveDueOn })),
		).toEqual([
			{ state: "upcoming", days: 6, effectiveDueOn: "2026-10-12" },
			{ state: "due", days: -2, effectiveDueOn: "2026-10-04" },
			{ state: "upcoming", days: 19, effectiveDueOn: "2026-10-25" },
		]);
		// November and December are open: one row each, November's.
		expect(shown(overview.later).toSorted()).toEqual([
			"Assurance 2026-11-01",
			"Internet 2026-11-04",
			"Loyer 2026-11-25",
			"Électricité 2026-11-01",
		]);
		expect(overview.inactive).toEqual([]);
		// Today on: the grace day of 4 October is past, so not next.
		expect(shown(overview.next).slice(0, 2)).toEqual(["Assurance 2026-10-01", "Loyer 2026-10-25"]);
		expect(overview.next).toHaveLength(4);
		expect(overview.totals).toEqual({
			remaining: 8420 + 3999 + 4500 + 80_000,
			overdue: 8420,
			dueSoon: 8420 + 3999 + 4500,
			paid: 0,
		});
		expect(overview).toMatchObject({
			currency: "EUR",
			leftOut: [],
			review: [],
			hasTransactions: false,
		});
	});

	it("keeps the month's paid ones in place, and counts what a partial one still needs", async () => {
		const accountId = await account();
		const mortgage = await declareBill(
			deps(),
			bill(accountId, { name: "Prêt immobilier", amount: "571,29", firstDueOn: "2026-10-05" }),
		);
		const water = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "300,00", firstDueOn: "2026-10-20" }),
		);
		const gym = await declareBill(
			deps(),
			bill(accountId, { name: "Salle de sport", amount: "29,90", firstDueOn: "2026-10-15" }),
		);
		const [paid = ""] = await addRows(accountId, ["2026-10-05"], "Prêt immobilier", -57_129);
		await addPayment(deps(), (await firstOf(mortgage.id)).id, { entryId: paid });
		await addPayment(deps(), (await firstOf(water.id)).id, {
			amount: "180,00",
			paidOn: "2026-10-06",
		});
		await skipOccurrence(deps(), (await firstOf(gym.id)).id);

		const overview = await billsOverview(deps());

		// The skipped one is not listed.
		expect(shown(overview.month)).toEqual(["Prêt immobilier 2026-10-05", "Eau 2026-10-20"]);
		expect(overview.month).toEqual([
			expect.objectContaining({ state: "paid", confirmed: 57_129, remaining: 0 }),
			expect.objectContaining({
				state: "upcoming",
				expected: 30_000,
				confirmed: 18_000,
				remaining: 12_000,
			}),
		]);
		expect(shown(overview.next)).not.toContain("Salle de sport 2026-10-15");
		expect(overview.totals).toEqual({ remaining: 12_000, overdue: 0, dueSoon: 0, paid: 57_129 });
		expect(overview.hasTransactions).toBe(true);
	});

	it("lists a paused series' open ones apart, and leaves another currency out of the totals by name", async () => {
		const accountId = await account();
		const dollars = await account("USD", "Compte USD");
		const paused = await declareBill(
			deps(),
			bill(accountId, { name: "Électricité", firstDueOn: "2026-10-01" }),
		);
		await setRecurringStatus(deps(), paused.id, "inactive");
		const foreign = await declareBill(
			deps(),
			bill(dollars, { name: "Hébergement", amount: "20,00", firstDueOn: "2026-10-10" }),
		);
		// An income is no bill.
		await declareBill(
			deps(),
			bill(accountId, {
				kind: "income",
				name: "Salaire",
				amount: "2 500,00",
				firstDueOn: "2026-10-10",
			}),
		);

		const overview = await billsOverview(deps());

		expect(shown(overview.inactive)).toEqual(["Électricité 2026-10-01"]);
		// Five days late, but nobody pays a paused bill: Sure's #3971.
		expect(overview.inactive[0]).toMatchObject({ state: "paused", days: -5 });
		await expect(
			occurrenceDetail(deps(), overview.inactive[0]!.occurrenceId),
		).resolves.toMatchObject({ occurrence: { state: "paused" } });
		expect(overview.attention).toEqual([]);
		expect(shown(overview.month)).toEqual(["Hébergement 2026-10-10"]);
		expect(overview.month[0]).toMatchObject({ currency: "USD", remaining: 2000 });
		expect(overview.totals).toEqual({ remaining: 0, overdue: 0, dueSoon: 0, paid: 0 });
		expect(overview.leftOut).toEqual([{ id: foreign.id, name: "Hébergement" }]);
	});

	it("queues the suggestions of listed occurrences, the surest first, named by their transactions", async () => {
		const accountId = await account();
		const mortgage = await declareBill(
			deps(),
			bill(accountId, { name: "Prêt immobilier", amount: "571,29", firstDueOn: "2026-10-05" }),
		);
		const water = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "30,00", firstDueOn: "2026-10-03" }),
		);
		const gym = await declareBill(
			deps(),
			bill(accountId, { name: "Salle de sport", amount: "29,90", firstDueOn: "2026-10-02" }),
		);
		const [loan = ""] = await addRows(accountId, ["2026-10-06"], "PRLV CREDIT AGRICOLE", -57_136);
		const [tap = ""] = await addRows(accountId, ["2026-10-04"], "EAU DU GRAND LYON", -3100);
		const [sport = ""] = await addRows(accountId, ["2026-10-02"], "BASIC FIT", -2990);
		const waterOccurrence = await firstOf(water.id);
		const gymOccurrence = await firstOf(gym.id);
		await suggest(waterOccurrence.id, tap, 7000, 1);
		await suggest((await firstOf(mortgage.id)).id, loan, 8100, 2);
		// Skipped, so not listed.
		await skipOccurrence(deps(), gymOccurrence.id);
		await suggest(gymOccurrence.id, sport, 9000, 3);

		const overview = await billsOverview(deps());

		expect(overview.review.map((one) => one.id)).toEqual(["suggestion-8100", "suggestion-7000"]);
		expect(overview.review[0]).toEqual({
			id: "suggestion-8100",
			occurrenceId: (await firstOf(mortgage.id)).id,
			seriesName: "Prêt immobilier",
			label: "PRLV CREDIT AGRICOLE",
			amount: 2000,
			entryAmount: 57_136,
			paidOn: "2026-10-04",
			currency: "EUR",
			expected: 57_129,
			effectiveDueOn: "2026-10-05",
			confidence: 8100,
			signals: { name: 3500, amount: 2300, date: 1300, account: 1000 },
		});
		expect(overview.month.find((row) => row.name === "Eau")).toMatchObject({
			suggestionId: "suggestion-7000",
		});

		await expect(occurrenceDetail(deps(), waterOccurrence.id)).resolves.toMatchObject({
			occurrence: { occurrenceId: waterOccurrence.id, name: "Eau" },
			payments: [],
			suggestion: { id: "suggestion-7000", label: "EAU DU GRAND LYON" },
		});
	});

	it("says whether any transaction exists, and lists neither an ended series nor an income", async () => {
		await expect(billsOverview(deps())).resolves.toMatchObject({
			attention: [],
			month: [],
			later: [],
			inactive: [],
			next: [],
			hasTransactions: false,
		});

		const accountId = await account();
		const ended = await declareBill(deps(), bill(accountId));
		await temp.db
			.update(recurringTransactions)
			.set({ status: "ended" })
			.where(eq(recurringTransactions.id, ended.id));
		await declareBill(
			deps(),
			bill(accountId, {
				kind: "income",
				name: "Salaire",
				amount: "2 500,00",
				firstDueOn: "2026-10-10",
			}),
		);
		await addRows(accountId, ["2026-10-01"], "Boulangerie", -450);

		await expect(billsOverview(deps())).resolves.toMatchObject({
			attention: [],
			month: [],
			later: [],
			inactive: [],
			next: [],
			hasTransactions: true,
		});
	});

	it("reads three months ahead at most: a yearly bill due later is not listed", async () => {
		const accountId = await account();
		await declareBill(
			deps(),
			bill(accountId, {
				name: "Taxe foncière",
				firstDueOn: "2027-03-01",
				frequency: { preset: "annual" },
			}),
		);
		await declareBill(
			deps(),
			bill(accountId, {
				name: "Assurance habitation",
				firstDueOn: "2026-11-20",
				frequency: { preset: "annual" },
			}),
		);

		const overview = await billsOverview(deps());

		expect(shown(overview.later)).toEqual(["Assurance habitation 2026-11-20"]);
		expect(shown(overview.next)).toEqual(["Assurance habitation 2026-11-20"]);
	});
});

describe("occurrenceDetail", () => {
	it("lists the confirmed payments by date, a hand-made one with no label, and refuses an unknown id", async () => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
		const accountId = await account();
		const water = await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "300,00", firstDueOn: "2026-10-05" }),
		);
		const [tap = ""] = await addRows(accountId, ["2026-10-05"], "EAU DU GRAND LYON", -10_000);
		const [occurrence] = await temp.db
			.select({ id: recurringOccurrences.id })
			.from(recurringOccurrences)
			.where(eq(recurringOccurrences.recurringTransactionId, water.id))
			.orderBy(recurringOccurrences.dueOn);
		const own = await addPayment(deps(), occurrence!.id, { amount: "50,00", paidOn: "2026-10-01" });
		const attached = await addPayment(deps(), occurrence!.id, { entryId: tap });

		await expect(occurrenceDetail(deps(), occurrence!.id)).resolves.toMatchObject({
			occurrence: { state: "due", expected: 30_000, confirmed: 15_000, remaining: 15_000 },
			payments: [
				{ id: own.id, label: null, amount: 5000, paidOn: "2026-10-01", source: "user_created" },
				{
					id: attached.id,
					label: "EAU DU GRAND LYON",
					amount: 10_000,
					paidOn: "2026-10-05",
					source: "user_confirmed",
				},
			],
			suggestion: null,
		});
		await expect(refusal(occurrenceDetail(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("upcomingRecurring", () => {
	it("lists the active series, bills and incomes, expected from today to ten days on, by date", async () => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
		const accountId = await account();
		await declareBill(deps(), bill(accountId, { name: "Après", firstDueOn: "2026-10-17" }));
		await declareBill(deps(), bill(accountId, { name: "Dernier jour", firstDueOn: "2026-10-16" }));
		await declareBill(
			deps(),
			bill(accountId, {
				kind: "income",
				name: "Salaire",
				amount: "2 500,00",
				firstDueOn: "2026-10-06",
			}),
		);
		const paused = await declareBill(
			deps(),
			bill(accountId, { name: "En pause", firstDueOn: "2026-10-07" }),
		);
		await setRecurringStatus(deps(), paused.id, "inactive");
		await declareBill(deps(), bill(accountId, { name: "Hier", firstDueOn: "2026-10-05" }));

		await expect(upcomingRecurring(deps())).resolves.toMatchObject([
			{ name: "Salaire", nextExpectedDate: "2026-10-06", amount: 250_000 },
			{ name: "Dernier jour", nextExpectedDate: "2026-10-16" },
		]);
	});

	it("projects a manual series' average when it has one, else its amount", async () => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
		const accountId = await account();
		const averaged = await declareBill(
			deps(),
			bill(accountId, { name: "Électricité", amount: "52,00", firstDueOn: "2026-10-08" }),
		);
		await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "30,00", firstDueOn: "2026-10-09" }),
		);
		await temp.db
			.update(recurringTransactions)
			.set({ expectedAmountAvg: -5000 })
			.where(eq(recurringTransactions.id, averaged.id));

		await expect(upcomingRecurring(deps())).resolves.toMatchObject([
			{ name: "Électricité", amount: -5200, projectedAmount: -5000 },
			{ name: "Eau", amount: -3000, projectedAmount: -3000 },
		]);
	});
});
