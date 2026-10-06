import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { recurringOccurrences } from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import {
	addRows,
	declareMortgage,
	deps,
	occurrencesOf,
	openAccount,
	setToday,
	temp,
	useRecurringDatabase,
} from "../../testing/recurring.ts";
import { editBill } from "./bills.ts";
import { generateOccurrences, startDailyOccurrences } from "./occurrences.ts";
import { attachEntry } from "./payments.ts";
import { runRecurring } from "./pipeline.ts";
import { addRecurringFromEntry, cleanupRecurring, deleteRecurring } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

const dueDates = async (seriesId: string) =>
	(await occurrencesOf(seriesId)).map((occurrence) => occurrence.dueOn);

const generate = (day: string) =>
	temp.db.transaction((tx) => generateOccurrences(tx, day), { behavior: "immediate" });

describe("generateOccurrences", () => {
	it("starts a declared bill on its first due date, never before, up to 90 days ahead", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-10" });

		await expect(dueDates(series.id)).resolves.toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
	});

	it("starts a series from its current cycle, so this month's unpaid date exists", async () => {
		const accountId = await openAccount();
		const [entryId = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -6500 }]);
		const series = await addRecurringFromEntry(deps(), entryId);

		await expect(dueDates(series.id)).resolves.toEqual([
			"2026-09-05",
			"2026-10-05",
			"2026-11-05",
			"2026-12-05",
		]);
	});

	it("reaches a yearly bill's next due date, and an installment's last payment", async () => {
		const accountId = await openAccount();
		const insurance = await declareMortgage(accountId, {
			name: "Assurance",
			firstDueOn: "2027-03-01",
			frequency: { preset: "annual" },
		});
		const loan = await declareMortgage(accountId, { name: "Crédit", firstDueOn: "2026-10-01" });
		await editBill(deps(), loan.id, { billType: "installment", endAfterCount: "6" });

		await expect(dueDates(insurance.id)).resolves.toEqual(["2027-03-01"]);
		await expect(dueDates(loan.id)).resolves.toEqual([
			"2026-10-01",
			"2026-11-01",
			"2026-12-01",
			"2027-01-01",
			"2027-02-01",
			"2027-03-01",
		]);
	});

	it("gives a series that is not active none, and leaves the ones there untouched", async () => {
		const accountId = await openAccount();
		await addRows(
			accountId,
			["2026-07-10", "2026-08-10", "2026-09-10"].map((date) => ({
				date,
				amount: -6500,
				label: "EDF",
			})),
		);
		await runRecurring(deps(), { backfill: false });
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-10" });
		const before = await occurrencesOf(series.id);

		await generate("2026-09-21");

		await expect(occurrencesOf(series.id)).resolves.toEqual(before);
		await expect(temp.db.select().from(recurringOccurrences)).resolves.toHaveLength(3);
	});

	it("adds the next date as the days go by", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-10" });

		await generate("2026-10-12");

		await expect(dueDates(series.id)).resolves.toEqual([
			"2026-10-10",
			"2026-11-10",
			"2026-12-10",
			"2027-01-10",
		]);
	});
});

