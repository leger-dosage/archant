import type { IsoDate } from "../../domain/dates.ts";
import type { OccurrenceState } from "../../domain/recurring/occurrences.ts";
import type { BillLifecycle, BillPaymentState, BillStatus } from "../../schemas/bills.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { BillOccurrence, BillRecord, PriceChange } from "./bills.ts";
import type { SQL } from "drizzle-orm";

import { and, eq, gte } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import type {
	AllocationSource,
	AllocationState,
	BillType,
	OccurrenceStatus,
} from "@archant/data/recurring";
import {
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addDays, addMonths, today } from "../../domain/dates.ts";
import { nextDueDateOf, nextDueDates } from "../../domain/recurring/bills.ts";
import { monthlyRollup } from "../../domain/recurring/schedule.ts";
import { billStatusSchema } from "../../schemas/bills.ts";
import { paymentEntries } from "../ledger/recurring.ts";
import { getReportingCurrency } from "../settings.ts";
import { displayName, loadBills, priceChangesWhere, withAmounts } from "./bills.ts";
import { notFound, selectRecords, toRecords } from "./series.ts";

/** A series as the assistant's bill tools read it. */
export type BillView = BillRecord & {
	/** The typed name, else the merchant's, else the label. */
	displayName: string;
	/** The current open occurrence's effective due date, else the series' next expected date. */
	nextDueDate: IsoDate;
};

type Reader = Pick<Transaction, "select">;

// Sure's `STATUS_VOCABULARY`: nothing stores `paused`, the interface's
// « En pause » is `inactive`.
export const STORED_STATUS = {
	active: "active",
	suggested: "suggested",
	paused: "inactive",
	ended: "ended",
} as const satisfies Record<BillStatus, RecurringStatus>;

/** `BillStatus`'s word for a stored status. */
export const lifecycleOf = (status: RecurringStatus): BillStatus =>
	billStatusSchema.options.find((word) => STORED_STATUS[word] === status)!;

/**
 * The series `where` keeps, with the amounts of their current occurrence
 * as « Toutes les factures » reads them, by next due date.
 */
