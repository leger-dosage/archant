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
import { splitTransaction } from "../ledger/splits.ts";
import { declareBill } from "./bills.ts";
import { attachEntry, confirmPayment, rejectPayment } from "./payments.ts";
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

describe("attachEntry", () => {
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

		await expect(attachEntry(deps(), occurrence.id, paid)).resolves.toMatchObject({
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

		await attachEntry(deps(), (await august(series.id)).id, paid);

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

		await expect(attachEntry(deps(), august5!.id, part)).resolves.toMatchObject({ amount: 10_000 });
		await expect(august(series.id)).resolves.toMatchObject({ status: "scheduled" });
		await expect(codeOf(attachEntry(deps(), september!.id, part))).resolves.toEqual({
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
		await attachEntry(deps(), occurrence.id, first);

		await expect(attachEntry(deps(), occurrence.id, second)).resolves.toMatchObject({
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
		await attachEntry(deps(), occurrence.id, paid);

		await expect(codeOf(attachEntry(deps(), "nope", paid))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(codeOf(attachEntry(deps(), occurrence.id, "nope"))).resolves.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(codeOf(attachEntry(deps(), occurrence.id, foreign))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "currency_mismatch" }],
		});
		await expect(codeOf(attachEntry(deps(), occurrence.id, paid))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "already_attached" }],
		});
	});
});

describe("attachEntry on a split", () => {
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

		await expect(codeOf(attachEntry(deps(), occurrence.id, parent))).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "split_parent" }],
		});
		await expect(attachEntry(deps(), occurrence.id, split.childIds[0]!)).resolves.toMatchObject({
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
