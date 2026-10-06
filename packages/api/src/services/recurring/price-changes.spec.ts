import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	recurringAllocations,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import {
	addRows,
	occurrencesOf,
	openAccount,
	temp,
	useRecurringDatabase,
} from "../../testing/recurring.ts";
import { detectPriceChanges } from "./price-changes.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

const DAY = "2026-09-21";

/** A streaming subscription at 13,99 €, active, with an open occurrence already due and one to come. */
async function subscription(fields: { manual?: boolean; amount?: number; id?: string } = {}) {
	const accountId = await openAccount();
	const id = fields.id ?? "netflix";
	const now = Date.now();

	await temp.db.insert(recurringTransactions).values({
		id,
		accountId,
		labelKey: "netflix",
		label: "NETFLIX",
		amount: fields.amount ?? -1399,
		currency: "EUR",
		expectedDayOfMonth: 8,
		lastOccurrenceDate: "2026-09-08",
		nextExpectedDate: "2026-10-08",
		occurrenceCount: 3,
		status: "active",
		manual: fields.manual ?? false,
		createdAt: now,
		updatedAt: now,
	});

	return { accountId, id };
}

/** An occurrence of `seriesId` on `dueOn`, paid by `amounts` when given, else open. */
async function occurrence(
	seriesId: string,
	dueOn: string,
	amounts: number[] = [],
	entryId?: string,
) {
	const id = `${seriesId}-${dueOn}`;
	const now = Date.now();
	const paid = amounts.length > 0;

	await temp.db.insert(recurringOccurrences).values({
		id,
		recurringTransactionId: seriesId,
		originalDueOn: dueOn,
		dueOn,
		currency: "EUR",
		expectedAmount: paid ? 1399 : null,
		status: paid ? "paid" : "scheduled",
		closedAt: paid ? now : null,
		closedSource: paid ? "auto" : null,
		createdAt: now,
		updatedAt: now,
	});

	if (paid) {
		await temp.db.insert(recurringAllocations).values(
			amounts.map((amount, index) => ({
				id: `${id}-${index}`,
				recurringOccurrenceId: id,
				entryId: index === 0 ? (entryId ?? null) : null,
				allocatedAmount: amount,
				state: "confirmed" as const,
				source: "user_confirmed" as const,
				paidOn: dueOn,
				createdAt: now + index,
				updatedAt: now + index,
			})),
		);
	}
}

const detect = () =>
	temp.db.transaction((tx) => detectPriceChanges(tx, DAY), { behavior: "immediate" });

const changes = () =>
	temp.db
		.select({
			series: recurringPriceChanges.recurringTransactionId,
			effectiveOn: recurringPriceChanges.effectiveOn,
			previousAmount: recurringPriceChanges.previousAmount,
			newAmount: recurringPriceChanges.newAmount,
			currency: recurringPriceChanges.currency,
			entryId: recurringPriceChanges.entryId,
		})
		.from(recurringPriceChanges);

const amountOf = async (id: string) =>
	(
		await temp.db
			.select({ amount: recurringTransactions.amount })
			.from(recurringTransactions)
			.where(eq(recurringTransactions.id, id))
			.get()
	)?.amount;

describe("detectPriceChanges", () => {
	it("records two payments at 15,99 € on the latest due date, and a detected series takes the price", async () => {
		const { accountId, id } = await subscription();
		const [latest = ""] = await addRows(accountId, [
			{ date: "2026-09-08", amount: -1599, label: "NETFLIX" },
		]);
		await occurrence(id, "2026-07-08");
		await occurrence(id, "2026-08-08", [1599]);
		await occurrence(id, "2026-09-08", [1599], latest);
		await occurrence(id, "2026-10-08");

		await detect();

		await expect(changes()).resolves.toEqual([
			{
				series: id,
				effectiveOn: "2026-09-08",
				previousAmount: 1399,
				newAmount: 1599,
				currency: "EUR",
				entryId: latest,
			},
		]);
		await expect(amountOf(id)).resolves.toBe(-1599);
		// The open one already due keeps 13,99 €; the one to come reads the new price.
		await expect(occurrencesOf(id)).resolves.toMatchObject([
			{ dueOn: "2026-07-08", status: "scheduled", expectedAmount: 1399 },
			{ dueOn: "2026-08-08", status: "paid" },
			{ dueOn: "2026-09-08", status: "paid" },
			{ dueOn: "2026-10-08", status: "scheduled", expectedAmount: null },
		]);

		// Once recorded, never twice.
		await detect();
		await expect(changes()).resolves.toHaveLength(1);
	});

	it("records the change of a manual series, whose amount stays its owner's", async () => {
		const { id } = await subscription({ manual: true });
		await occurrence(id, "2026-08-08", [1599]);
		await occurrence(id, "2026-09-08", [1599]);

		await detect();

		await expect(changes()).resolves.toMatchObject([{ newAmount: 1599 }]);
		await expect(amountOf(id)).resolves.toBe(-1399);
	});

	it("leaves the amount of a detected series another series of its key holds at the new price", async () => {
		const { accountId, id } = await subscription();
		await temp.db.insert(recurringTransactions).values({
			id: "twin",
			accountId,
			labelKey: "netflix",
			label: "NETFLIX",
			amount: -1599,
			currency: "EUR",
			expectedDayOfMonth: 8,
			lastOccurrenceDate: "2026-09-08",
			nextExpectedDate: "2026-10-08",
			occurrenceCount: 3,
			status: "inactive",
			createdAt: 0,
			updatedAt: 0,
		});
		await occurrence(id, "2026-08-08", [1599]);
		await occurrence(id, "2026-09-08", [1599]);

		await detect();

		await expect(changes()).resolves.toHaveLength(1);
		await expect(amountOf(id)).resolves.toBe(-1399);
	});

	it("reads only active series that take money out, each settled by one payment", async () => {
		const { id } = await subscription();
		await occurrence(id, "2026-08-08", [1599]);
		await occurrence(id, "2026-09-08", [800, 799]);
		const income = await subscription({ id: "salary", amount: 250_000 });
		await occurrence(income.id, "2026-08-08", [260_000]);
		await occurrence(income.id, "2026-09-08", [260_000]);
		await subscription({ id: "unpaid", amount: -500 });

		await detect();

		await expect(changes()).resolves.toEqual([]);
	});
});
