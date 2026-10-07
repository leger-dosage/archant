import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { recurringMatchRejections } from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { AppError } from "../../lib/errors.ts";
import {
	addRows,
	declareMortgage,
	deps,
	occurrencesOf,
	openAccount,
	payments,
	temp,
	useRecurringDatabase,
} from "../../testing/recurring.ts";
import { deleteTransaction } from "../ledger/edits.ts";
import { oneByOne } from "../ledger/shared.ts";
import { splitTransaction } from "../ledger/splits.ts";
import { declareBill, editBill } from "./bills.ts";
import {
	addPayment,
	confirmPayment,
	editOccurrence,
	markPaid,
	paymentCandidates,
	recordBillPayment,
	rejectPayment,
	removePayment,
	reopenOccurrence,
	skipOccurrence,
} from "./payments.ts";
import { runRecurring } from "./pipeline.ts";

useRecurringDatabase("2026-08-10T10:00:00Z");

/** The mortgage due on the 5th, and the 10 August payment the sync just brought, suggested. */
async function suggested() {
	const accountId = await openAccount();
	const series = await declareMortgage(accountId);
	const [late = ""] = await addRows(accountId, [{ date: "2026-08-10", amount: -57_136 }]);
	await runRecurring(deps(), { backfill: false });
	const [payment] = await payments();

	return { accountId, series, late, payment: payment! };
}

const august = async (seriesId: string) =>
	(await occurrencesOf(seriesId)).find((occurrence) => occurrence.dueOn === "2026-08-05")!;

async function codeOf(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);

	return error instanceof AppError ? error.toJSON().error : error;
}

const seriesRow = (id: string) =>
	temp.db
		.select({
			nameAliases: recurringTransactions.nameAliases,
			learnedTolerance: recurringTransactions.learnedTolerance,
		})
		.from(recurringTransactions)
		.where(eq(recurringTransactions.id, id))
		.get();

