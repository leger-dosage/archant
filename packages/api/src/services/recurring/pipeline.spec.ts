import { describe, expect, it } from "vitest";

import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";

import {
	addRows,
	declareMortgage,
	deps,
	linkBank,
	occurrencesOf,
	openAccount,
	payments,
	setToday,
	syncRows,
	temp,
	useRecurringDatabase,
	withMerchant,
} from "../../testing/recurring.ts";
import { runRecurring } from "./pipeline.ts";
import { listRecurring, setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-10-06T10:00:00Z");

/** The mortgage's four payments, the 10 August one 3 days off its day and 7 cents off its amount. */
const MORTGAGE = [
	{ date: "2026-07-06", amount: -57_129 },
	{ date: "2026-08-10", amount: -57_136 },
	{ date: "2026-09-07", amount: -57_122 },
	{ date: "2026-10-05", amount: -57_129 },
];

async function mortgage(merchant: boolean) {
	const accountId = await openAccount();
	const ids = await addRows(accountId, MORTGAGE);

	if (merchant) {
		await withMerchant(ids);
	}

	const series = await declareMortgage(accountId, { firstDueOn: "2026-10-05", entryId: ids[3]! });

	return { accountId, ids, series };
}

const snapshot = async () => ({
	occurrences: await temp.db.select().from(recurringOccurrences).orderBy(recurringOccurrences.id),
	allocations: await temp.db.select().from(recurringAllocations).orderBy(recurringAllocations.id),
});

describe("runRecurring with history, as « Détecter »", () => {
	it.each([
		["without a merchant", false],
		["with a merchant", true],
	])(
		"pays the mortgage's occurrences of July to October %s, and deletes the past ones nothing pays",
		async (_, merchant) => {
			const { ids, series } = await mortgage(merchant);

			await runRecurring(deps(), { backfill: true });

			await expect(occurrencesOf(series.id)).resolves.toEqual([
				expect.objectContaining({ dueOn: "2026-07-05", status: "paid", closedSource: "auto" }),
				expect.objectContaining({ dueOn: "2026-08-05", status: "paid", expectedAmount: 57_129 }),
				expect.objectContaining({ dueOn: "2026-09-05", status: "paid" }),
				expect.objectContaining({ dueOn: "2026-10-05", status: "paid" }),
				expect.objectContaining({ dueOn: "2026-11-05", status: "scheduled", expectedAmount: null }),
				expect.objectContaining({ dueOn: "2026-12-05", status: "scheduled" }),
			]);
			await expect(payments()).resolves.toEqual([
				expect.objectContaining({ dueOn: "2026-07-05", entryId: ids[0], state: "confirmed" }),
				// Overdue on 6 October, its window runs to today: 0.8881 without a merchant.
				expect.objectContaining({
					dueOn: "2026-08-05",
					entryId: ids[1],
					amount: 57_129,
					state: "confirmed",
					source: "auto_matched",
					confidence: merchant ? 9381 : 8881,
					paidOn: "2026-08-10",
				}),
				expect.objectContaining({ dueOn: "2026-09-05", entryId: ids[2], amount: 57_122 }),
				expect.objectContaining({
					dueOn: "2026-10-05",
					entryId: ids[3],
					confidence: merchant ? 10_000 : 9500,
				}),
			]);
		},
	);

	it("changes nothing when run twice", async () => {
		await mortgage(false);
		await runRecurring(deps(), { backfill: true });
		const before = await snapshot();

		await runRecurring(deps(), { backfill: true });

		await expect(snapshot()).resolves.toEqual(before);
	});

	it("deletes a declared bill's past occurrence nothing pays, before the current cycle", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-09-05" });

		await runRecurring(deps(), { backfill: true });

		// Nothing pays 5 September, before the cycle of 5 October: it goes.
		await expect(occurrencesOf(series.id)).resolves.toEqual([
			expect.objectContaining({ dueOn: "2026-10-05", status: "scheduled" }),
			expect.objectContaining({ dueOn: "2026-11-05" }),
			expect.objectContaining({ dueOn: "2026-12-05" }),
		]);
	});
});

