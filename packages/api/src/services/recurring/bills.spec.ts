import type { DeclareInput } from "../../schemas/bills.ts";
import type { TempDatabase } from "../../testing/temp-database.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { AppError } from "../../lib/errors.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createAccount } from "../ledger/accounts.ts";
import { updateTransaction } from "../ledger/edits.ts";
import { ingest } from "../ledger/ingest.ts";
import { oneByOne } from "../ledger/shared.ts";
import { billCandidates, billsOverview, declareBill, editBill, occurrenceDetail } from "./bills.ts";
import { addPayment, editOccurrence, skipOccurrence } from "./payments.ts";
import { runRecurring } from "./pipeline.ts";
import { addRecurringFromEntry, setRecurringStatus } from "./series.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeEach(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});

afterEach(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

async function account(currency: CurrencyCode = "EUR", name = "Compte") {
	const created = await createAccount(
		deps(),
		{
			name,
			type: "depository",
			subtype: "checking",
			currency,
			openingBalance: toMinorUnits(0),
			openingDate: "2026-01-01",
		},
		{ origin: "user" },
	);

	return created.id;
}

async function addRows(
	accountId: string,
	dates: readonly string[],
	label: string,
	amount: number,
	currency: CurrencyCode = "EUR",
) {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: dates.map((date) => ({
				externalId: null,
				date,
				amount: toMinorUnits(amount),
				currency,
				label,
				reference: null,
				notes: null,
				pending: false,
			})),
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);

	return result.created;
}

const stored = () => temp.db.select().from(recurringTransactions);

const bill = (accountId: string, overrides: Partial<DeclareInput> = {}): DeclareInput => ({
	kind: "bill",
	name: "Eau du Grand Lyon",
	amount: "84,20",
	accountId,
	firstDueOn: "2026-10-10",
	frequency: { preset: "monthly" },
	...overrides,
});

/** The error `promise` rejects with, as the API would answer it. */
async function refusal(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);

	if (!(error instanceof AppError)) {
		throw new Error("The promise did not reject with an AppError.");
	}

	return error.toJSON().error;
}