describe("confirmPayment", () => {
	it("makes the suggestion a payment the owner confirmed, which pays the occurrence", async () => {
		const { series, late, payment } = await suggested();

		await expect(confirmPayment(deps(), payment.id)).resolves.toEqual({
			id: payment.id,
			occurrenceId: (await august(series.id)).id,
			entryId: late,
			amount: 57_129,
			state: "confirmed",
			source: "user_confirmed",
			paidOn: "2026-08-10",
		});
		await expect(august(series.id)).resolves.toMatchObject({
			status: "paid",
			closedSource: "auto",
			expectedAmount: 57_129,
		});
	});

	it("refuses an unknown payment", async () => {
		await expect(codeOf(confirmPayment(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("rejectPayment", () => {
	it("records a rejection, and that transaction is never suggested again for that series", async () => {
		const { series, late, payment } = await suggested();

		await expect(rejectPayment(deps(), payment.id)).resolves.toEqual({ id: payment.id });
		await runRecurring(deps(), { backfill: false });

		await expect(payments()).resolves.toEqual([]);
		await expect(
			temp.db
				.select({
					series: recurringMatchRejections.recurringTransactionId,
					entry: recurringMatchRejections.entryId,
				})
				.from(recurringMatchRejections),
		).resolves.toEqual([{ series: series.id, entry: late }]);
		await expect(august(series.id)).resolves.toMatchObject({ status: "scheduled" });
	});

	it("reopens an occurrence its rejected payment had paid", async () => {
		const { series, payment } = await suggested();
		await confirmPayment(deps(), payment.id);

		await rejectPayment(deps(), payment.id);

		await expect(august(series.id)).resolves.toMatchObject({
			status: "scheduled",
			closedSource: null,
			// Frozen by the confirmation, as Sure's reopen keeps it.
			expectedAmount: 57_129,
		});
	});

	it("refuses an unknown payment", async () => {
		await expect(codeOf(rejectPayment(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("addPayment with a transaction", () => {
	it("pays the occurrence with what it still needs, then learns the label and the gap", async () => {
		const accountId = await openAccount();
		const series = await declareBill(deps(), {
			kind: "bill",
			name: "Eau",
			amount: "100,00",
			accountId,
			firstDueOn: "2026-08-05",
			frequency: { preset: "monthly" },
		});
		const [paid = ""] = await addRows(accountId, [
			{ date: "2026-08-09", amount: -10_800, label: "PRLV SEPA EAU DU GRAND LYON" },
		]);
		const occurrence = await august(series.id);

		await expect(addPayment(deps(), occurrence.id, { entryId: paid })).resolves.toMatchObject({
			entryId: paid,
			amount: 10_000,
			state: "confirmed",
			source: "user_confirmed",
			paidOn: "2026-08-09",
		});
		await expect(august(series.id)).resolves.toMatchObject({ status: "paid" });
		// 8 % above: 80 ‰ learned, and the label joins the aliases.
		await expect(seriesRow(series.id)).resolves.toEqual({
			nameAliases: ["PRLV SEPA EAU DU GRAND LYON"],
			learnedTolerance: 80,
		});
	});

	it("learns nothing past 25 %, nor a label the series knows", async () => {
		const accountId = await openAccount();
		const series = await declareBill(deps(), {
			kind: "bill",
			name: "Eau",
			amount: "100,00",
			accountId,
			firstDueOn: "2026-08-05",
			frequency: { preset: "monthly" },
		});
		const [paid = ""] = await addRows(accountId, [
			{ date: "2026-08-09", amount: -13_000, label: "EAU" },
		]);

		await addPayment(deps(), (await august(series.id)).id, { entryId: paid });

		await expect(seriesRow(series.id)).resolves.toEqual({
			nameAliases: [],
			learnedTolerance: null,
		});
	});

	it("never spends more than the transaction, answering PAYMENT_EXCEEDS_TRANSACTION once it is spent", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [part = ""] = await addRows(accountId, [{ date: "2026-08-06", amount: -10_000 }]);
		const [august5, september] = await occurrencesOf(series.id);

		await expect(addPayment(deps(), august5!.id, { entryId: part })).resolves.toMatchObject({
			amount: 10_000,
		});
		await expect(august(series.id)).resolves.toMatchObject({ status: "scheduled" });
		await expect(codeOf(addPayment(deps(), september!.id, { entryId: part }))).resolves.toEqual({
			code: "PAYMENT_EXCEEDS_TRANSACTION",
			message: "The transaction's amount is already spent on other payments.",
		});
	});

	it("gives an occurrence already covered the transaction's whole remainder", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [first = "", second = ""] = await addRows(accountId, [
			{ date: "2026-08-05", amount: -57_129 },
			{ date: "2026-08-06", amount: -2000, label: "FRAIS" },
		]);
		const occurrence = await august(series.id);
		await addPayment(deps(), occurrence.id, { entryId: first });

		await expect(addPayment(deps(), occurrence.id, { entryId: second })).resolves.toMatchObject({
			amount: 2000,
		});
	});

	it("refuses an unknown occurrence or transaction, another currency, and a transaction already attached", async () => {
		const accountId = await openAccount();
		const dollars = await openAccount("USD");
		const series = await declareMortgage(accountId);
		const [paid = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -57_129 }]);
		const [foreign = ""] = await addRows(dollars, [{ date: "2026-08-05", amount: -57_129 }], "USD");
		const occurrence = await august(series.id);
		await addPayment(deps(), occurrence.id, { entryId: paid });

		await expect(codeOf(addPayment(deps(), "nope", { entryId: paid }))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			codeOf(addPayment(deps(), occurrence.id, { entryId: "nope" })),
		).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			codeOf(addPayment(deps(), occurrence.id, { entryId: foreign })),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "currency_mismatch" }],
		});
		await expect(
			codeOf(addPayment(deps(), occurrence.id, { entryId: paid })),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "already_attached" }],
		});
	});
});

describe("addPayment with a transaction on a split", () => {
	it("refuses the split's parent, whose lines carry the money, and takes a line", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [parent = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -60_000 }]);
		const split = await splitTransaction(
			deps(),
			parent,
			[
				{ label: "Prêt immobilier", amount: toMinorUnits(-57_129), categoryId: null },
				{ label: "Assurance", amount: toMinorUnits(-2871), categoryId: null },
			],
			{ origin: "user" },
		);
		const occurrence = await august(series.id);

		await expect(
			codeOf(addPayment(deps(), occurrence.id, { entryId: parent })),
		).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "split_parent" }],
		});
		await expect(
			addPayment(deps(), occurrence.id, { entryId: split.childIds[0]! }),
		).resolves.toMatchObject({
			amount: 57_129,
		});
	});
});

describe("a deleted transaction", () => {
	it("leaves its payment standing, with no transaction, and the occurrence paid", async () => {
		const { series, late, payment } = await suggested();
		await confirmPayment(deps(), payment.id);

		await deleteTransaction(deps(), late, { origin: "user" });

		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ id: payment.id, entryId: null, amount: 57_129 }),
		]);
		await expect(august(series.id)).resolves.toMatchObject({ status: "paid" });
	});
});

