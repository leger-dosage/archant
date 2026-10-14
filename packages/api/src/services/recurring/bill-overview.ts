import type { IsoDate } from "../../domain/dates.ts";
import type { OccurrenceState } from "../../domain/recurring/occurrences.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { RecurringRecord } from "./series.ts";
import type { SQL } from "drizzle-orm";

import { and, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { AllocationSource } from "@archant/data/recurring";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import type { MatchSignals } from "@archant/data/schema/recurring-occurrences";
import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addDays, daysBetween, monthRange, today } from "../../domain/dates.ts";
import {
	effectiveDueOn,
	occurrenceState,
	remainingOf,
	resolvedExpected,
} from "../../domain/recurring/occurrences.ts";
import { hasTransactions, paymentEntries } from "../ledger/recurring.ts";
import { KEYS_PER_LOOKUP, inSequence } from "../ledger/shared.ts";
import { getReportingCurrency } from "../settings.ts";
import { parseSignals } from "./hints.ts";
import { notFound, nullableMinor, selectRecords, toRecords } from "./series.ts";

// Sure's `payable_series_ids`: a recurring transfer into these pays a debt.
const DEBT_ACCOUNT_TYPES: AccountType[] = ["credit_card", "loan"];

// Sure's `payable_occurrences`: three months ahead at most.
const BILLS_HORIZON_DAYS = 90;

// Sure's `NEXT_UP_LIMIT`: « Prochaine » answers what comes next, never a second list.
const NEXT_SHOWN = 4;

// Sure's `compute_kpis`: what falls due within a week.
const DUE_SOON_DAYS = 7;

/** An occurrence as the bills page lists it. */
type BillRow = {
	occurrenceId: string;
	seriesId: string;
	/** The series' name, else its merchant's, else its label, as Sure's `display_name`. */
	name: string;
	/** `null`, with its name, for a series paid from any account. */
	accountId: string | null;
	accountName: string | null;
	/** Set for a recurring transfer: the account its payments go into. */
	destinationAccountId: string | null;
	merchantName: string | null;
	dueOn: IsoDate;
	/** The due date, or a later snooze. */
	effectiveDueOn: IsoDate;
	snoozedUntil: IsoDate | null;
	/** The effective due date less today in `APP_TIMEZONE`, negative once past. */
	days: number;
	state: OccurrenceState;
	/** Positive magnitudes in `currency`. */
	expected: MinorUnits;
	confirmed: MinorUnits;
	remaining: MinorUnits;
	currency: string;
	/** The matcher's payment waiting for the owner's answer, if any. */
	suggestionId: string | null;
	/** The series' band, magnitudes ascending, only when `expected` is an estimate. */
	amountRange: AmountRange | null;
};

/** Positive magnitudes, `min` below `max`. */
export type AmountRange = { min: MinorUnits; max: MinorUnits };

/**
 * Sure's `occurrence_amount_estimated?` with `has_amount_variance?` for a
 * `fixed` series, Archant having no other strategy: the occurrence has no
 * expected amount of its own and the series' amounts spread. The band, as
 * magnitudes ascending, else `null`.
 */
export function estimatedRange(
	ownExpected: MinorUnits | null,
	series: { expectedAmountMin: MinorUnits | null; expectedAmountMax: MinorUnits | null },
): AmountRange | null {
	const { expectedAmountMin: min, expectedAmountMax: max } = series;

	if (ownExpected !== null || min === null || max === null || min >= max) {
		return null;
	}

	return {
		min: toMinorUnits(Math.min(Math.abs(min), Math.abs(max))),
		max: toMinorUnits(Math.max(Math.abs(min), Math.abs(max))),
	};
}

/** A suggested payment, as the review queue and the sheet show it. */
type SuggestedPayment = {
	id: string;
	occurrenceId: string;
	seriesName: string;
	/** The transaction's label; `null` once it was deleted. */
	label: string | null;
	/** What the payment takes of the transaction, a positive magnitude. */
	amount: MinorUnits;
	/** The transaction's own magnitude, which the amount signal compares; `null` once deleted. */
	entryAmount: MinorUnits | null;
	paidOn: IsoDate | null;
	currency: string;
	expected: MinorUnits;
	effectiveDueOn: IsoDate;
	/** Ten-thousandths. */
	confidence: number | null;
	signals: MatchSignals;
};

/** Sure's `bills#index` on today in `APP_TIMEZONE`. */
export type BillsOverview = {
	currency: CurrencyCode;
	/** Overdue, past the grace days and not postponed. */
	attention: BillRow[];
	/** Due by the month's end, the month's paid ones in place. */
	month: BillRow[];
	/** One row per series, its earliest. */
	later: BillRow[];
	/** The open occurrences of paused series. */
	inactive: BillRow[];
	/** The next four from today. */
	next: BillRow[];
	/** In `currency`, the rows in another one left out. */
	totals: { remaining: MinorUnits; overdue: MinorUnits; dueSoon: MinorUnits; paid: MinorUnits };
	/** The series whose rows the totals leave out, each once (NFR2). */
	leftOut: { id: string; name: string }[];
	review: SuggestedPayment[];
	hasTransactions: boolean;
};

