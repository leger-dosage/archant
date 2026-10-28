import type { DeclareInput } from "../../schemas/bills.ts";

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import {
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { account, addRows, bill, monthly, query, refusal, stored } from "../../testing/bills.ts";
import { deps, temp, useRecurringDatabase } from "../../testing/recurring.ts";
import { createAccount } from "../ledger/accounts.ts";
import { findTransaction } from "../ledger/queries.ts";
import { allBills, billDetail } from "./all-bills.ts";
import { billsOverview } from "./bill-overview.ts";
import { declareBill, editBill, markTransferRecurring, updateBill } from "./bills.ts";
import { runRecurring } from "./pipeline.ts";
import { addRecurringFromEntry, setRecurringStatus } from "./series.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

describe("declareBill", () => {
	it("stores an active manual bill, negative, anchored, last seen and due on its first date", async () => {
		const accountId = await account();

		const water = await declareBill(
			deps(),
			bill(accountId, {
				autopay: true,
				notes: " Contrat 4821 ",
				paymentUrl: "  eau.grandlyon.com/payer ",
			}),
		);

		expect(water).toMatchObject({
			accountId,
			merchantId: null,
			label: "Eau du Grand Lyon",
			name: "Eau du Grand Lyon",
			amount: -8420,
			currency: "EUR",
			status: "active",
			manual: true,
			billType: "bill",
			autopay: true,
			notes: "Contrat 4821",
			paymentUrl: "https://eau.grandlyon.com/payer",
			anchorDate: "2026-10-10",
			lastOccurrenceDate: "2026-10-10",
			nextExpectedDate: "2026-10-10",
			occurrenceCount: 0,
			expectedDayOfMonth: 10,
			expectedAmountMin: null,
			rules: [monthly(10)],
			frequency: { key: "monthly", dayOfMonth: 10 },
		});
		await expect(stored()).resolves.toMatchObject([
			{ labelKey: "eau du grand lyon", dedupScope: "-8420", schedulePinnedAt: null },
		]);
	});

	it("stores the type and category asked, and an income always as one, uncategorised", async () => {
		const accountId = await account();
		await temp.db.insert(categories).values({
			id: "streaming",
			name: "Streaming",
			color: "#e99537",
			icon: "tv",
			createdAt: 0,
			updatedAt: 0,
		});

		await expect(
			declareBill(
				deps(),
				bill(accountId, { name: "Netflix", billType: "subscription", categoryId: "streaming" }),
			),
		).resolves.toMatchObject({ billType: "subscription", categoryId: "streaming" });
		await expect(
			declareBill(
				deps(),
				bill(accountId, {
					kind: "income",
					name: "Salaire",
					billType: "subscription",
					categoryId: "nope",
				}),
			),
		).resolves.toMatchObject({ billType: "income", categoryId: null });
		await expect(
			refusal(declareBill(deps(), bill(accountId, { name: "Box", categoryId: "nope" }))),
		).resolves.toMatchObject({ fields: [{ path: "categoryId", code: "invalid_value" }] });
		await expect(
			refusal(declareBill(deps(), bill(accountId, { name: "Gaz", billType: "income" }))),
		).resolves.toMatchObject({ fields: [{ path: "billType" }] });
	});

	it("stores an income positive, with no autopay unless asked", async () => {
		const accountId = await account();

		await expect(
			declareBill(deps(), bill(accountId, { kind: "income", name: "Salaire", amount: "2 500,00" })),
		).resolves.toMatchObject({ amount: 250_000, billType: "income", autopay: false });
	});

	it("writes the rules of the frequency on the first date's day, weekday and month", async () => {
		const accountId = await account();
		const rulesOf = async (frequency: DeclareInput["frequency"], name: string) =>
			(await declareBill(deps(), bill(accountId, { name, frequency }))).rules;

		// 10 October 2026 is a Saturday.
		await expect(rulesOf({ preset: "quarterly" }, "A")).resolves.toEqual([monthly(10, 3)]);
		await expect(rulesOf({ preset: "biweekly" }, "B")).resolves.toEqual([
			{ frequency: "weekly", interval: 2, weekday: 6 },
		]);
		await expect(rulesOf({ preset: "annual" }, "C")).resolves.toEqual([
			{ frequency: "yearly", interval: 1, dayOfMonth: 10, monthOfYear: 10 },
		]);
		await expect(rulesOf({ preset: "semimonthly" }, "D")).resolves.toEqual([
			monthly(10),
			monthly(15),
		]);
		await expect(
			rulesOf({ preset: "interval", interval: "2", unit: "yearly" }, "E"),
		).resolves.toEqual([{ frequency: "yearly", interval: 2, dayOfMonth: 10, monthOfYear: 10 }]);
		await expect(stored()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "B", expectedDayOfMonth: 10, anchorDate: "2026-10-10" }),
			]),
		);
	});

	it("keys on its name with no merchant, as Sure's `declared_bill.rb`", async () => {
		const accountId = await account();

		await expect(
			declareBill(deps(), bill(accountId, { name: "Prêt immobilier", amount: "571,22" })),
		).resolves.toMatchObject({
			merchantId: null,
			merchantName: null,
			label: "Prêt immobilier",
			name: "Prêt immobilier",
		});
		await expect(stored()).resolves.toEqual([
			expect.objectContaining({ merchantId: null, labelKey: "pret immobilier" }),
		]);
	});

	it("answers RECURRING_ALREADY_EXISTS for the same account, name and amount", async () => {
		const accountId = await account();
		await declareBill(deps(), bill(accountId));

		await expect(
			refusal(declareBill(deps(), bill(accountId, { name: " eau du  GRAND lyon" }))),
		).resolves.toMatchObject({
			code: "RECURRING_ALREADY_EXISTS",
		});
		await expect(declareBill(deps(), bill(accountId, { amount: "84,21" }))).resolves.toBeDefined();
		await expect(stored()).resolves.toHaveLength(2);
	});

	it("refuses an unknown account, amount, interval or link, writing nothing", async () => {
		const accountId = await account();

		await expect(refusal(declareBill(deps(), bill("nope")))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "accountId", code: "invalid_value" }],
		});
		await expect(
			refusal(
				declareBill(
					deps(),
					bill(accountId, {
						name: " ",
						amount: "0",
						firstDueOn: "10/10/2026",
						frequency: { preset: "interval", interval: "100", unit: "daily" },
						paymentUrl: "ftp://x",
					}),
				),
			),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [
				{ path: "name", code: "too_small" },
				{ path: "amount", code: "not_positive" },
				{ path: "firstDueOn", code: "invalid_format" },
				{ path: "frequency.interval", code: "invalid_interval" },
				{ path: "frequency.unit", code: "invalid_value" },
				{ path: "paymentUrl", code: "invalid_url" },
			],
		});
		await expect(
			refusal(declareBill(deps(), bill(accountId, { paymentUrl: "javascript:alert(1)" }))),
		).resolves.toMatchObject({ fields: [{ path: "paymentUrl", code: "invalid_url" }] });
		await expect(
			refusal(declareBill(deps(), bill(accountId, { frequency: { preset: "custom" } }))),
		).resolves.toMatchObject({ fields: [{ path: "frequency.preset", code: "invalid_value" }] });
		await expect(stored()).resolves.toEqual([]);
	});
});