const monthly = (day: number, interval = 1) => ({
	frequency: "monthly",
	interval,
	dayOfMonth: day,
});

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

	it("takes the key and label of the transaction it starts from, its name typed", async () => {
		const accountId = await account();
		await temp.db
			.insert(merchants)
			.values({ id: "credit-agricole", name: "Crédit Agricole", createdAt: 0, updatedAt: 0 });
		const [loan = ""] = await addRows(accountId, ["2026-09-07"], "ECH PRET 0123", -57_122);
		const [other = ""] = await addRows(accountId, ["2026-09-08"], "PRLV  SFR", -2999);
		await updateTransaction(deps(), loan, { merchantId: "credit-agricole" }, { origin: "user" });

		await expect(
			declareBill(
				deps(),
				bill(accountId, { name: "Prêt immobilier", amount: "571,22", entryId: loan }),
			),
		).resolves.toMatchObject({
			merchantId: "credit-agricole",
			merchantName: "Crédit Agricole",
			label: "ECH PRET 0123",
			name: "Prêt immobilier",
		});
		await declareBill(deps(), bill(accountId, { name: "Box", amount: "29,99", entryId: other }));

		await expect(stored()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "Prêt immobilier",
					merchantId: "credit-agricole",
					labelKey: null,
				}),
				expect.objectContaining({ name: "Box", merchantId: null, labelKey: "prlv sfr" }),
			]),
		);
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

	it("refuses an unknown account, transaction, amount, interval or link, writing nothing", async () => {
		const accountId = await account();

		await expect(refusal(declareBill(deps(), bill("nope")))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "accountId", code: "invalid_value" }],
		});
		await expect(
			refusal(declareBill(deps(), bill(accountId, { entryId: "nope" }))),
		).resolves.toMatchObject({
			code: "NOT_FOUND",
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
			kind: "expense",
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

describe("billCandidates", () => {
	it("offers outflows seen twice that no series follows, latest first, with their latest transaction", async () => {
		const accountId = await account();
		const water = await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);
		const box = await addRows(accountId, ["2026-08-12", "2026-09-12"], "BOX", -2999);
		await addRows(accountId, ["2026-08-04", "2026-09-04"], "PENNY", -99);
		await addRows(accountId, ["2026-08-05", "2026-09-05"], "REMBOURSEMENT", 3000);
		await addRows(accountId, ["2026-09-06"], "ONCE", -5000);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			{
				entryId: box[1],
				name: "BOX",
				amount: 2999,
				currency: "EUR",
				accountId,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-09-12",
				entryAmount: -2999,
			},
			expect.objectContaining({ entryId: water[1], name: "EAU", amount: 3000 }),
		]);
	});

	it("leaves out a pattern a series claims, and names one by its merchant", async () => {
		const accountId = await account();
		await temp.db.insert(merchants).values({ id: "sfr", name: "SFR", createdAt: 0, updatedAt: 0 });
		const box = await addRows(accountId, ["2026-08-12", "2026-09-12"], "PRLV SFR", -2999);
		await oneByOne(box, (id) =>
			updateTransaction(deps(), id, { merchantId: "sfr" }, { origin: "user" }),
		);
		const water = await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "SFR" }),
			expect.objectContaining({ name: "EAU" }),
		]);

		await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "30,50", entryId: water[1]! }),
		);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "SFR" }),
		]);
	});

	it("leaves out an inactive account's patterns, which the dialog does not offer", async () => {
		const accountId = await account();
		const closed = await account("EUR", "Fermé");
		await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);
		await addRows(closed, ["2026-08-12", "2026-09-12"], "BOX", -2999);
		await addRows(closed, ["2026-08-28", "2026-09-18"], "SALAIRE", 250_000);
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, closed));

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "EAU", accountId }),
		]);
		await expect(billCandidates(deps(), "income")).resolves.toEqual([]);
	});

	it("offers eight at most", async () => {
		const accountId = await account();

		await oneByOne([...Array.from({ length: 10 }).keys()], (index) =>
			addRows(accountId, ["2026-08-10", "2026-09-10"], `ABONNEMENT ${index}`, -1000 - index * 500),
		);

		await expect(billCandidates(deps(), "bill")).resolves.toHaveLength(8);
	});

	it("offers deposits of the last 90 days seen twice, largest total first, that no income series follows", async () => {
		const accountId = await account();
		const pay = await addRows(accountId, ["2026-07-28", "2026-08-28"], "SALAIRE", 250_000);
		await addRows(accountId, ["2026-08-10", "2026-08-24", "2026-09-07"], "FREELANCE", 40_000);
		await addRows(accountId, ["2026-08-01", "2026-09-01"], "INTERETS", 50);
		await addRows(accountId, ["2026-05-01", "2026-09-01"], "VIEUX", 10_000);
		await addRows(accountId, ["2026-09-01", "2026-09-02"], "PRLV", -10_000);

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			{
				entryId: pay[1],
				name: "SALAIRE",
				amount: 250_000,
				currency: "EUR",
				accountId,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-08-28",
				entryAmount: 250_000,
			},
			expect.objectContaining({ name: "FREELANCE", amount: 40_000, occurrenceCount: 3 }),
		]);

		await declareBill(
			deps(),
			bill(accountId, { kind: "income", name: "Salaire", amount: "1,00", entryId: pay[0]! }),
		);

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			expect.objectContaining({ name: "FREELANCE" }),
		]);
	});
});

/** A series' occurrences, by due date. */
const occurrencesOf = (seriesId: string) =>
	temp.db
		.select({ id: recurringOccurrences.id, dueOn: recurringOccurrences.dueOn })
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.recurringTransactionId, seriesId))
		.orderBy(recurringOccurrences.dueOn);

const firstOf = async (seriesId: string) => (await occurrencesOf(seriesId))[0]!;

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