export type Reader = Pick<Transaction, "select">;

type Allocation = {
	id: string;
	occurrenceId: string;
	entryId: string | null;
	amount: MinorUnits;
	state: "suggested" | "confirmed";
	source: AllocationSource;
	paidOn: IsoDate | null;
	confidence: number | null;
	signals: MatchSignals;
	createdAt: number;
};

type LoadedRow = BillRow & {
	status: (typeof recurringOccurrences.$inferSelect)["status"];
	seriesStatus: (typeof recurringTransactions.$inferSelect)["status"];
};

/**
 * The occurrences `where` keeps, by due date, each with its series' names,
 * the sums of its confirmed payments and its first suggestion, and every
 * payment of them.
 */
export async function loadBills(
	db: Reader,
	where: SQL | undefined,
	day: IsoDate,
): Promise<{ rows: LoadedRow[]; allocations: Allocation[] }> {
	const found = await db
		.select({
			occurrenceId: recurringOccurrences.id,
			seriesId: recurringOccurrences.recurringTransactionId,
			dueOn: recurringOccurrences.dueOn,
			snoozedUntil: recurringOccurrences.snoozedUntil,
			status: recurringOccurrences.status,
			expectedAmount: recurringOccurrences.expectedAmount,
			currency: recurringOccurrences.currency,
			seriesAmount: recurringTransactions.amount,
			expectedAmountMin: recurringTransactions.expectedAmountMin,
			expectedAmountMax: recurringTransactions.expectedAmountMax,
			seriesStatus: recurringTransactions.status,
			seriesName: recurringTransactions.name,
			label: recurringTransactions.label,
			accountId: recurringTransactions.accountId,
			accountName: accounts.name,
			destinationAccountId: recurringTransactions.destinationAccountId,
			merchantName: merchants.name,
		})
		.from(recurringOccurrences)
		.innerJoin(
			recurringTransactions,
			eq(recurringTransactions.id, recurringOccurrences.recurringTransactionId),
		)
		.leftJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
		.leftJoin(merchants, eq(merchants.id, recurringTransactions.merchantId))
		.where(where)
		.orderBy(recurringOccurrences.dueOn, recurringOccurrences.id);
	const allocations: Allocation[] = [];

	await inSequence(
		found.map((row) => row.occurrenceId),
		KEYS_PER_LOOKUP,
		async (chunk) => {
			const rows = await db
				.select({
					id: recurringAllocations.id,
					occurrenceId: recurringAllocations.recurringOccurrenceId,
					entryId: recurringAllocations.entryId,
					amount: recurringAllocations.allocatedAmount,
					state: recurringAllocations.state,
					source: recurringAllocations.source,
					paidOn: recurringAllocations.paidOn,
					confidence: recurringAllocations.matchConfidence,
					signals: recurringAllocations.matchSignals,
					createdAt: recurringAllocations.createdAt,
				})
				.from(recurringAllocations)
				.where(inArray(recurringAllocations.recurringOccurrenceId, chunk));

			allocations.push(
				...rows.map((row) => ({
					...row,
					amount: toMinorUnits(row.amount),
					signals: parseSignals(row.signals),
				})),
			);
		},
	);

	// The queue's order: the surest first, as Sure's `suggested_allocations`.
	allocations.sort(
		(a, b) =>
			(b.confidence ?? -1) - (a.confidence ?? -1) ||
			a.createdAt - b.createdAt ||
			a.id.localeCompare(b.id),
	);

	const rows = found.map(
		({
			expectedAmount,
			seriesAmount,
			expectedAmountMin,
			expectedAmountMax,
			seriesName,
			label,
			...row
		}): LoadedRow => {
			const own = allocations.filter((one) => one.occurrenceId === row.occurrenceId);
			const confirmed = own.filter((one) => one.state === "confirmed").map((one) => one.amount);
			const ownExpected = nullableMinor(expectedAmount);
			const expected = resolvedExpected(
				{ expectedAmount: ownExpected },
				toMinorUnits(seriesAmount),
			);
			const effective = effectiveDueOn(row);

			return {
				...row,
				name: seriesName ?? row.merchantName ?? label,
				effectiveDueOn: effective,
				days: daysBetween(day, effective),
				state: occurrenceState(row, row.seriesStatus, day),
				expected,
				confirmed: toMinorUnits(confirmed.reduce((total, amount) => total + amount, 0)),
				remaining: remainingOf(expected, confirmed),
				suggestionId: own.find((one) => one.state === "suggested")?.id ?? null,
				amountRange: estimatedRange(ownExpected, {
					expectedAmountMin: nullableMinor(expectedAmountMin),
					expectedAmountMax: nullableMinor(expectedAmountMax),
				}),
			};
		},
	);

	return { rows, allocations };
}