async function declared(overrides: Partial<DeclareInput> = {}) {
	const accountId = await account();

	return { accountId, series: await declareBill(deps(), bill(accountId, overrides)) };
}

const pinnedAt = async (id: string) =>
	(
		await temp.db
			.select({ pinned: recurringTransactions.schedulePinnedAt })
			.from(recurringTransactions)
			.where(eq(recurringTransactions.id, id))
	)[0]?.pinned;

describe("editBill", () => {
	it("sets the name, amount with its sign kept, type, category, autopay, notes and link", async () => {
		const { series } = await declared();
		await temp.db.insert(categories).values({
			id: "eau",
			name: "Eau",
			color: "#e99537",
			icon: "tag",
			createdAt: 0,
			updatedAt: 0,
		});

		await expect(
			editBill(deps(), series.id, {
				name: "Eau",
				amount: "90,00",
				billType: "subscription",
				categoryId: "eau",
				autopay: true,
				notes: "Relevé trimestriel",
				paymentUrl: "http://eau.example/payer",
			}),
		).resolves.toMatchObject({
			name: "Eau",
			amount: -9000,
			billType: "subscription",
			categoryId: "eau",
			autopay: true,
			notes: "Relevé trimestriel",
			paymentUrl: "http://eau.example/payer",
		});
		await expect(
			editBill(deps(), series.id, { name: " ", categoryId: null, paymentUrl: "", notes: "" }),
		).resolves.toMatchObject({ name: null, categoryId: null, paymentUrl: null, notes: null });
		// Nothing pins a schedule but a change of cadence.
		await expect(pinnedAt(series.id)).resolves.toBeNull();
	});

	it("keeps an income positive, and never changes its type", async () => {
		const { series } = await declared({ kind: "income", name: "Salaire", amount: "2 500,00" });

		await expect(editBill(deps(), series.id, { amount: "2 600,00" })).resolves.toMatchObject({
			amount: 260_000,
			billType: "income",
		});
		await expect(refusal(editBill(deps(), series.id, { billType: "bill" }))).resolves.toMatchObject(
			{
				code: "VALIDATION_ERROR",
				fields: [{ path: "billType", code: "invalid_value" }],
			},
		);
	});

	it("moves to another account, its currency following", async () => {
		const { series } = await declared();
		const dollars = await account("USD", "Dollars");

		await expect(
			editBill(deps(), series.id, { accountId: dollars, amount: "95.10" }),
		).resolves.toMatchObject({ accountId: dollars, currency: "USD", amount: -9510 });
		await expect(
			refusal(editBill(deps(), series.id, { accountId: "nope" })),
		).resolves.toMatchObject({
			fields: [{ path: "accountId", code: "invalid_value" }],
		});
	});

	it("clears the band of a series moved to an account in another currency", async () => {
		const accountId = await account();
		const dollars = await account("USD", "Dollars");
		await addRows(accountId, ["2026-07-10", "2026-08-10"], "PRLV EDF", -6500);
		await addRows(accountId, ["2026-09-10"], "PRLV EDF", -6700);
		await runRecurring(deps(), { backfill: false });
		const [detected] = await stored();
		expect(detected).toMatchObject({ expectedAmountMin: -6700, expectedAmountMax: -6500 });
		await setRecurringStatus(deps(), detected!.id, "active");

		await expect(
			editBill(deps(), detected!.id, { accountId: dollars, amount: "72.00" }),
		).resolves.toMatchObject({ currency: "USD", amount: -7200 });
		await expect(stored()).resolves.toMatchObject([
			{ expectedAmountMin: null, expectedAmountMax: null, expectedAmountAvg: null },
		]);
	});

	it("rewrites the rules of a changed cadence and pins it, and pins nothing for the same one", async () => {
		const { series } = await declared();

		await editBill(deps(), series.id, { frequency: { preset: "monthly", dayOfMonth: "10" } });
		await expect(pinnedAt(series.id)).resolves.toBeNull();

		const quarterly = await editBill(deps(), series.id, {
			frequency: { preset: "quarterly", dayOfMonth: "10" },
		});

		expect(quarterly).toMatchObject({
			rules: [monthly(10, 3)],
			frequency: { key: "quarterly", dayOfMonth: 10 },
			anchorDate: "2026-10-10",
			nextExpectedDate: "2026-10-10",
		});
		await expect(pinnedAt(series.id)).resolves.toBe(Date.parse("2026-09-21T10:00:00Z"));

		await expect(
			editBill(deps(), series.id, {
				frequency: { preset: "interval", interval: "3", unit: "monthly" },
			}),
		).resolves.toMatchObject({ rules: [monthly(10, 3)] });
		await expect(
			editBill(deps(), series.id, { frequency: { preset: "monthly", dayOfMonth: "-1" } }),
		).resolves.toMatchObject({
			rules: [monthly(-1)],
			expectedDayOfMonth: 31,
			frequency: { key: "monthly", dayOfMonth: -1 },
			nextExpectedDate: "2026-10-31",
		});
		await expect(
			editBill(deps(), series.id, { frequency: { preset: "weekly", weekday: "1" } }),
		).resolves.toMatchObject({
			rules: [{ frequency: "weekly", interval: 1, weekday: 1 }],
			nextExpectedDate: "2026-10-12",
		});
		await expect(
			refusal(editBill(deps(), series.id, { frequency: { preset: "weekly", weekday: "7" } })),
		).resolves.toMatchObject({ fields: [{ path: "frequency.weekday", code: "invalid_value" }] });
	});

	it("dates a followed series from today on its new schedule", async () => {
		const accountId = await account();
		const [entry = ""] = await addRows(accountId, ["2026-09-10"], "PRLV EDF", -6500);
		const added = await addRecurringFromEntry(deps(), entry);

		await expect(
			editBill(deps(), added.id, { frequency: { preset: "quarterly", dayOfMonth: "10" } }),
		).resolves.toMatchObject({ anchorDate: "2026-09-10", nextExpectedDate: "2026-12-10" });
	});

	it("dates a suggestion from its last payment on its new schedule", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "PRLV EDF", -6500);
		await runRecurring(deps(), { backfill: false });
		const [suggestion] = await stored();

		await expect(
			editBill(deps(), suggestion!.id, {
				frequency: { preset: "semimonthly", dayOfMonth: "10", secondDayOfMonth: "25" },
			}),
		).resolves.toMatchObject({ nextExpectedDate: "2026-09-25", status: "suggested" });
	});

	it("counts an installment's payments, and clears the count for any other type", async () => {
		const accountId = await account();
		const [entry = ""] = await addRows(accountId, ["2026-09-05"], "KLARNA", -2500);
		const plan = await addRecurringFromEntry(deps(), entry);

		await expect(
			editBill(deps(), plan.id, { billType: "installment", endAfterCount: "3" }),
		).resolves.toMatchObject({
			billType: "installment",
			endAfterCount: 3,
			anchorDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
		});
		await expect(editBill(deps(), plan.id, { endAfterCount: "1" })).resolves.toMatchObject({
			endAfterCount: 1,
			// Its one payment is behind it: it keeps its date.
			nextExpectedDate: "2026-10-05",
		});
		await expect(
			refusal(editBill(deps(), plan.id, { endAfterCount: "601" })),
		).resolves.toMatchObject({ fields: [{ path: "endAfterCount", code: "invalid_count" }] });
		await expect(
			editBill(deps(), plan.id, { billType: "other", endAfterCount: "3" }),
		).resolves.toMatchObject({
			billType: "other",
			endAfterCount: null,
		});
	});

	it("normalises a link and refuses one that is not http or https", async () => {
		const { series } = await declared();

		await expect(
			editBill(deps(), series.id, { paymentUrl: "banque.fr/payer" }),
		).resolves.toMatchObject({ paymentUrl: "https://banque.fr/payer" });
		await expect(
			editBill(deps(), series.id, { paymentUrl: "localhost:8080" }),
		).resolves.toMatchObject({
			paymentUrl: "https://localhost:8080",
		});
		await expect(
			refusal(editBill(deps(), series.id, { paymentUrl: "ftp://x" })),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "paymentUrl", code: "invalid_url" }],
		});
		await expect(
			refusal(editBill(deps(), series.id, { paymentUrl: "https://" })),
		).resolves.toMatchObject({
			fields: [{ path: "paymentUrl", code: "invalid_url" }],
		});
	});

	it("refuses an unknown series or category, and a move onto another series", async () => {
		const { accountId, series } = await declared();
		await declareBill(deps(), bill(accountId, { amount: "90,00" }));

		await expect(refusal(editBill(deps(), "nope", { name: "X" }))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			refusal(editBill(deps(), series.id, { categoryId: "nope" })),
		).resolves.toMatchObject({
			fields: [{ path: "categoryId", code: "invalid_value" }],
		});
		// The other bill's dedup scope is its own amount, so the amounts never collide.
		await expect(editBill(deps(), series.id, { amount: "90,00" })).resolves.toMatchObject({
			amount: -9000,
		});
	});

	it("answers RECURRING_ALREADY_EXISTS for a move onto a detected series' account, key and amount", async () => {
		const accountId = await account();
		const other = await account("EUR", "Autre");
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "PRLV EDF", -6500);
		await addRows(other, ["2026-07-10", "2026-08-10", "2026-09-10"], "PRLV EDF", -6500);
		await runRecurring(deps(), { backfill: false });
		const [first, second] = await stored();
		await setRecurringStatus(deps(), first!.id, "active");

		await expect(
			refusal(editBill(deps(), first!.id, { accountId: second!.accountId })),
		).resolves.toMatchObject({ code: "RECURRING_ALREADY_EXISTS" });
	});
});