/** The water bill, 300,00 € due on 5 August, with 180,00 € paid by hand on the 6th. */
async function partlyPaid() {
	const accountId = await openAccount();
	const series = await declareBill(deps(), {
		kind: "bill",
		name: "Eau",
		amount: "300,00",
		accountId,
		firstDueOn: "2026-08-05",
		frequency: { preset: "monthly" },
	});
	const occurrence = await august(series.id);
	const part = await addPayment(deps(), occurrence.id, { amount: "180,00", paidOn: "2026-08-06" });

	return { accountId, series, occurrence, part };
}

describe("markPaid", () => {
	it("settles what remains with a payment of no transaction, today, and closes it paid by the owner", async () => {
		const { series, occurrence } = await partlyPaid();

		await expect(markPaid(deps(), occurrence.id)).resolves.toMatchObject({
			id: occurrence.id,
			status: "paid",
			closedSource: "user",
			expectedAmount: 30_000,
		});
		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ entryId: null, amount: 18_000, source: "user_created" }),
			expect.objectContaining({
				entryId: null,
				amount: 12_000,
				state: "confirmed",
				source: "user_created",
				paidOn: "2026-08-10",
			}),
		]);
		await expect(august(series.id)).resolves.toMatchObject({ status: "paid" });
	});

	it("freezes an amount nothing froze yet, which a later price leaves as it is", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const occurrence = await august(series.id);
		expect(occurrence.expectedAmount).toBeNull();

		await expect(markPaid(deps(), occurrence.id)).resolves.toMatchObject({
			status: "paid",
			expectedAmount: 57_129,
		});
		await expect(payments()).resolves.toEqual([
			expect.objectContaining({ entryId: null, amount: 57_129, source: "user_created" }),
		]);

		await editBill(deps(), series.id, { amount: "600,00" });

		await expect(august(series.id)).resolves.toMatchObject({ expectedAmount: 57_129 });
	});

	it("dates the payment on the day the owner names", async () => {
		const { occurrence } = await partlyPaid();

		await markPaid(deps(), occurrence.id, "2026-08-08");

		await expect(payments()).resolves.toContainEqual(
			expect.objectContaining({ amount: 12_000, paidOn: "2026-08-08" }),
		);
	});

	it("adds no payment when nothing remains, and closes it all the same", async () => {
		const { occurrence } = await partlyPaid();
		await addPayment(deps(), occurrence.id, { amount: "120,00", paidOn: "2026-08-07" });
		await reopenOccurrence(deps(), occurrence.id);

		await expect(markPaid(deps(), occurrence.id)).resolves.toMatchObject({
			status: "paid",
			closedSource: "user",
		});
		await expect(payments()).resolves.toHaveLength(2);
	});

	it("refuses a closed occurrence and an unknown one", async () => {
		const { occurrence } = await partlyPaid();
		await skipOccurrence(deps(), occurrence.id);

		await expect(codeOf(markPaid(deps(), occurrence.id))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});
		await expect(codeOf(markPaid(deps(), "nope"))).resolves.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("addPayment without a transaction", () => {
	it("records the amount and the date given, confirmed and created by the owner", async () => {
		const { series, occurrence, part } = await partlyPaid();

		expect(part).toEqual({
			id: part.id,
			occurrenceId: occurrence.id,
			entryId: null,
			amount: 18_000,
			state: "confirmed",
			source: "user_created",
			paidOn: "2026-08-06",
		});
		// 180,00 € of 300,00 €: partial, so still open, its amount frozen.
		await expect(august(series.id)).resolves.toMatchObject({
			status: "scheduled",
			expectedAmount: 30_000,
		});
	});

	it("closes the occurrence once the payments add up to it", async () => {
		const { series, occurrence } = await partlyPaid();

		await addPayment(deps(), occurrence.id, { amount: "120,00", paidOn: "2026-08-07" });

		await expect(august(series.id)).resolves.toMatchObject({
			status: "paid",
			closedSource: "auto",
		});
	});

	it("needs an amount and a date, the amount positive in the occurrence's currency", async () => {
		const { occurrence } = await partlyPaid();
		const refused = (input: Parameters<typeof addPayment>[2]) =>
			codeOf(addPayment(deps(), occurrence.id, input));

		await expect(refused({ paidOn: "2026-08-07" })).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "amount", code: "invalid_type" }],
		});
		await expect(refused({ amount: "12,345", paidOn: "2026-08-07" })).resolves.toMatchObject({
			fields: [{ path: "amount", code: "invalid_amount" }],
		});
		await expect(refused({ amount: "0", paidOn: "2026-08-07" })).resolves.toMatchObject({
			fields: [{ path: "amount", code: "not_positive" }],
		});
		await expect(refused({ amount: "10,00" })).resolves.toMatchObject({
			fields: [{ path: "paidOn", code: "invalid_type" }],
		});
		await expect(
			codeOf(addPayment(deps(), "nope", { amount: "10,00", paidOn: "2026-08-07" })),
		).resolves.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("addPayment with a transaction and an amount", () => {
	it("takes the amount given, at the date given, never past what the transaction has left", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [paid = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -57_129 }]);
		const [august5, september] = await occurrencesOf(series.id);

		await expect(
			addPayment(deps(), august5!.id, { entryId: paid, amount: "500,00", paidOn: "2026-08-04" }),
		).resolves.toMatchObject({ entryId: paid, amount: 50_000, paidOn: "2026-08-04" });
		// 71,29 € are left of the transaction.
		await expect(
			codeOf(addPayment(deps(), september!.id, { entryId: paid, amount: "71,30" })),
		).resolves.toMatchObject({ code: "PAYMENT_EXCEEDS_TRANSACTION" });
		await expect(
			addPayment(deps(), september!.id, { entryId: paid, amount: "71,29" }),
		).resolves.toMatchObject({ amount: 7129, paidOn: "2026-08-05" });
	});
});

