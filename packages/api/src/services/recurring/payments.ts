import type { IsoDate } from "../../domain/dates.ts";
import type { MatchDecision } from "../../domain/recurring/matcher.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";

import { and, eq, sum } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { AllocationSource, AllocationState } from "@archant/data/recurring";
import {
	recurringAllocations,
	recurringMatchRejections,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { normalizeLabel } from "../../domain/normalize-label.ts";
import { knownNames } from "../../domain/recurring/matcher.ts";
import {
	isCloseWorthy,
	learnedTolerance,
	remainingOf,
	resolvedExpected,
} from "../../domain/recurring/occurrences.ts";
import { AppError } from "../../lib/errors.ts";
import { paymentTransaction } from "../ledger/recurring.ts";
import { invalidField } from "../ledger/shared.ts";
import { parseAliases } from "./hints.ts";

/** A payment toward an occurrence, as the routes answer it. */
export type PaymentRecord = {
	id: string;
	occurrenceId: string;
	entryId: string | null;
	/** A positive magnitude in the occurrence's currency. */
	amount: MinorUnits;
	state: AllocationState;
	source: AllocationSource;
	paidOn: IsoDate | null;
};

type Reader = Pick<Transaction, "select">;
type Writer = Pick<Transaction, "select" | "insert" | "update" | "delete">;

const notFound = (what: string) => new AppError("NOT_FOUND", `No ${what} has this id.`);

const exceeds = () =>
	new AppError(
		"PAYMENT_EXCEEDS_TRANSACTION",
		"The transaction's amount is already spent on other payments.",
	);

/** An occurrence with what its expected amount resolves from. */
async function occurrenceOf(tx: Reader, occurrenceId: string) {
	const row = await tx
		.select({
			id: recurringOccurrences.id,
			seriesId: recurringOccurrences.recurringTransactionId,
			currency: recurringOccurrences.currency,
			status: recurringOccurrences.status,
			closedSource: recurringOccurrences.closedSource,
			expectedAmount: recurringOccurrences.expectedAmount,
			seriesAmount: recurringTransactions.amount,
		})
		.from(recurringOccurrences)
		.innerJoin(
			recurringTransactions,
			eq(recurringTransactions.id, recurringOccurrences.recurringTransactionId),
		)
		.where(eq(recurringOccurrences.id, occurrenceId))
		.get();

	if (row === undefined) {
		return undefined;
	}

	const expectedAmount = row.expectedAmount === null ? null : toMinorUnits(row.expectedAmount);
	const seriesAmount = toMinorUnits(row.seriesAmount);

	return {
		...row,
		expectedAmount,
		seriesAmount,
		expected: resolvedExpected({ expectedAmount }, seriesAmount),
	};
}

/** The amounts of an occurrence's confirmed payments. */
async function confirmedOf(tx: Reader, occurrenceId: string): Promise<MinorUnits[]> {
	const rows = await tx
		.select({ amount: recurringAllocations.allocatedAmount })
		.from(recurringAllocations)
		.where(
			and(
				eq(recurringAllocations.recurringOccurrenceId, occurrenceId),
				eq(recurringAllocations.state, "confirmed"),
			),
		);

	return rows.map((row) => toMinorUnits(row.amount));
}

/**
 * Sure's `entry_capacity`: what is left of the transaction once every payment
 * on it, suggested ones included, has taken its share.
 */
async function capacityOf(tx: Reader, entryId: string, magnitude: MinorUnits): Promise<MinorUnits> {
	const [row] = await tx
		.select({ spent: sum(recurringAllocations.allocatedAmount) })
		.from(recurringAllocations)
		.where(eq(recurringAllocations.entryId, entryId));

	return toMinorUnits(Math.max(magnitude - Number(row?.spent ?? 0), 0));
}

/**
 * Sure's default amount: what the occurrence still needs, bounded by what the
 * transaction has left, or that whole remainder once the occurrence is
 * covered, so an overpayment records the price rise it is.
 */
async function amountFor(
	tx: Reader,
	occurrence: { id: string; expected: MinorUnits },
	entry: { id: string; amount: MinorUnits },
): Promise<MinorUnits> {
	const capacity = await capacityOf(tx, entry.id, toMinorUnits(Math.abs(entry.amount)));
	const remaining = remainingOf(occurrence.expected, await confirmedOf(tx, occurrence.id));

	return remaining > 0 ? toMinorUnits(Math.min(capacity, remaining)) : capacity;
}

/** Sure's `freeze_expected_amount!`: a confirmed payment pins what the occurrence expected. */
async function freezeExpected(
	tx: Writer,
	occurrence: { id: string; expectedAmount: MinorUnits | null; expected: MinorUnits },
	now: number,
): Promise<void> {
	if (occurrence.expectedAmount === null) {
		await tx
			.update(recurringOccurrences)
			.set({ expectedAmount: occurrence.expected, updatedAt: now })
			.where(eq(recurringOccurrences.id, occurrence.id));
	}
}

/**
 * Sure's `refresh_close_state!`: an open occurrence its confirmed payments
 * settle is paid, closed by `auto`, its amount frozen; one an `auto` close
 * paid that they no longer settle reopens. A close by the owner never reopens.
 */
export async function refreshCloseState(
	tx: Writer,
	occurrenceId: string,
	now: number,
): Promise<void> {
	const occurrence = (await occurrenceOf(tx, occurrenceId))!;
	const worthy = isCloseWorthy(occurrence.expected, await confirmedOf(tx, occurrenceId));

	if (occurrence.status === "scheduled" && worthy) {
		await tx
			.update(recurringOccurrences)
			.set({
				status: "paid",
				expectedAmount: occurrence.expected,
				closedAt: now,
				closedSource: "auto",
				updatedAt: now,
			})
			.where(eq(recurringOccurrences.id, occurrenceId));
	} else if (occurrence.status === "paid" && occurrence.closedSource === "auto" && !worthy) {
		await tx
			.update(recurringOccurrences)
			.set({ status: "scheduled", closedAt: null, closedSource: null, updatedAt: now })
			.where(eq(recurringOccurrences.id, occurrenceId));
	}
}

/**
 * Sure's `allocate_matched!`: the matcher's payment, confirmed or suggested,
 * dated on its transaction's day. Nothing is written when the transaction has
 * nothing left or already pays this occurrence, but for a suggestion now
 * confirmed: a pending line booked keeps its entry id (AD-17), so its
 * suggestion becomes the payment. Only a confirmed payment freezes the
 * amount and moves the close state.
 */
export async function allocateMatched(
	tx: Writer,
	decision: MatchDecision,
	entry: { id: string; amount: MinorUnits; date: IsoDate },
	now: number,
): Promise<void> {
	const occurrence = (await occurrenceOf(tx, decision.occurrenceId))!;
	const amount = await amountFor(tx, occurrence, entry);
	const held = await tx
		.select({ id: recurringAllocations.id, state: recurringAllocations.state })
		.from(recurringAllocations)
		.where(
			and(
				eq(recurringAllocations.recurringOccurrenceId, occurrence.id),
				eq(recurringAllocations.entryId, entry.id),
			),
		)
		.get();
	const confirmed = decision.state === "confirmed";

	if (held !== undefined) {
		if (confirmed && held.state === "suggested") {
			await freezeExpected(tx, occurrence, now);
			await tx
				.update(recurringAllocations)
				.set({
					state: "confirmed",
					matchConfidence: decision.score,
					matchSignals: decision.signals,
					paidOn: entry.date,
					updatedAt: now,
				})
				.where(eq(recurringAllocations.id, held.id));
			await refreshCloseState(tx, occurrence.id, now);
		}

		return;
	}

	if (amount <= 0) {
		return;
	}

	if (confirmed) {
		await freezeExpected(tx, occurrence, now);
	}

	await tx.insert(recurringAllocations).values({
		id: crypto.randomUUID(),
		recurringOccurrenceId: occurrence.id,
		entryId: entry.id,
		allocatedAmount: amount,
		state: decision.state,
		source: "auto_matched",
		matchConfidence: decision.score,
		matchSignals: decision.signals,
		paidOn: entry.date,
		createdAt: now,
		updatedAt: now,
	});

	if (confirmed) {
		await refreshCloseState(tx, occurrence.id, now);
	}
}

const paymentColumns = {
	id: recurringAllocations.id,
	occurrenceId: recurringAllocations.recurringOccurrenceId,
	entryId: recurringAllocations.entryId,
	amount: recurringAllocations.allocatedAmount,
	state: recurringAllocations.state,
	source: recurringAllocations.source,
	paidOn: recurringAllocations.paidOn,
};

async function paymentOf(tx: Reader, id: string): Promise<PaymentRecord> {
	const row = await tx
		.select(paymentColumns)
		.from(recurringAllocations)
		.where(eq(recurringAllocations.id, id))
		.get();

	if (row === undefined) {
		throw notFound("payment");
	}

	return { ...row, amount: toMinorUnits(row.amount) };
}

/**
 * Sure's `confirm_suggestion!`: the owner accepts a payment, which then
 * counts, freezes its occurrence's amount and may pay it.
 */
export async function confirmPayment(deps: ServiceDeps, id: string): Promise<PaymentRecord> {
	return deps.db.transaction(
		async (tx) => {
			const payment = await paymentOf(tx, id);
			const occurrence = (await occurrenceOf(tx, payment.occurrenceId))!;
			const now = Date.now();

			await freezeExpected(tx, occurrence, now);
			await tx
				.update(recurringAllocations)
				.set({ state: "confirmed", source: "user_confirmed", updatedAt: now })
				.where(eq(recurringAllocations.id, id));
			await refreshCloseState(tx, occurrence.id, now);

			return paymentOf(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `reject_suggestion!`: the owner refuses a payment, and its
 * transaction is never proposed for that series again.
 */
export async function rejectPayment(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			const payment = await paymentOf(tx, id);
			const occurrence = (await occurrenceOf(tx, payment.occurrenceId))!;
			const now = Date.now();

			if (payment.entryId !== null) {
				await tx
					.insert(recurringMatchRejections)
					.values({
						id: crypto.randomUUID(),
						recurringTransactionId: occurrence.seriesId,
						entryId: payment.entryId,
						createdAt: now,
						updatedAt: now,
					})
					.onConflictDoNothing();
			}

			await tx.delete(recurringAllocations).where(eq(recurringAllocations.id, id));
			await refreshCloseState(tx, occurrence.id, now);

			return { id };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `learn_from_manual_attach!`: a series without a merchant learns the
 * label it did not know, and a payment that alone settles its occurrence
 * past 7.5 % widens the learned tolerance, never past 25 %.
 */
async function learnFromAttach(
	tx: Writer,
	occurrence: { id: string; seriesId: string; expected: MinorUnits },
	entry: { label: string; amount: MinorUnits },
	now: number,
): Promise<void> {
	const series = (await tx
		.select({
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			name: recurringTransactions.name,
			nameAliases: recurringTransactions.nameAliases,
			learnedTolerance: recurringTransactions.learnedTolerance,
		})
		.from(recurringTransactions)
		.where(eq(recurringTransactions.id, occurrence.seriesId))
		.get())!;
	const aliases = parseAliases(series.nameAliases);
	const known = knownNames({ ...series, nameAliases: aliases });
	const nextAliases =
		series.merchantId === null && !known.has(normalizeLabel(entry.label))
			? [...aliases, entry.label]
			: aliases;
	const confirmed = await confirmedOf(tx, occurrence.id);
	const learned = learnedTolerance(
		toMinorUnits(Math.abs(entry.amount)),
		occurrence.expected,
		series.learnedTolerance,
		confirmed.length === 1 && isCloseWorthy(occurrence.expected, confirmed),
	);

	if (nextAliases !== aliases || learned !== null) {
		await tx
			.update(recurringTransactions)
			.set({
				nameAliases: nextAliases,
				learnedTolerance: learned ?? series.learnedTolerance,
				updatedAt: now,
			})
			.where(eq(recurringTransactions.id, occurrence.seriesId));
	}
}

/**
 * Sure's `allocate!` from a transaction the owner picked: a confirmed payment
 * of what the occurrence still needs, bounded by what the transaction has
 * left, which then teaches the series, as Sure's. A split's parent is
 * refused, its lines carrying the money (AD-20), and so is a transaction in
 * another currency, there being no rate (AD-6); one whose amount is spent
 * answers `PAYMENT_EXCEEDS_TRANSACTION`.
 */
export async function attachEntry(
	deps: ServiceDeps,
	occurrenceId: string,
	entryId: string,
): Promise<PaymentRecord> {
	return deps.db.transaction(
		async (tx) => {
			const occurrence = await occurrenceOf(tx, occurrenceId);

			if (occurrence === undefined) {
				throw notFound("occurrence");
			}

			const entry = await paymentTransaction(tx, entryId);

			if (entry === null) {
				throw notFound("transaction");
			}

			// Its lines carry the money (AD-20): attach one of them instead.
			if (entry.splitParent) {
				throw invalidField("entryId", "split_parent");
			}

			if (entry.currency !== occurrence.currency) {
				throw invalidField("entryId", "currency_mismatch");
			}

			const held = await tx
				.select({ id: recurringAllocations.id })
				.from(recurringAllocations)
				.where(
					and(
						eq(recurringAllocations.recurringOccurrenceId, occurrenceId),
						eq(recurringAllocations.entryId, entryId),
					),
				)
				.get();

			if (held !== undefined) {
				throw invalidField("entryId", "already_attached");
			}

			const amount = await amountFor(tx, occurrence, entry);

			if (amount <= 0) {
				throw exceeds();
			}

			const now = Date.now();
			const id = crypto.randomUUID();

			await freezeExpected(tx, occurrence, now);
			await tx.insert(recurringAllocations).values({
				id,
				recurringOccurrenceId: occurrenceId,
				entryId,
				allocatedAmount: amount,
				state: "confirmed",
				source: "user_confirmed",
				paidOn: entry.date,
				createdAt: now,
				updatedAt: now,
			});
			await learnFromAttach(tx, occurrence, entry, now);
			await refreshCloseState(tx, occurrenceId, now);

			return paymentOf(tx, id);
		},
		{ behavior: "immediate" },
	);
}