const remainingOfRow = (row: BillRow) => row.remaining;

const toRow = ({ status: _status, seriesStatus: _seriesStatus, ...row }: LoadedRow): BillRow => row;

/** The suggestions of `rows`, in the queue's order, named by their transactions. */
async function suggestionsOf(
	db: Reader,
	rows: readonly LoadedRow[],
	allocations: readonly Allocation[],
): Promise<SuggestedPayment[]> {
	const byId = new Map(rows.map((row) => [row.occurrenceId, row]));
	const suggested = allocations.filter(
		(one) => one.state === "suggested" && byId.has(one.occurrenceId),
	);
	const named = await paymentEntries(
		db,
		suggested.flatMap((one) => (one.entryId === null ? [] : [one.entryId])),
	);

	return suggested.map((one) => {
		const row = byId.get(one.occurrenceId)!;
		const entry = one.entryId === null ? undefined : named.get(one.entryId);

		return {
			id: one.id,
			occurrenceId: one.occurrenceId,
			seriesName: row.name,
			label: entry?.label ?? null,
			amount: one.amount,
			entryAmount: entry === undefined ? null : toMinorUnits(Math.abs(entry.amount)),
			paidOn: one.paidOn,
			currency: row.currency,
			expected: row.expected,
			effectiveDueOn: row.effectiveDueOn,
			confidence: one.confidence,
			signals: one.signals,
		};
	});
}

/**
 * Sure's `bills#index` on today in `APP_TIMEZONE`: the open occurrences of
 * active and inactive outgoing series, three months ahead at most, and the
 * month's paid ones. A recurring transfer counts only into a card or a loan,
 * a debt the household pays, as Sure's `payable_series_ids`. An inactive
 * series' open ones are « Inactive »; an active series' overdue ones need
 * attention, those due by the month's end are the month's, beside its paid
 * ones, and the later ones show one per series. Skipped and missed
 * occurrences are not listed. The totals are Sure's `compute_kpis` in the
 * reporting currency, a row in another one left out and its series named
 * (NFR2). The review queue holds the suggestions of every payable
 * occurrence, open or paid this month, later ones included though « Après ce mois-ci » shows one per series, as Sure's
 * `suggested_allocations(payable_occurrences)`.
 */
export async function billsOverview(deps: ServiceDeps): Promise<BillsOverview> {
	const day = today(deps.timeZone);
	const { from: monthStart, to: monthEnd } = monthRange(day.slice(0, 7));
	const currency = getReportingCurrency();
	const { rows, allocations } = await loadBills(
		deps.db,
		and(
			inArray(recurringTransactions.status, ["active", "inactive"]),
			// AD-5: a bill's money leaves the account.
			lt(recurringTransactions.amount, 0),
			or(
				isNull(recurringTransactions.destinationAccountId),
				inArray(
					recurringTransactions.destinationAccountId,
					deps.db
						.select({ id: accounts.id })
						.from(accounts)
						.where(inArray(accounts.type, DEBT_ACCOUNT_TYPES)),
				),
			),
			lte(recurringOccurrences.dueOn, addDays(day, BILLS_HORIZON_DAYS)),
			or(gte(recurringOccurrences.dueOn, monthStart), eq(recurringOccurrences.status, "scheduled")),
		),
		day,
	);
	const open = rows.filter((row) => row.status === "scheduled");
	const active = open.filter((row) => row.seriesStatus === "active");
	const attention = active.filter((row) => row.state === "overdue");
	const upcoming = active.filter((row) => row.state !== "overdue");
	const thisMonth = upcoming.filter((row) => row.dueOn <= monthEnd);
	const seen = new Set<string>();
	// Rows come by due date: a series' first is its earliest.
	const later = upcoming.filter((row) => {
		if (row.dueOn <= monthEnd || seen.has(row.seriesId)) {
			return false;
		}

		seen.add(row.seriesId);

		return true;
	});
	const paid = rows.filter(
		(row) => row.status === "paid" && row.dueOn >= monthStart && row.dueOn <= monthEnd,
	);
	const month = rows.filter((row) => thisMonth.includes(row) || paid.includes(row));
	const owed = [...attention, ...thisMonth];
	const counted = (row: BillRow) => row.currency === currency;
	const total = (list: readonly BillRow[], pick: (row: BillRow) => MinorUnits) =>
		toMinorUnits(list.filter(counted).reduce((sum, row) => sum + pick(row), 0));
	const leftOut = new Map(
		[...owed, ...paid].filter((row) => !counted(row)).map((row) => [row.seriesId, row.name]),
	);

	return {
		currency,
		attention: attention.map(toRow),
		month: month.map(toRow),
		later: later.map(toRow),
		inactive: open.filter((row) => row.seriesStatus === "inactive").map(toRow),
		next: [...thisMonth, ...later]
			.filter((row) => row.effectiveDueOn >= day)
			.toSorted(
				(a, b) =>
					a.effectiveDueOn.localeCompare(b.effectiveDueOn) ||
					a.dueOn.localeCompare(b.dueOn) ||
					a.occurrenceId.localeCompare(b.occurrenceId),
			)
			.slice(0, NEXT_SHOWN)
			.map(toRow),
		totals: {
			remaining: total(owed, remainingOfRow),
			overdue: total(attention, remainingOfRow),
			dueSoon: total(
				owed.filter((row) => row.effectiveDueOn <= addDays(day, DUE_SOON_DAYS)),
				remainingOfRow,
			),
			paid: total(paid, (row) => row.confirmed),
		},
		leftOut: [...leftOut].map(([id, name]) => ({ id, name })),
		review: await suggestionsOf(deps.db, [...open, ...paid], allocations),
		hasTransactions: await hasTransactions(deps.db),
	};
}

