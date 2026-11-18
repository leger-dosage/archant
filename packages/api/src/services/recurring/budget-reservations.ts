import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";

import { and, between, eq, isNull, lt, sum } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { remainingOf, resolvedExpected } from "../../domain/recurring/occurrences.ts";

type Reservation = { amount: MinorUnits; unconvertibleCount: number };

export type BillReservations = Record<string, Reservation | undefined>;

/** Sure's `open_bills_due` and `bills_reservation`, batched for all envelopes. */
export async function budgetBillReservations(
	db: ServiceDeps["db"],
	period: { from: IsoDate; to: IsoDate; currency: string },
): Promise<BillReservations> {
	const occurrences = await db
		.select({
			categoryId: categories.id,
			currency: recurringOccurrences.currency,
			expected: recurringOccurrences.expectedAmount,
			seriesAmount: recurringTransactions.amount,
			confirmed: sum(recurringAllocations.allocatedAmount),
		})
		.from(recurringOccurrences)
		.innerJoin(
			recurringTransactions,
			eq(recurringTransactions.id, recurringOccurrences.recurringTransactionId),
		)
		.innerJoin(categories, eq(categories.id, recurringTransactions.categoryId))
		.leftJoin(
			recurringAllocations,
			and(
				eq(recurringAllocations.recurringOccurrenceId, recurringOccurrences.id),
				eq(recurringAllocations.state, "confirmed"),
			),
		)
		.where(
			and(
				eq(recurringOccurrences.status, "scheduled"),
				between(recurringOccurrences.dueOn, period.from, period.to),
				eq(recurringTransactions.status, "active"),
				isNull(recurringTransactions.destinationAccountId),
				lt(recurringTransactions.amount, 0),
			),
		)
		.groupBy(recurringOccurrences.id);

	const reservations = new Map<string, Reservation>();

	for (const occurrence of occurrences) {
		const expected = resolvedExpected(
			{ expectedAmount: occurrence.expected === null ? null : toMinorUnits(occurrence.expected) },
			toMinorUnits(occurrence.seriesAmount),
		);
		const confirmed = toMinorUnits(Number(occurrence.confirmed ?? 0));
		const remaining = remainingOf(expected, [confirmed]);

		if (remaining === 0) {
			continue;
		}

		const reservation = reservations.get(occurrence.categoryId) ?? {
			amount: toMinorUnits(0),
			unconvertibleCount: 0,
		};

		if (occurrence.currency === period.currency) {
			reservation.amount = toMinorUnits(reservation.amount + remaining);
		} else {
			reservation.unconvertibleCount += 1;
		}

		reservations.set(occurrence.categoryId, reservation);
	}

	return Object.fromEntries(reservations);
}
