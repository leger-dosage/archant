import type { DeclareInput } from "../../schemas/bills.ts";
import type { TempDatabase } from "../../testing/temp-database.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { AppError } from "../../lib/errors.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createAccount } from "../ledger/accounts.ts";
import { updateTransaction } from "../ledger/edits.ts";
import { ingest } from "../ledger/ingest.ts";
import { oneByOne } from "../ledger/shared.ts";
import { billCandidates, declareBill, editBill } from "./bills.ts";
import { addRecurringFromEntry, detectRecurring, setRecurringStatus } from "./series.ts";

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
		await detectRecurring(deps());
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
		await detectRecurring(deps());
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
		await detectRecurring(deps());
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
