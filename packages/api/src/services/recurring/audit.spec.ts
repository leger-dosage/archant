import { describe, expect, it } from "vitest";

import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import {
	addRows,
	deps,
	occurrencesOf,
	openAccount,
	setToday,
	temp,
	useRecurringDatabase,
} from "../../testing/recurring.ts";
import { oneByOne } from "../ledger/shared.ts";
import { billAudit } from "./audit.ts";
import { billCandidates, declareBill } from "./bills.ts";
import { skipOccurrence } from "./payments.ts";
import { setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

const declare = (
	accountId: string,
	name: string,
	firstDueOn: string,
	overrides: Partial<Parameters<typeof declareBill>[1]> = {},
) =>
	declareBill(deps(), {
		kind: "bill",
		name,
		amount: "20,00",
		accountId,
		firstDueOn,
		frequency: { preset: "monthly" },
		...overrides,
	});

describe("billAudit", () => {
	it("cuts each section at twenty items, with the count of every one", async () => {
		const accountId = await openAccount();
		await temp.db.insert(recurringTransactions).values(
			Array.from({ length: 21 }, (_, index) => ({
				id: `suggested-${String(index).padStart(2, "0")}`,
				accountId,
				labelKey: `abonnement ${index}`,
				label: `ABONNEMENT ${index}`,
				amount: -1000,
				currency: "EUR",
				expectedDayOfMonth: 1,
				lastOccurrenceDate: "2026-09-01",
				nextExpectedDate: "2026-10-01",
				occurrenceCount: 3,
				status: "suggested" as const,
				createdAt: 0,
				updatedAt: 0,
			})),
		);

		const audit = await billAudit(deps(), 12);

		expect(audit.awaitingConfirmation).toMatchObject({ count: 21, truncated: true });
		expect(audit.awaitingConfirmation.items).toHaveLength(20);
		expect(audit.possibleDuplicates).toEqual({ items: [], count: 0, truncated: false });
	});

	it("leaves incomes out of the overdue bills, the most cycles first", async () => {
		const accountId = await openAccount();
		setToday("2026-06-01");
		await declare(accountId, "Salaire", "2026-06-03", { kind: "income" });
		await declare(accountId, "Un mois", "2026-08-10");
		await declare(accountId, "Trois mois", "2026-06-10");
		setToday("2026-09-21");

		const audit = await billAudit(deps(), 1);

		expect(
			audit.longOverdue.items.map(({ bill, cyclesOverdue: cycles }) => [bill.displayName, cycles]),
		).toEqual([
			["Trois mois", 3],
			["Un mois", 1],
		]);
	});

	it("leaves out of the dormant bills a paused one with no open occurrence", async () => {
		const accountId = await openAccount();
		setToday("2026-08-01");
		const owed = await declare(accountId, "Due", "2026-08-05");
		const settled = await declare(accountId, "Réglée", "2026-08-06");
		setToday("2026-09-21");
		await setRecurringStatus(deps(), owed.id, "inactive");
		await setRecurringStatus(deps(), settled.id, "inactive");
		const open = (await occurrencesOf(settled.id)).filter((row) => row.status === "scheduled");
		await oneByOne(open, (row) => skipOccurrence(deps(), row.id));

		const audit = await billAudit(deps(), 12);

		expect(audit.dormant.items.map((bill) => bill.id)).toEqual([owed.id]);
	});

	it("offers every undeclared pattern, where the declare dialog offers eight", async () => {
		const accountId = await openAccount();

		await oneByOne(
			Array.from({ length: 9 }, (_, index) => index),
			(index) =>
				addRows(
					accountId,
					["2026-07-08", "2026-08-08", "2026-09-08"].map((date) => ({
						date,
						amount: -1000 - index * 100,
						label: `ABONNEMENT ${index}`,
					})),
				),
		);

		const audit = await billAudit(deps(), 12);

		expect(audit.undeclaredCandidates.count).toBe(9);
		await expect(billCandidates(deps(), "bill")).resolves.toHaveLength(8);
	});
});