describe("regenerateFuture", () => {
	it("moves the open dates to come to a new cadence, keeping the ones paid or carrying a payment", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-09-05" });
		const [paid = "", part = ""] = await addRows(accountId, [
			{ date: "2026-09-05", amount: -57_129 },
			{ date: "2026-09-20", amount: -10_000 },
		]);
		const [september, october] = await occurrencesOf(series.id);
		await attachEntry(deps(), september!.id, paid);
		await attachEntry(deps(), october!.id, part);

		await editBill(deps(), series.id, { frequency: { preset: "monthly", dayOfMonth: "15" } });

		await expect(occurrencesOf(series.id)).resolves.toMatchObject([
			{ dueOn: "2026-09-05", status: "paid" },
			// The new cadence's current cycle, as Sure's generator.
			{ dueOn: "2026-09-15", status: "scheduled" },
			{ dueOn: "2026-10-05", status: "scheduled" },
			{ dueOn: "2026-10-15", status: "scheduled" },
			{ dueOn: "2026-11-15", status: "scheduled" },
			{ dueOn: "2026-12-15", status: "scheduled" },
		]);
	});

	it("drops the dates to come of an ended series", async () => {
		const accountId = await openAccount();
		await addRows(
			accountId,
			["2026-07-10", "2026-08-10", "2026-09-10"].map((date) => ({
				date,
				amount: -6500,
				label: "EDF",
			})),
		);
		await runRecurring(deps(), { backfill: false });
		const [row] = await temp.db.select().from(recurringTransactions);
		await temp.db
			.update(recurringTransactions)
			.set({ status: "active" })
			.where(eq(recurringTransactions.id, row!.id));
		await generate("2026-09-21");
		await expect(dueDates(row!.id)).resolves.toHaveLength(4);

		await deleteRecurring(deps(), row!.id);

		await expect(dueDates(row!.id)).resolves.toEqual(["2026-09-10"]);
	});
});

describe("cleanupRecurring", () => {
	it("keeps only the past occurrences of a series it makes inactive", async () => {
		const accountId = await openAccount();
		await temp.db.insert(recurringTransactions).values({
			id: "stale",
			accountId,
			labelKey: "edf",
			label: "EDF",
			amount: -6500,
			currency: "EUR",
			expectedDayOfMonth: 10,
			lastOccurrenceDate: "2026-06-10",
			nextExpectedDate: "2026-07-10",
			occurrenceCount: 3,
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
		await generate("2026-09-21");
		await expect(dueDates("stale")).resolves.toEqual([
			"2026-09-10",
			"2026-10-10",
			"2026-11-10",
			"2026-12-10",
		]);

		await expect(cleanupRecurring(deps())).resolves.toEqual({ inactive: 1 });

		await expect(dueDates("stale")).resolves.toEqual(["2026-09-10"]);
	});
});

describe("editBill to another currency", () => {
	it("rebuilds the occurrences to come in the new account's currency", async () => {
		const accountId = await openAccount();
		const dollars = await openAccount("USD");
		const series = await declareMortgage(accountId, { firstDueOn: "2026-09-05" });

		await editBill(deps(), series.id, { accountId: dollars });

		await expect(
			temp.db
				.select({ dueOn: recurringOccurrences.dueOn, currency: recurringOccurrences.currency })
				.from(recurringOccurrences)
				.where(eq(recurringOccurrences.recurringTransactionId, series.id))
				.orderBy(recurringOccurrences.dueOn),
		).resolves.toEqual([
			// Due already: it stays as it was.
			{ dueOn: "2026-09-05", currency: "EUR" },
			{ dueOn: "2026-10-05", currency: "USD" },
			{ dueOn: "2026-11-05", currency: "USD" },
			{ dueOn: "2026-12-05", currency: "USD" },
		]);
	});
});

describe("pinAmountsAlreadyDue", () => {
	it("keeps the old amount on the open dates already due when the series' amount changes", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-09-05" });

		await editBill(deps(), series.id, { amount: "600,00" });

		await expect(occurrencesOf(series.id)).resolves.toMatchObject([
			{ dueOn: "2026-09-05", expectedAmount: 57_129 },
			{ dueOn: "2026-10-05", expectedAmount: null },
			{ dueOn: "2026-11-05", expectedAmount: null },
			{ dueOn: "2026-12-05", expectedAmount: null },
		]);
	});
});

describe("startDailyOccurrences", () => {
	it("claims the day once, and the next day again", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-10" });
		setToday("2026-12-11");

		const first = await startDailyOccurrences(deps());
		await expect(startDailyOccurrences(deps())).resolves.toBeNull();
		await first?.run();

		await expect(dueDates(series.id)).resolves.toContain("2027-03-10");

		setToday("2026-12-12");
		await expect(startDailyOccurrences(deps())).resolves.not.toBeNull();
	});
});