describe("skipOccurrence and reopenOccurrence", () => {
	it("closes an occurrence skipped by the owner, its amount frozen, then reopens it as it was", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const occurrence = await august(series.id);

		await expect(skipOccurrence(deps(), occurrence.id)).resolves.toMatchObject({
			status: "skipped",
			closedSource: "user",
			expectedAmount: 57_129,
		});
		await expect(codeOf(skipOccurrence(deps(), occurrence.id))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});

		await expect(reopenOccurrence(deps(), occurrence.id)).resolves.toMatchObject({
			status: "scheduled",
			closedSource: null,
			expectedAmount: 57_129,
		});
		await expect(codeOf(reopenOccurrence(deps(), occurrence.id))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});
		await expect(codeOf(skipOccurrence(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("keeps a reopened occurrence's payments, and leaves it open though they settle it", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [paid = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -57_129 }]);
		const occurrence = await august(series.id);
		await addPayment(deps(), occurrence.id, { entryId: paid });

		await reopenOccurrence(deps(), occurrence.id);

		await expect(august(series.id)).resolves.toMatchObject({ status: "scheduled" });
		await expect(payments()).resolves.toHaveLength(1);
	});
});

describe("editOccurrence", () => {
	it("postpones an occurrence or changes its amount alone, null clearing either", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const occurrence = await august(series.id);
		const edit = (patch: Parameters<typeof editOccurrence>[2]) =>
			editOccurrence(deps(), occurrence.id, patch);

		await expect(edit({ snoozedUntil: "2026-08-20" })).resolves.toMatchObject({
			snoozedUntil: "2026-08-20",
			expectedAmount: null,
		});
		await expect(edit({ expectedAmount: "600,00" })).resolves.toMatchObject({
			snoozedUntil: "2026-08-20",
			expectedAmount: 60_000,
		});
		await expect(edit({ snoozedUntil: null })).resolves.toMatchObject({ snoozedUntil: null });
		await expect(edit({ expectedAmount: null })).resolves.toMatchObject({ expectedAmount: null });
		await expect(codeOf(edit({ expectedAmount: "six cents" }))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "expectedAmount", code: "invalid_amount" }],
		});
		// The next September occurrence keeps the series' amount.
		await expect(occurrencesOf(series.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ dueOn: "2026-09-05", expectedAmount: null }),
			]),
		);
		await expect(
			codeOf(editOccurrence(deps(), "nope", { snoozedUntil: null })),
		).resolves.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("removePayment", () => {
	it("reopens an occurrence its only payment had paid by itself, recording no rejection", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [paid = ""] = await addRows(accountId, [{ date: "2026-08-05", amount: -57_129 }]);
		const occurrence = await august(series.id);
		const payment = await addPayment(deps(), occurrence.id, { entryId: paid });
		await expect(august(series.id)).resolves.toMatchObject({
			status: "paid",
			closedSource: "auto",
		});

		await expect(removePayment(deps(), payment.id)).resolves.toEqual({ id: payment.id });

		await expect(august(series.id)).resolves.toMatchObject({
			status: "scheduled",
			closedSource: null,
		});
		await expect(payments()).resolves.toEqual([]);
		await expect(temp.db.select().from(recurringMatchRejections)).resolves.toEqual([]);
	});

	it("leaves an occurrence the owner marked paid as it is", async () => {
		const { series, occurrence } = await partlyPaid();
		await markPaid(deps(), occurrence.id);
		const [first] = await payments();

		await removePayment(deps(), first!.id);

		await expect(august(series.id)).resolves.toMatchObject({
			status: "paid",
			closedSource: "user",
		});
	});

	it("refuses an unknown payment", async () => {
		await expect(codeOf(removePayment(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("paymentCandidates", () => {
	it("scores the window's transactions by explain, leaving out the rejected, the held and the spent", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		const [exact = "", near = "", rejected = "", held = "", spent = "", small = "", other = ""] =
			await addRows(accountId, [
				{ date: "2026-08-05", amount: -57_129 },
				{ date: "2026-08-07", amount: -57_136 },
				{ date: "2026-08-06", amount: -57_122 },
				{ date: "2026-08-03", amount: -57_129 },
				{ date: "2026-08-04", amount: -57_129 },
				{ date: "2026-08-06", amount: -999 },
				{ date: "2026-08-05", amount: -57_129, label: "VIREMENT LOYER" },
			]);
		const [occurrence, september] = await occurrencesOf(series.id);
		await temp.db.insert(recurringMatchRejections).values({
			id: "rejected",
			recurringTransactionId: series.id,
			entryId: rejected,
			createdAt: 0,
			updatedAt: 0,
		});
		await addPayment(deps(), occurrence!.id, { entryId: held, amount: "100,00" });
		await addPayment(deps(), september!.id, { entryId: spent });

		const candidates = await paymentCandidates(deps(), occurrence!.id);

		expect(candidates.map((candidate) => candidate.entryId)).toEqual([exact, near]);
		expect(candidates[0]).toEqual({
			entryId: exact,
			label: "Prêt immobilier",
			date: "2026-08-05",
			amount: -57_129,
			currency: "EUR",
			score: 9500,
			signals: { name: 3500, amount: 3000, date: 2000, account: 1000 },
		});
		expect(candidates[1]!.score).toBeLessThan(9500);
		expect([small, other]).not.toContain(candidates[1]!.entryId);
	});

	it("answers NOT_FOUND for an unknown occurrence", async () => {
		await expect(codeOf(paymentCandidates(deps(), "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("recordBillPayment", () => {
	it("settles the current occurrence through markPaid's write, dated today", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);

		await expect(recordBillPayment(deps(), series.id, {})).resolves.toMatchObject({
			dueOn: "2026-08-05",
			status: "paid",
			state: "paid",
			paid: 57_129,
			remaining: 0,
		});
		await expect(august(series.id)).resolves.toMatchObject({ closedSource: "user" });
		await expect(payments()).resolves.toMatchObject([
			{ dueOn: "2026-08-05", amount: 57_129, source: "user_created", paidOn: "2026-08-10" },
		]);
	});

	it("closes an occurrence a partial payment settles, as addPayment's write does", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);

		await recordBillPayment(deps(), series.id, { amount: "500,00", paidOn: "2026-08-07" });

		await expect(recordBillPayment(deps(), series.id, { amount: "71,29" })).resolves.toMatchObject({
			status: "paid",
			remaining: 0,
		});
		await expect(august(series.id)).resolves.toMatchObject({ closedSource: "auto" });
	});

	it("answers NOT_FOUND for an unknown bill, and for a bill with no open occurrence", async () => {
		const accountId = await openAccount();
		const series = await declareMortgage(accountId);
		await skipAll(series.id);

		await expect(codeOf(recordBillPayment(deps(), "nope", {}))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(codeOf(recordBillPayment(deps(), series.id, {}))).resolves.toMatchObject({
			code: "NOT_FOUND",
			message: "This bill has no open occurrence.",
		});
	});
});

/** Skips every open occurrence of a series, so none is left to pay. */
async function skipAll(id: string) {
	const open = (await occurrencesOf(id)).filter((row) => row.status === "scheduled");

	await oneByOne(open, (row) => skipOccurrence(deps(), row.id));
}
