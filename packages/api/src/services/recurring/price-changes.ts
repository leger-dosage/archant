import type { IsoDate } from "../../domain/dates.ts";
import type { PaidOccurrence } from "../../domain/recurring/occurrences.ts";
import type { Transaction } from "../ledger/shared.ts";

import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import {
	recurringAllocations,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { priceChangeOf } from "../../domain/recurring/occurrences.ts";
import { oneByOne } from "../ledger/shared.ts";
import { taken } from "./bills.ts";
import { pinAmountsAlreadyDue } from "./occurrences.ts";

type Writer = Pick<Transaction, "select" | "insert" | "update" | "delete">;

/** The two latest paid occurrences of a series, latest first, with their confirmed payments. */
async function latestPaid(tx: Writer, seriesId: string): Promise<PaidOccurrence[]> {
	const paid = await tx
		.select({ id: recurringOccurrences.id, dueOn: recurringOccurrences.dueOn })
		.from(recurringOccurrences)
		.where(
			and(
				eq(recurringOccurrences.recurringTransactionId, seriesId),
				eq(recurringOccurrences.status, "paid"),
			),
		)
		.orderBy(desc(recurringOccurrences.dueOn))
		.limit(2);
	const payments =
		paid.length === 0
			? []
			: await tx
					.select({
						occurrenceId: recurringAllocations.recurringOccurrenceId,
						amount: recurringAllocations.allocatedAmount,
						entryId: recurringAllocations.entryId,
					})
					.from(recurringAllocations)
					.where(
						and(
							inArray(
								recurringAllocations.recurringOccurrenceId,
								paid.map((row) => row.id),
							),
							eq(recurringAllocations.state, "confirmed"),
						),
					)
					.orderBy(recurringAllocations.createdAt, recurringAllocations.id);

	return paid.map((occurrence) => {
		const own = payments.filter((payment) => payment.occurrenceId === occurrence.id);

		return {
			dueOn: occurrence.dueOn,
			confirmed: own.map((payment) => toMinorUnits(payment.amount)),
			entryId: own[0]?.entryId ?? null,
		};
	});
}

/**
 * Sure's `PriceChangeDetector`, over the active series that take money out:
 * two latest paid occurrences each settled by one payment, agreeing on a new
 * price, record a change on the latest due date. A detected series then takes
 * the new amount, signed (AD-5), and its open occurrences already due keep the
 * old one; a manual series keeps the amount its owner stated. A detected
 * series whose new amount another series of its key already holds keeps its
 * own, the unique index on the amount being Archant's, not Sure's.
 */
export async function detectPriceChanges(tx: Writer, day: IsoDate): Promise<void> {
	const series = await tx
		.select({
			id: recurringTransactions.id,
			accountId: recurringTransactions.accountId,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			amount: recurringTransactions.amount,
			currency: recurringTransactions.currency,
			dedupScope: recurringTransactions.dedupScope,
			manual: recurringTransactions.manual,
		})
		.from(recurringTransactions)
		.where(and(eq(recurringTransactions.status, "active"), lt(recurringTransactions.amount, 0)))
		.orderBy(recurringTransactions.createdAt, recurringTransactions.id);

	await oneByOne(series, async (one) => {
		const recorded = await tx
			.select({
				effectiveOn: recurringPriceChanges.effectiveOn,
				newAmount: recurringPriceChanges.newAmount,
			})
			.from(recurringPriceChanges)
			.where(eq(recurringPriceChanges.recurringTransactionId, one.id));
		const change = priceChangeOf(
			toMinorUnits(one.amount),
			await latestPaid(tx, one.id),
			recorded.map((row) => ({ ...row, newAmount: toMinorUnits(row.newAmount) })),
		);

		if (change === null) {
			return;
		}

		const now = Date.now();

		await tx.insert(recurringPriceChanges).values({
			id: crypto.randomUUID(),
			recurringTransactionId: one.id,
			effectiveOn: change.effectiveOn,
			previousAmount: change.previousAmount,
			newAmount: change.newAmount,
			currency: one.currency,
			entryId: change.entryId,
			createdAt: now,
			updatedAt: now,
		});

		if (one.manual) {
			return;
		}

		const amount = toMinorUnits(0 - change.newAmount);
		if (await taken(tx, { ...one, amount }, one.id)) {
			return;
		}

		await tx
			.update(recurringTransactions)
			.set({ amount, updatedAt: now })
			.where(eq(recurringTransactions.id, one.id));
		await pinAmountsAlreadyDue(tx, one.id, change.previousAmount, day);
	});
}