describe("runRecurring without history, as an import or a sync", () => {
	it("suggests the 10 August payment at 0.8165 on the 10th, and leaves the occurrence open", async () => {
		setToday("2026-08-10");
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [late = ""] = await addRows(accountId, [{ date: "2026-08-10", amount: -57_136 }]);

		await runRecurring(deps(), { backfill: false });

		await expect(payments()).resolves.toEqual([
			expect.objectContaining({
				dueOn: "2026-08-05",
				entryId: late,
				amount: 57_129,
				state: "suggested",
				confidence: 8165,
			}),
		]);
		await expect(occurrencesOf(series.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ dueOn: "2026-08-05", status: "scheduled", expectedAmount: null }),
			]),
		);
	});

	it("never stacks a second payment on a suggestion when run again", async () => {
		setToday("2026-08-10");
		const accountId = await openAccount();
		await declareMortgage(accountId);
		await addRows(accountId, [{ date: "2026-08-10", amount: -57_136 }]);
		await runRecurring(deps(), { backfill: false });

		await runRecurring(deps(), { backfill: false });

		await expect(payments()).resolves.toMatchObject([{ state: "suggested" }]);
	});

	it("confirms a pending payment's suggestion once its line is booked, and pays the occurrence", async () => {
		setToday("2026-08-06");
		const accountId = await openAccount();
		const connectionId = await linkBank(accountId);
		const series = await declareMortgage(accountId);
		const [pending = ""] = await syncRows(accountId, connectionId, [
			{ ref: "EB1", date: "2026-08-05", amount: -57_129, pending: true },
		]);
		await runRecurring(deps(), { backfill: false });
		await expect(payments()).resolves.toMatchObject([{ entryId: pending, state: "suggested" }]);

		await syncRows(accountId, connectionId, [{ ref: "EB1", date: "2026-08-05", amount: -57_129 }]);
		await runRecurring(deps(), { backfill: false });

		// The booked line kept its entry id (AD-17).
		await expect(payments()).resolves.toEqual([
			expect.objectContaining({
				entryId: pending,
				state: "confirmed",
				source: "auto_matched",
				confidence: 9500,
			}),
		]);
		await expect(occurrencesOf(series.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ dueOn: "2026-08-05", status: "paid", expectedAmount: 57_129 }),
			]),
		);
	});

	it("confirms and pays it at 0.8665 when its rows carry a merchant", async () => {
		setToday("2026-08-10");
		const accountId = await openAccount();
		const [first = ""] = await addRows(accountId, [{ date: "2026-07-05", amount: -57_129 }]);
		const [late = ""] = await addRows(accountId, [{ date: "2026-08-10", amount: -57_136 }]);
		await withMerchant([first, late]);
		const series = await declareMortgage(accountId, { entryId: first });

		await runRecurring(deps(), { backfill: false });

		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ entryId: late, state: "confirmed", confidence: 8665 }),
		]);
		await expect(occurrencesOf(series.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ dueOn: "2026-08-05", status: "paid", expectedAmount: 57_129 }),
			]),
		);
	});

	it("still pays a paused series' late occurrence, its window open to today, as Sure's #3971", async () => {
		setToday("2026-08-10");
		const accountId = await openAccount();
		const [first = ""] = await addRows(accountId, [{ date: "2026-07-05", amount: -57_129 }]);
		const [late = ""] = await addRows(accountId, [{ date: "2026-08-10", amount: -57_136 }]);
		await withMerchant([first, late]);
		const series = await declareMortgage(accountId, { entryId: first });
		await setRecurringStatus(deps(), series.id, "inactive");

		await runRecurring(deps(), { backfill: false });

		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ entryId: late, state: "confirmed", confidence: 8665 }),
		]);
		await expect(occurrencesOf(series.id)).resolves.toEqual([
			expect.objectContaining({ dueOn: "2026-08-05", status: "paid" }),
		]);
	});

	it("only suggests a pending payment, and never writes one in history", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-05" });
		await addRows(accountId, [{ date: "2026-10-05", amount: -57_129, pending: true }]);

		await runRecurring(deps(), { backfill: true });

		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ dueOn: "2026-10-05", state: "suggested" }),
		]);
		await expect(occurrencesOf(series.id)).resolves.toMatchObject([
			{ status: "scheduled" },
			{},
			{},
		]);
	});
});

describe("setRecurringStatus", () => {
	it("rebuilds six months of a suggestion the owner adds, paid by its own rows", async () => {
		const accountId = await openAccount();
		await addRows(
			accountId,
			["2026-07-10", "2026-08-10", "2026-09-10"].map((date) => ({
				date,
				amount: -6500,
				label: "PRLV EDF",
			})),
		);
		await runRecurring(deps(), { backfill: false });
		// A suggestion has no occurrence.
		await expect(temp.db.select().from(recurringOccurrences)).resolves.toEqual([]);
		const [found] = await listRecurring(deps());

		const added = await setRecurringStatus(deps(), found!.id, "active");

		// The earliest open one: September is paid.
		expect(added.currentOccurrence).toMatchObject({
			dueOn: "2026-10-10",
			status: "scheduled",
			state: "upcoming",
		});
		await expect(occurrencesOf(found!.id)).resolves.toMatchObject([
			{ dueOn: "2026-07-10", status: "paid" },
			{ dueOn: "2026-08-10", status: "paid" },
			{ dueOn: "2026-09-10", status: "paid" },
			{ dueOn: "2026-10-10", status: "scheduled" },
			{ dueOn: "2026-11-10", status: "scheduled" },
			{ dueOn: "2026-12-10", status: "scheduled" },
		]);
	});

	it("drops the future occurrences of a paused series, and gives them back on resume", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId, { firstDueOn: "2026-10-05" });

		await setRecurringStatus(deps(), series.id, "inactive");
		// Due yesterday, it is not the future: it stays.
		await expect(occurrencesOf(series.id)).resolves.toMatchObject([{ dueOn: "2026-10-05" }]);

		await setRecurringStatus(deps(), series.id, "active");
		await expect(occurrencesOf(series.id)).resolves.toHaveLength(3);
	});
});