/** A payment toward an occurrence, as its sheet lists it. */
type SheetPayment = {
	id: string;
	/** The transaction's label; `null` for a payment with none. */
	label: string | null;
	amount: MinorUnits;
	paidOn: IsoDate | null;
	source: AllocationSource;
};

/** An occurrence's sheet: the occurrence, its confirmed payments and the suggestion waiting. */
export type OccurrenceDetail = {
	occurrence: BillRow;
	payments: SheetPayment[];
	suggestion: SuggestedPayment | null;
};

/**
 * Sure's `RecurringOccurrencesController#show` without its free search: the
 * occurrence as the bills page shows it, its confirmed payments by date and
 * its surest suggestion.
 */
export async function occurrenceDetail(deps: ServiceDeps, id: string): Promise<OccurrenceDetail> {
	const day = today(deps.timeZone);
	const { rows, allocations } = await loadBills(deps.db, eq(recurringOccurrences.id, id), day);
	const [row] = rows;

	if (row === undefined) {
		throw notFound("occurrence");
	}

	const confirmed = allocations
		.filter((one) => one.state === "confirmed")
		.toSorted(
			(a, b) =>
				(a.paidOn ?? "").localeCompare(b.paidOn ?? "") ||
				a.createdAt - b.createdAt ||
				a.id.localeCompare(b.id),
		);
	const named = await paymentEntries(
		deps.db,
		confirmed.flatMap((one) => (one.entryId === null ? [] : [one.entryId])),
	);
	const [suggestion = null] = await suggestionsOf(deps.db, rows, allocations);

	return {
		occurrence: toRow(row),
		payments: confirmed.map((one) => ({
			id: one.id,
			label: one.entryId === null ? null : (named.get(one.entryId)?.label ?? null),
			amount: one.amount,
			paidOn: one.paidOn,
			source: one.source,
		})),
		suggestion,
	};
}

// Sure's `upcoming_window_days` of `transactions/_upcoming`.
const UPCOMING_DAYS = 10;

/** A series « À venir » lists. */
export type UpcomingRecord = RecurringRecord & {
	/** Signed like `amount`: a manual series' average when it has one, else `amount`. */
	projectedAmount: MinorUnits;
};

/**
 * Sure's `transactions/_upcoming`: the active series, money in or out,
 * expected from today to ten days on in `APP_TIMEZONE`, by date, each with
 * the one amount `_projected_transaction` shows.
 */
export async function upcomingRecurring(deps: ServiceDeps): Promise<UpcomingRecord[]> {
	const day = today(deps.timeZone);
	const window = and(
		eq(recurringTransactions.status, "active"),
		gte(recurringTransactions.nextExpectedDate, day),
		lte(recurringTransactions.nextExpectedDate, addDays(day, UPCOMING_DAYS)),
	);
	const rows = await selectRecords(deps.db)
		.where(window)
		.orderBy(recurringTransactions.nextExpectedDate, recurringTransactions.id);
	const averages = new Map(
		(
			await deps.db
				.select({ id: recurringTransactions.id, average: recurringTransactions.expectedAmountAvg })
				.from(recurringTransactions)
				.where(and(window, eq(recurringTransactions.manual, true)))
		).map(({ id, average }) => [id, average]),
	);

	return (await toRecords(deps.db, rows, day)).map((record) => {
		const average = averages.get(record.id) ?? null;

		return {
			...record,
			projectedAmount: average === null ? record.amount : toMinorUnits(average),
		};
	});
}