describe("updateBill", () => {
	it("edits and moves the status in one write, a status already held left as it is", async () => {
		const { series } = await declared();

		await expect(
			updateBill(deps(), series.id, { name: "Eau", status: "inactive" }),
		).resolves.toMatchObject({ name: "Eau", status: "inactive" });
		await expect(updateBill(deps(), series.id, { status: "inactive" })).resolves.toMatchObject({
			status: "inactive",
		});
		await expect(updateBill(deps(), series.id, { status: "active" })).resolves.toMatchObject({
			status: "active",
		});
	});

	it("writes nothing when the status move is refused", async () => {
		const { series } = await declared();
		// Only an active series pauses.
		await temp.db
			.update(recurringTransactions)
			.set({ status: "suggested" })
			.where(eq(recurringTransactions.id, series.id));

		await expect(
			refusal(updateBill(deps(), series.id, { name: "Eau", status: "inactive" })),
		).resolves.toMatchObject({ fields: [{ path: "status" }] });
		await expect(stored()).resolves.toMatchObject([{ name: "Eau du Grand Lyon" }]);
	});
});

describe("a bill paid from any account", () => {
	it("declares one in the reporting currency, and refuses its twin without an account", async () => {
		const accountId = await account();

		const water = await declareBill(deps(), bill(null, { amount: "12,00" }));

		expect(water).toMatchObject({
			accountId: null,
			accountName: null,
			accountType: null,
			currency: "EUR",
			amount: -1200,
		});
		await expect(
			refusal(declareBill(deps(), bill(null, { amount: "12,00" }))),
		).resolves.toMatchObject({ code: "RECURRING_ALREADY_EXISTS" });
		await expect(declareBill(deps(), bill(accountId, { amount: "12,00" }))).resolves.toMatchObject({
			accountId,
		});
		await expect(stored()).resolves.toHaveLength(2);
	});

	it("moves to any account keeping its currency, and back to an account", async () => {
		const dollars = await account("USD", "Dollars");
		const water = await declareBill(deps(), bill(dollars, { amount: "95.10" }));

		await expect(editBill(deps(), water.id, { accountId: null })).resolves.toMatchObject({
			accountId: null,
			currency: "USD",
			amount: -9510,
		});
		await expect(editBill(deps(), water.id, { amount: "96.00" })).resolves.toMatchObject({
			accountId: null,
			currency: "USD",
			amount: -9600,
		});
		await expect(editBill(deps(), water.id, { accountId: dollars })).resolves.toMatchObject({
			accountId: dollars,
			accountName: "Dollars",
		});
	});

	it("refuses a move to any account onto a twin without one", async () => {
		const accountId = await account();
		await declareBill(deps(), bill(null));
		const twin = await declareBill(deps(), bill(accountId));

		await expect(refusal(editBill(deps(), twin.id, { accountId: null }))).resolves.toMatchObject({
			code: "RECURRING_ALREADY_EXISTS",
		});
	});

	it("is paid by a line of each account on its due dates", async () => {
		const first = await account("EUR", "Courant");
		const second = await account("EUR", "Joint");
		const water = await declareBill(
			deps(),
			bill(null, { amount: "12,00", firstDueOn: "2026-08-05" }),
		);
		await addRows(first, ["2026-08-05"], "Eau du Grand Lyon", -1200);
		await addRows(second, ["2026-09-05"], "Eau du Grand Lyon", -1200);

		await runRecurring(deps(), { backfill: true });

		await expect(
			temp.db
				.select({ dueOn: recurringOccurrences.dueOn, status: recurringOccurrences.status })
				.from(recurringOccurrences)
				.where(eq(recurringOccurrences.recurringTransactionId, water.id))
				.orderBy(recurringOccurrences.dueOn),
		).resolves.toEqual(
			expect.arrayContaining([
				{ dueOn: "2026-08-05", status: "paid" },
				{ dueOn: "2026-09-05", status: "paid" },
			]),
		);
	});

	it("is listed on the bills page and among all bills", async () => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
		await account();
		const water = await declareBill(deps(), bill(null, { firstDueOn: "2026-10-20" }));

		const overview = await billsOverview(deps());
		const { bills } = await allBills(deps(), query());

		expect([...overview.month, ...overview.later]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ seriesId: water.id, accountId: null, accountName: null }),
			]),
		);
		expect(bills).toEqual([expect.objectContaining({ id: water.id, accountId: null })]);
		await expect(billDetail(deps(), water.id)).resolves.toMatchObject({ lastAccount: null });
	});
});