export async function loadBillViews(db: Reader, day: IsoDate, where?: SQL): Promise<BillView[]> {
	const records = await withAmounts(
		db,
		await toRecords(db, await selectRecords(db).where(where), day),
	);

	return records
		.map((record) => ({
			...record,
			displayName: displayName(record),
			nextDueDate: nextDueDateOf(record),
		}))
		.toSorted((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.id.localeCompare(b.id));
}

/** One series as the bill tools read it; `NOT_FOUND` when no series has `id`. */
async function billView(deps: ServiceDeps, id: string): Promise<BillView> {
	const [view] = await loadBillViews(
		deps.db,
		today(deps.timeZone),
		eq(recurringTransactions.id, id),
	);

	if (view === undefined) {
		throw notFound("recurring transaction");
	}

	return view;
}

/** Sure's `payment_state_matches?`: a series with no occurrence matches none. */
function inPaymentState(occurrence: BillOccurrence | null, state: BillPaymentState): boolean {
	if (occurrence === null) {
		return false;
	}

	switch (state) {
		case "partial":
			return (
				occurrence.status === "scheduled" &&
				occurrence.confirmed > 0 &&
				occurrence.confirmed < occurrence.expected
			);
		case "paid":
			return occurrence.status === "paid";
		default:
			return occurrence.state === state;
	}
}

export type FindBillsQuery = {
	status: BillLifecycle;
	paymentState?: BillPaymentState | undefined;
	billType?: BillType | undefined;
	search?: string | undefined;
	dueWithinDays?: number | undefined;
};

export type FoundBills = {
	/** Every match, by next due date. */
	bills: BillView[];
	totals: {
		currency: CurrencyCode;
		activeCount: number;
		overdueCount: number;
		/** The active bills' monthly equivalents but the incomes', in `currency`. */
		activeMonthly: MinorUnits;
		/** The accounts of the active bills in another currency, which the sum leaves out (NFR2). */
		leftOut: { id: string }[];
	};
};

/**
 * Sure's `GetBills`: the series of a lifecycle, `active` by default, narrowed
 * by type, by a search of the name, the merchant's name and the label, case
 * aside, by a next due date within `dueWithinDays`, overdue ones included,
 * and by the current occurrence's payment state. The totals cover every
 * match: the active ones, the overdue ones, and the active bills' monthly
 * equivalent without the incomes, in the reporting currency, a bill in
 * another one left out with its account (NFR2), where Sure sums per currency.
 */
export async function findBills(deps: ServiceDeps, query: FindBillsQuery): Promise<FoundBills> {
	const day = today(deps.timeZone);
	const needle = query.search?.toLocaleLowerCase("fr");
	const horizon = query.dueWithinDays === undefined ? undefined : addDays(day, query.dueWithinDays);
	const views = await loadBillViews(
		deps.db,
		day,
		and(
			query.status === "all"
				? undefined
				: eq(recurringTransactions.status, STORED_STATUS[query.status]),
			query.billType === undefined ? undefined : eq(recurringTransactions.billType, query.billType),
		),
	);
	const bills = views.filter(
		(bill) =>
			(needle === undefined ||
				[bill.name, bill.merchantName, bill.label].some(
					(text) => text?.toLocaleLowerCase("fr").includes(needle) ?? false,
				)) &&
			(horizon === undefined || bill.nextDueDate <= horizon) &&
			(query.paymentState === undefined ||
				inPaymentState(bill.currentOccurrence, query.paymentState)),
	);
	const currency = getReportingCurrency();
	const spending = bills.filter((bill) => bill.status === "active" && bill.billType !== "income");

	return {
		bills,
		totals: {
			currency,
			activeCount: bills.filter((bill) => bill.status === "active").length,
			overdueCount: bills.filter((bill) => bill.currentOccurrence?.state === "overdue").length,
			activeMonthly: monthlyRollup(spending.filter((bill) => bill.currency === currency)).monthly,
			leftOut: [
				...new Set(
					spending.filter((bill) => bill.currency !== currency).map((bill) => bill.accountId),
				),
			].map((id) => ({ id })),
		},
	};
}

/** An occurrence as the bill tools read it, its amounts positive magnitudes. */
export type OccurrenceView = {
	dueOn: IsoDate;
	effectiveDueOn: IsoDate;
	state: OccurrenceState;
	expected: MinorUnits;
	paid: MinorUnits;
	remaining: MinorUnits;
	currency: string;
};

/** A payment toward a closed occurrence. */
type PaymentView = {
	amount: MinorUnits;
	paidOn: IsoDate | null;
	source: AllocationSource;
	state: AllocationState;
	transactionId: string | null;
	/** `null` without a transaction, or once it was deleted. */
	transactionLabel: string | null;
};

export type BillHistory = {
	bill: BillView & { schedulePinned: boolean };
	/** Every open occurrence, by due date. */
	open: OccurrenceView[];
	/** The latest closed ones first, `HISTORY_LIMIT` at most. */
	closed: (OccurrenceView & { status: OccurrenceStatus; payments: PaymentView[] })[];
	/** Every closed occurrence, those `closed` leaves out included. */
	closedCount: number;
	nextDueDates: IsoDate[];
	/** Of the last `PRICE_CHANGE_MONTHS`, latest first. */
	priceChanges: PriceChange[];
};

// Sure's `HISTORY_LIMIT` and `PRICE_CHANGE_LOOKBACK_MONTHS`.
const HISTORY_LIMIT = 12;
const PRICE_CHANGE_MONTHS = 24;

/**
 * Sure's `GetBillDetails` without its analytics: the series, its open
 * occurrences, its twelve latest closed ones with every payment, its next
 * three due dates after today and its price changes of the last 24 months.
 * Read through the bills page's own loader, so an occurrence reads the same
 * on the page and here.
 */
export async function billHistory(deps: ServiceDeps, id: string): Promise<BillHistory> {
	const day = today(deps.timeZone);
	const view = await billView(deps, id);
	const pinned = await deps.db
		.select({ at: recurringTransactions.schedulePinnedAt })
		.from(recurringTransactions)
		.where(eq(recurringTransactions.id, id))
		.get();
	const { rows, allocations } = await loadBills(
		deps.db,
		eq(recurringOccurrences.recurringTransactionId, id),
		day,
	);
	const toView = (row: (typeof rows)[number]): OccurrenceView => ({
		dueOn: row.dueOn,
		effectiveDueOn: row.effectiveDueOn,
		state: row.state,
		expected: row.expected,
		paid: row.confirmed,
		remaining: row.remaining,
		currency: row.currency,
	});
	const closed = rows.filter((row) => row.status !== "scheduled");
	const shown = closed.toReversed().slice(0, HISTORY_LIMIT);
	const shownIds = new Set(shown.map((row) => row.occurrenceId));
	const paid = allocations
		.filter((one) => shownIds.has(one.occurrenceId))
		.toSorted(
			(a, b) =>
				(a.paidOn ?? "").localeCompare(b.paidOn ?? "") ||
				a.createdAt - b.createdAt ||
				a.id.localeCompare(b.id),
		);
	const named = await paymentEntries(
		deps.db,
		paid.flatMap((one) => (one.entryId === null ? [] : [one.entryId])),
	);

	return {
		bill: { ...view, schedulePinned: pinned?.at !== null && pinned?.at !== undefined },
		open: rows.filter((row) => row.status === "scheduled").map(toView),
		closed: shown.map((row) => ({
			...toView(row),
			status: row.status,
			payments: paid
				.filter((one) => one.occurrenceId === row.occurrenceId)
				.map((one) => ({
					amount: one.amount,
					paidOn: one.paidOn,
					source: one.source,
					state: one.state,
					transactionId: one.entryId,
					transactionLabel: one.entryId === null ? null : (named.get(one.entryId)?.label ?? null),
				})),
		})),
		closedCount: closed.length,
		nextDueDates: nextDueDates(view, addDays(day, 1)),
		priceChanges: await priceChangesWhere(
			deps.db,
			and(
				eq(recurringPriceChanges.recurringTransactionId, id),
				gte(recurringPriceChanges.effectiveOn, addMonths(day, -PRICE_CHANGE_MONTHS)),
			),
		),
	};
}
