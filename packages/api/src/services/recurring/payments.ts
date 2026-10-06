import type { IsoDate } from "../../domain/dates.ts";
import type { MatchDecision } from "../../domain/recurring/matcher.ts";
import type { AddPaymentInput, OccurrencePatch } from "../../schemas/recurring.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";

import { and, eq, inArray, sum } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";
import type {
	AllocationSource,
	AllocationState,
	ClosedSource,
	OccurrenceStatus,
} from "@archant/data/recurring";
import type { MatchSignals } from "@archant/data/schema/recurring-occurrences";
import {
	recurringAllocations,
	recurringMatchRejections,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { today } from "../../domain/dates.ts";
import { normalizeLabel } from "../../domain/normalize-label.ts";
import { explain, knownNames, windowOf } from "../../domain/recurring/matcher.ts";
import {
	isCloseWorthy,
	learnedTolerance,
	remainingOf,
	resolvedExpected,
} from "../../domain/recurring/occurrences.ts";
import { AppError } from "../../lib/errors.ts";
import { matchableTransactions, paymentTransaction } from "../ledger/recurring.ts";
import { KEYS_PER_LOOKUP, inSequence, invalidField } from "../ledger/shared.ts";
import { parseAliases } from "./hints.ts";
import { seriesWithSchedules } from "./rules.ts";

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
 * of `amount`, else of what the occurrence still needs, bounded by what the
 * transaction has left, dated `paidOn` or on the transaction's day, which
 * then teaches the series, as Sure's. A split's parent is refused, its lines
 * carrying the money (AD-20), and so is a transaction in another currency,
 * there being no rate (AD-6); one whose amount is spent, or an amount past
 * what it has left, answers `PAYMENT_EXCEEDS_TRANSACTION`.
 */
async function attachEntry(
	deps: ServiceDeps,
	occurrenceId: string,
	entryId: string,
	input: { amount?: string | undefined; paidOn?: IsoDate | undefined },
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

			const chosen =
				input.amount === undefined ? null : amountOf(input.amount, occurrence.currency);
			const amount =
				chosen === null
					? await amountFor(tx, occurrence, entry)
					: // Sure's `guard_entry_capacity!`: never more than the transaction has left.
						chosen <= (await capacityOf(tx, entry.id, toMinorUnits(Math.abs(entry.amount))))
						? chosen
						: toMinorUnits(0);

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
				paidOn: input.paidOn ?? entry.date,
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

/**
 * A positive amount typed as decimal text, read in the occurrence's
 * currency; a `VALIDATION_ERROR` on `path`, the body's field, otherwise.
 */
function amountOf(text: string | undefined, currency: string, path = "amount"): MinorUnits {
	if (text === undefined) {
		throw invalidField(path, "invalid_type");
	}

	const amount = parseAmount(text, currency);

	if (amount === null) {
		throw invalidField(path, "invalid_amount");
	}

	if (amount <= 0) {
		throw invalidField(path, "not_positive");
	}

	return amount;
}

/**
 * Sure's `RecurringAllocationsController#create`: with a transaction, its
 * payment as `attachEntry` makes it; without one, an amount and a date the
 * owner gives, a confirmed `user_created` payment, then the close state
 * follows.
 */
export async function addPayment(
	deps: ServiceDeps,
	occurrenceId: string,
	input: AddPaymentInput,
): Promise<PaymentRecord> {
	if (input.entryId !== undefined) {
		return attachEntry(deps, occurrenceId, input.entryId, input);
	}

	return deps.db.transaction(
		async (tx) => {
			const occurrence = await occurrenceOf(tx, occurrenceId);

			if (occurrence === undefined) {
				throw notFound("occurrence");
			}

			const amount = amountOf(input.amount, occurrence.currency);

			if (input.paidOn === undefined) {
				throw invalidField("paidOn", "invalid_type");
			}

			const now = Date.now();
			const id = crypto.randomUUID();

			await freezeExpected(tx, occurrence, now);
			await tx.insert(recurringAllocations).values({
				id,
				recurringOccurrenceId: occurrenceId,
				allocatedAmount: amount,
				state: "confirmed",
				source: "user_created",
				paidOn: input.paidOn,
				createdAt: now,
				updatedAt: now,
			});
			await refreshCloseState(tx, occurrenceId, now);

			return paymentOf(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/** An occurrence after the owner acted on it, as the routes answer it. */
export type OccurrenceRecord = {
	id: string;
	dueOn: IsoDate;
	snoozedUntil: IsoDate | null;
	status: OccurrenceStatus;
	closedSource: ClosedSource | null;
	/** Frozen or set by the owner; `null` reads the series' amount. */
	expectedAmount: MinorUnits | null;
};

async function occurrenceRecord(tx: Reader, id: string): Promise<OccurrenceRecord> {
	const row = (await tx
		.select({
			id: recurringOccurrences.id,
			dueOn: recurringOccurrences.dueOn,
			snoozedUntil: recurringOccurrences.snoozedUntil,
			status: recurringOccurrences.status,
			closedSource: recurringOccurrences.closedSource,
			expectedAmount: recurringOccurrences.expectedAmount,
		})
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.id, id))
		.get())!;

	return {
		...row,
		expectedAmount: row.expectedAmount === null ? null : toMinorUnits(row.expectedAmount),
	};
}

/** The occurrence of `id`, `NOT_FOUND` without one. */
async function existingOccurrence(tx: Reader, id: string) {
	const occurrence = await occurrenceOf(tx, id);

	if (occurrence === undefined) {
		throw notFound("occurrence");
	}

	return occurrence;
}

/** An open occurrence only: any other move of its status is refused (AD-24). */
function mustBeOpen(occurrence: { status: OccurrenceStatus }): void {
	if (occurrence.status !== "scheduled") {
		throw invalidField("status");
	}
}

/**
 * Sure's `mark_paid!`: the amount frozen, what remains settled by a confirmed
 * `user_created` payment with no transaction, dated `paidOn` or today, and
 * the occurrence closed paid by the owner, so a removed payment never
 * reopens it.
 */
export async function markPaid(
	deps: ServiceDeps,
	id: string,
	paidOn?: IsoDate,
): Promise<OccurrenceRecord> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const occurrence = await existingOccurrence(tx, id);
			mustBeOpen(occurrence);
			const now = Date.now();
			const remaining = remainingOf(occurrence.expected, await confirmedOf(tx, id));

			await freezeExpected(tx, occurrence, now);

			if (remaining > 0) {
				await tx.insert(recurringAllocations).values({
					id: crypto.randomUUID(),
					recurringOccurrenceId: id,
					allocatedAmount: remaining,
					state: "confirmed",
					source: "user_created",
					paidOn: paidOn ?? day,
					createdAt: now,
					updatedAt: now,
				});
			}

			await tx
				.update(recurringOccurrences)
				.set({ status: "paid", closedAt: now, closedSource: "user", updatedAt: now })
				.where(eq(recurringOccurrences.id, id));

			return occurrenceRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/** « Ignorer cette échéance »: the amount frozen, the occurrence closed skipped by the owner. */
export async function skipOccurrence(deps: ServiceDeps, id: string): Promise<OccurrenceRecord> {
	return deps.db.transaction(
		async (tx) => {
			const occurrence = await existingOccurrence(tx, id);
			mustBeOpen(occurrence);
			const now = Date.now();

			await freezeExpected(tx, occurrence, now);
			await tx
				.update(recurringOccurrences)
				.set({ status: "skipped", closedAt: now, closedSource: "user", updatedAt: now })
				.where(eq(recurringOccurrences.id, id));

			return occurrenceRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `reopen!`: a closed occurrence open again, its amount and payments
 * kept. Its close state is not refreshed, so payments that settle it leave
 * it open until the next payment moves it, as Sure's.
 */
export async function reopenOccurrence(deps: ServiceDeps, id: string): Promise<OccurrenceRecord> {
	return deps.db.transaction(
		async (tx) => {
			const occurrence = await existingOccurrence(tx, id);

			if (occurrence.status === "scheduled") {
				throw invalidField("status");
			}

			await tx
				.update(recurringOccurrences)
				.set({ status: "scheduled", closedAt: null, closedSource: null, updatedAt: Date.now() })
				.where(eq(recurringOccurrences.id, id));

			return occurrenceRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `snooze!` and `override_amount!`: « Reporter » to a date, or
 * « Modifier le montant » of this occurrence alone, `null` clearing either.
 * The close state is not refreshed, as Sure's.
 */
export async function editOccurrence(
	deps: ServiceDeps,
	id: string,
	patch: OccurrencePatch,
): Promise<OccurrenceRecord> {
	return deps.db.transaction(
		async (tx) => {
			const occurrence = await existingOccurrence(tx, id);
			const now = Date.now();
			const change =
				"snoozedUntil" in patch
					? { snoozedUntil: patch.snoozedUntil }
					: {
							expectedAmount:
								patch.expectedAmount === null
									? null
									: amountOf(patch.expectedAmount, occurrence.currency, "expectedAmount"),
						};

			await tx
				.update(recurringOccurrences)
				.set({ ...change, updatedAt: now })
				.where(eq(recurringOccurrences.id, id));

			return occurrenceRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `unallocate!`: the payment goes, and an occurrence paid by `auto`
 * that it no longer settles reopens. No rejection is recorded: the owner
 * removed a payment, not refused a match.
 */
export async function removePayment(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			const payment = await paymentOf(tx, id);

			await tx.delete(recurringAllocations).where(eq(recurringAllocations.id, id));
			await refreshCloseState(tx, payment.occurrenceId, Date.now());

			return { id };
		},
		{ behavior: "immediate" },
	);
}

/** A transaction « Ajouter un paiement » offers, scored as the matcher would. */
export type PaymentCandidate = {
	entryId: string;
	label: string;
	date: IsoDate;
	/** Signed as the transaction (AD-5). */
	amount: MinorUnits;
	currency: string;
	/** Ten-thousandths. */
	score: number;
	signals: MatchSignals;
};

// Sure's `RANKED_SHOWN`.
const CANDIDATES_SHOWN = 6;

/**
 * Sure's `ranked_candidates`: the transactions of the occurrence's window
 * that `explain` scores, without those the owner rejected for the series,
 * those already on this occurrence and those with nothing left to spend,
 * the highest score first, six at most.
 */
export async function paymentCandidates(
	deps: ServiceDeps,
	occurrenceId: string,
): Promise<PaymentCandidate[]> {
	const day = today(deps.timeZone);
	const row = await deps.db
		.select({
			id: recurringOccurrences.id,
			seriesId: recurringOccurrences.recurringTransactionId,
			dueOn: recurringOccurrences.dueOn,
			snoozedUntil: recurringOccurrences.snoozedUntil,
			expectedAmount: recurringOccurrences.expectedAmount,
		})
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.id, occurrenceId))
		.get();

	if (row === undefined) {
		throw notFound("occurrence");
	}

	const occurrence = {
		...row,
		expectedAmount: row.expectedAmount === null ? null : toMinorUnits(row.expectedAmount),
	};
	const series = (await seriesWithSchedules(deps.db, [occurrence.seriesId])).get(
		occurrence.seriesId,
	)!;
	const found = await matchableTransactions(deps.db, windowOf(series, occurrence, day));
	const rejected = await deps.db
		.select({ entryId: recurringMatchRejections.entryId })
		.from(recurringMatchRejections)
		.where(eq(recurringMatchRejections.recurringTransactionId, series.id));
	const held = await deps.db
		.select({ entryId: recurringAllocations.entryId })
		.from(recurringAllocations)
		.where(eq(recurringAllocations.recurringOccurrenceId, occurrenceId));
	const left = new Set([...rejected, ...held].map((one) => one.entryId));
	const spent = new Map<string, MinorUnits>();

	await inSequence(
		found.map((entry) => entry.id),
		KEYS_PER_LOOKUP,
		async (chunk) => {
			const rows = await deps.db
				.select({
					entryId: recurringAllocations.entryId,
					spent: sum(recurringAllocations.allocatedAmount),
				})
				.from(recurringAllocations)
				.where(inArray(recurringAllocations.entryId, chunk))
				.groupBy(recurringAllocations.entryId);

			for (const one of rows) {
				spent.set(one.entryId!, toMinorUnits(Number(one.spent ?? 0)));
			}
		},
	);

	return (
		found
			.flatMap((entry): PaymentCandidate[] => {
				const scored = explain(series, occurrence, entry, day);

				if (
					scored === null ||
					left.has(entry.id) ||
					Math.abs(entry.amount) - (spent.get(entry.id) ?? 0) <= 0
				) {
					return [];
				}

				return [
					{
						entryId: entry.id,
						label: entry.label,
						date: entry.date,
						amount: entry.amount,
						currency: entry.currency,
						...scored,
					},
				];
			})
			// Equal scores need an order of their own, or the cut at six moves between reads.
			.toSorted(
				(a, b) =>
					b.score - a.score || b.date.localeCompare(a.date) || a.entryId.localeCompare(b.entryId),
			)
			.slice(0, CANDIDATES_SHOWN)
	);
}