async function opened(
	name: string,
	type: "loan" | "depository" | "credit_card",
	subtype: "mortgage" | "savings" | null,
) {
	const created = await createAccount(
		deps(),
		{
			name,
			type,
			subtype,
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2026-01-01",
		},
		{ origin: "user" },
	);

	return created.id;
}

/** `amount`, −800,00 € by default, out of `from` into `to` on `date`, which ingestion pairs; answers the transfer's id. */
async function transfer(from: string, to: string, date: string, amount = 80_000) {
	const [outflow = ""] = await addRows(from, [date], "ECHEANCE PRET", -amount);
	await addRows(to, [date], "ECHEANCE", amount);
	return (await findTransaction(deps(), outflow))!.transfer!.id;
}

describe("markTransferRecurring", () => {
	it("follows a transfer into a loan as an active manual recurring transfer, on « Factures »", async () => {
		const checking = await account();
		const loan = await opened("Prêt immobilier", "loan", "mortgage");

		const marked = await markTransferRecurring(
			deps(),
			await transfer(checking, loan, "2026-09-05"),
		);

		expect(marked).toMatchObject({
			name: "Remboursement vers Prêt immobilier",
			accountId: checking,
			destinationAccountId: loan,
			destinationAccountName: "Prêt immobilier",
			destinationAccountType: "loan",
			merchantId: null,
			amount: -80_000,
			expectedAmountMin: null,
			expectedAmountMax: null,
			currency: "EUR",
			expectedDayOfMonth: 5,
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 1,
			status: "active",
			manual: true,
			billType: "transfer",
			categoryId: null,
			rules: [monthly(5)],
		});
		await expect(stored()).resolves.toMatchObject([{ labelKey: null, dedupScope: "" }]);

		const overview = await billsOverview(deps());

		expect(
			[...overview.attention, ...overview.month, ...overview.later].map((row) => ({
				seriesId: row.seriesId,
				dueOn: row.dueOn,
				destinationAccountId: row.destinationAccountId,
			})),
		).toEqual([
			{ seriesId: marked.id, dueOn: "2026-09-05", destinationAccountId: loan },
			{ seriesId: marked.id, dueOn: "2026-10-05", destinationAccountId: loan },
		]);
	});

	it("answers RECURRING_TRANSFER_ALREADY_EXISTS for a second transfer of the pair and amount, whatever the status", async () => {
		const checking = await account();
		const loan = await opened("Prêt immobilier", "loan", "mortgage");
		const first = await markTransferRecurring(deps(), await transfer(checking, loan, "2026-08-05"));
		await setRecurringStatus(deps(), first.id, "inactive");

		await expect(
			refusal(markTransferRecurring(deps(), await transfer(checking, loan, "2026-09-05"))),
		).resolves.toEqual({
			code: "RECURRING_TRANSFER_ALREADY_EXISTS",
			message: "A recurring transfer already exists for this pair of accounts.",
		});
		await expect(stored()).resolves.toHaveLength(1);
		await expect(refusal(markTransferRecurring(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("leaves a transfer into savings off « Factures », on « Toutes les factures » as a transfer", async () => {
		const checking = await account();
		const savings = await opened("Livret A", "depository", "savings");

		const marked = await markTransferRecurring(
			deps(),
			await transfer(checking, savings, "2026-09-05"),
		);

		expect(marked.name).toBe("Virement vers Livret A");
		const now = Date.now();
		// Nor does its price change make news.
		await temp.db.insert(recurringPriceChanges).values({
			id: "savings-change",
			recurringTransactionId: marked.id,
			effectiveOn: "2026-09-05",
			previousAmount: 10_000,
			newAmount: 20_000,
			currency: "EUR",
			createdAt: now,
			updatedAt: now,
		});
		const overview = await billsOverview(deps());
		expect([...overview.attention, ...overview.month, ...overview.later]).toEqual([]);
		expect(overview.notices).toEqual([]);
		await expect(allBills(deps(), { type: "transfer", sort: "due" })).resolves.toMatchObject({
			bills: [{ id: marked.id, billType: "transfer" }],
		});
	});

	it("lists a recurring transfer into a credit card on « Factures »", async () => {
		const checking = await account();
		const card = await opened("Carte", "credit_card", null);

		const marked = await markTransferRecurring(
			deps(),
			await transfer(checking, card, "2026-09-05"),
		);

		expect(marked.name).toBe("Remboursement vers Carte");
		const overview = await billsOverview(deps());
		expect(
			[...overview.attention, ...overview.month, ...overview.later].map((row) => row.seriesId),
		).toEqual([marked.id, marked.id]);
	});

	it("takes an amount another destination holds, never one another transfer into the same holds", async () => {
		const checking = await account();
		const loan = await opened("Prêt immobilier", "loan", "mortgage");
		const other = await opened("Prêt auto", "loan", "mortgage");
		const first = await markTransferRecurring(
			deps(),
			await transfer(checking, loan, "2026-09-05", 80_000),
		);
		await markTransferRecurring(deps(), await transfer(checking, other, "2026-09-07", 50_000));
		await markTransferRecurring(deps(), await transfer(checking, loan, "2026-09-09", 60_000));

		await expect(editBill(deps(), first.id, { amount: "500,00" })).resolves.toMatchObject({
			amount: -50_000,
		});
		await expect(refusal(editBill(deps(), first.id, { amount: "600,00" }))).resolves.toMatchObject({
			code: "RECURRING_ALREADY_EXISTS",
		});
	});

	it("keeps its account and type through an edit, as Sure's dialog", async () => {
		const checking = await account();
		const other = await account("EUR", "Autre");
		const loan = await opened("Prêt immobilier", "loan", "mortgage");
		const marked = await markTransferRecurring(
			deps(),
			await transfer(checking, loan, "2026-09-05"),
		);

		await expect(refusal(editBill(deps(), marked.id, { accountId: other }))).resolves.toEqual({
			code: "VALIDATION_ERROR",
			message: "The request is invalid.",
			fields: [{ path: "accountId", code: "invalid_value" }],
		});
		await expect(
			refusal(editBill(deps(), marked.id, { billType: "subscription" })),
		).resolves.toMatchObject({ fields: [{ path: "billType", code: "invalid_value" }] });
		await expect(
			editBill(deps(), marked.id, { name: "Crédit maison", amount: "850,00" }),
		).resolves.toMatchObject({
			name: "Crédit maison",
			amount: -85_000,
			accountId: checking,
			destinationAccountId: loan,
			billType: "transfer",
		});
	});
});
