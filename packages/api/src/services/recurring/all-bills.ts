import type { IsoDate, IsoMonth } from "../../domain/dates.ts";
import type { AllBillsQuery, BillSort, BillStatusFilter } from "../../schemas/bills.ts";
import type { ServiceDeps } from "../deps.ts";
import type { AmountRange, Reader } from "./bill-overview.ts";
import type { CurrentOccurrence } from "./occurrences.ts";
import type { RecurringRecord } from "./series.ts";
import type { SQL } from "drizzle-orm";

import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import {
	recurringAllocations,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addMonths, today } from "../../domain/dates.ts";
import { displayName } from "../../domain/recurring/bills.ts";
import {
	changePercent,
	remainingOf,
	resolvedExpected,
	roundHalfUp,
} from "../../domain/recurring/occurrences.ts";
import { monthlyEquivalent, monthlyRollup } from "../../domain/recurring/schedule.ts";
import { paymentEntries } from "../ledger/recurring.ts";
import { KEYS_PER_LOOKUP, inSequence } from "../ledger/shared.ts";
import { getReportingCurrency } from "../settings.ts";
import { estimatedRange } from "./bill-overview.ts";
import { getRecord, nullableMinor, selectRecords, toRecords } from "./series.ts";

/** A series' current occurrence, with what its confirmed payments settle. */
export type BillOccurrence = CurrentOccurrence & {
	/** Positive magnitudes in the series' currency. */
	expected: MinorUnits;
	confirmed: MinorUnits;
	remaining: MinorUnits;
	/** The series' band, magnitudes ascending, only when `expected` is an estimate. */
	amountRange: AmountRange | null;
};

/** A series as « Toutes les factures » lists it. */
export type BillRecord = Omit<RecurringRecord, "currentOccurrence"> & {
	/** Sure's `monthly_equivalent_amount`, a positive magnitude in `currency`. */
	monthlyEquivalent: MinorUnits;
	currentOccurrence: BillOccurrence | null;
};

/** A recorded price change, its amounts positive magnitudes. */
export type PriceChange = {
	id: string;
	seriesId: string;
	/** The series' name, else its merchant's, else its label. */
	name: string;
	effectiveOn: IsoDate;
	previousAmount: MinorUnits;
	newAmount: MinorUnits;
	currency: string;
	/** Tenths of a percent, negative for a fall. */
	percent: number;
};

/** Sure's `load_subscription_rollup`, in the reporting currency. */
type SubscriptionRollup = {
	currency: CurrencyCode;
	/** The active subscriptions listed, whatever their currency. */
	count: number;
	/** `null` when no subscription listed is active. */
	monthly: MinorUnits | null;
	annual: MinorUnits | null;
	/** The active ones in another currency, which the sums leave out (NFR2). */
	leftOut: { id: string; name: string }[];
	/** Any series' ten latest changes within a year. */
	priceChanges: PriceChange[];
};

export type AllBills = {
	bills: BillRecord[];
	/** Only with `type = subscription`. */
	subscriptions: SubscriptionRollup | null;
};

// Sure's `recent_price_changes(5)` and the rollup's `limit(10)`.
const DETAIL_PRICE_CHANGES = 5;

const ROLLUP_PRICE_CHANGES = 10;

const ROLLUP_PRICE_CHANGE_MONTHS = 12;

// Sure's sparkline: this month and the eleven before it.
const HISTORY_MONTHS = 12;

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const sumOf = (amounts: readonly MinorUnits[]) =>
	toMinorUnits(amounts.reduce((total, amount) => total + amount, 0));

/**
 * `records` with their monthly equivalent, and their current occurrence's
 * expected amount, the sum of its confirmed payments and what they leave.
 */
export async function withAmounts(
	db: Reader,
	records: readonly RecurringRecord[],
): Promise<BillRecord[]> {
	const ids = records.flatMap((record) =>
		record.currentOccurrence === null ? [] : [record.currentOccurrence.id],
	);
	const frozen = new Map<string, number | null>();
	const paid = new Map<string, MinorUnits[]>();

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		const occurrences = await db
			.select({ id: recurringOccurrences.id, expectedAmount: recurringOccurrences.expectedAmount })
			.from(recurringOccurrences)
			.where(inArray(recurringOccurrences.id, chunk));
		const payments = await db
			.select({
				occurrenceId: recurringAllocations.recurringOccurrenceId,
				amount: recurringAllocations.allocatedAmount,
			})
			.from(recurringAllocations)
			.where(
				and(
					inArray(recurringAllocations.recurringOccurrenceId, chunk),
					eq(recurringAllocations.state, "confirmed"),
				),
			);

		for (const occurrence of occurrences) {
			frozen.set(occurrence.id, occurrence.expectedAmount);
		}

		for (const payment of payments) {
			paid.set(payment.occurrenceId, [
				...(paid.get(payment.occurrenceId) ?? []),
				toMinorUnits(payment.amount),
			]);
		}
	});

	return records.map(({ currentOccurrence: occurrence, ...record }) => {
		const monthly = monthlyEquivalent(record.rules, record.amount);

		if (occurrence === null) {
			return { ...record, monthlyEquivalent: monthly, currentOccurrence: null };
		}

		const stored = nullableMinor(frozen.get(occurrence.id) ?? null);
		const expected = resolvedExpected({ expectedAmount: stored }, record.amount);
		const confirmed = paid.get(occurrence.id) ?? [];

		return {
			...record,
			monthlyEquivalent: monthly,
			currentOccurrence: {
				...occurrence,
				expected,
				confirmed: sumOf(confirmed),
				remaining: remainingOf(expected, confirmed),
				amountRange: estimatedRange(stored, record),
			},
		};
	});
}

/**
 * Sure's `filter_by_payment_state` and lifecycle filters: the payment
 * filters read the current occurrence, so a series with none fails them.
 */
function inStatus(row: BillRecord, filter: BillStatusFilter): boolean {
	if (filter === "paused") {
		return row.status === "inactive";
	}

	if (filter === "ended") {
		return row.status === "ended";
	}

	const occurrence = row.currentOccurrence;

	if (occurrence === null) {
		return false;
	}

	switch (filter) {
		case "overdue":
		case "due":
			return occurrence.state === filter;
		case "partial":
			return (
				occurrence.status === "scheduled" &&
				occurrence.confirmed > 0 &&
				occurrence.confirmed < occurrence.expected
			);
		default:
			return occurrence.status === "paid";
	}
}

// Sure's `order(:status, :next_expected_date)` on its string column: `active`,
// `ended`, `inactive`.
const STATUS_RANK: Record<RecurringRecord["status"], number> = {
	suggested: 0,
	active: 0,
	ended: 1,
	inactive: 2,
};

/**
 * Sure's `order(:name, :amount)`: the stored name, a series without one
 * last as SQL sorts a null name, then Sure's outflow-positive amount
 * ascending, which is Archant's descending (AD-5): an income first, then
 * the smallest outflow.
 */
function byStoredName(a: BillRecord, b: BillRecord): number {
	if (a.name === null || b.name === null) {
		return Number(a.name === null) - Number(b.name === null);
	}

	return byName.compare(a.name, b.name);
}

const SORTS: Record<BillSort, (a: BillRecord, b: BillRecord) => number> = {
	due: (a, b) =>
		STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
		a.nextExpectedDate.localeCompare(b.nextExpectedDate) ||
		a.id.localeCompare(b.id),
	name: (a, b) => byStoredName(a, b) || b.amount - a.amount || a.id.localeCompare(b.id),
	// Sure's `amount: :desc` on its outflow-positive amounts: the largest
	// outflow first, incomes last (AD-5).
	amount: (a, b) => a.amount - b.amount || a.id.localeCompare(b.id),
};

/** The price changes `where` keeps, latest first, `limit` at most when given, named by their series. */
export async function priceChangesWhere(
	db: Reader,
	where: SQL | undefined,
	limit?: number,
): Promise<PriceChange[]> {
	const query = db
		.select({
			id: recurringPriceChanges.id,
			seriesId: recurringPriceChanges.recurringTransactionId,
			seriesName: recurringTransactions.name,
			merchantName: merchants.name,
			label: recurringTransactions.label,
			effectiveOn: recurringPriceChanges.effectiveOn,
			previousAmount: recurringPriceChanges.previousAmount,
			newAmount: recurringPriceChanges.newAmount,
			currency: recurringPriceChanges.currency,
		})
		.from(recurringPriceChanges)
		.innerJoin(
			recurringTransactions,
			eq(recurringTransactions.id, recurringPriceChanges.recurringTransactionId),
		)
		.leftJoin(merchants, eq(merchants.id, recurringTransactions.merchantId))
		.where(where)
		.orderBy(desc(recurringPriceChanges.effectiveOn), recurringPriceChanges.id)
		.$dynamic();
	const rows = await (limit === undefined ? query : query.limit(limit));

	return rows.map(({ seriesName, merchantName, label, ...row }) => {
		const previousAmount = toMinorUnits(row.previousAmount);
		const newAmount = toMinorUnits(row.newAmount);

		return {
			...row,
			name: displayName({ name: seriesName, merchantName, label }),
			previousAmount,
			newAmount,
			percent: changePercent(previousAmount, newAmount),
		};
	});
}

/**
 * Sure's `load_subscription_rollup` over `rows`: the active ones counted,
 * their monthly equivalents summed in the reporting currency, those in
 * another one left out and named, and any series' ten latest price changes
 * of the past year.
 */
async function subscriptionRollup(
	db: Reader,
	rows: readonly BillRecord[],
	day: IsoDate,
): Promise<SubscriptionRollup> {
	const currency = getReportingCurrency();
	const active = rows.filter((row) => row.status === "active");
	const counted = active.filter((row) => row.currency === currency);
	const sums = active.length === 0 ? null : monthlyRollup(counted);

	return {
		currency,
		count: active.length,
		monthly: sums?.monthly ?? null,
		annual: sums?.annual ?? null,
		leftOut: active
			.filter((row) => row.currency !== currency)
			.map((row) => ({ id: row.id, name: displayName(row) })),
		priceChanges: await priceChangesWhere(
			db,
			gte(recurringPriceChanges.effectiveOn, addMonths(day, -ROLLUP_PRICE_CHANGE_MONTHS)),
			ROLLUP_PRICE_CHANGES,
		),
	};
}

/**
 * Sure's `load_all_series`: every series but the suggestions, ended ones
 * included, each with its monthly equivalent and its current occurrence's
 * payments. `q` searches the name, the merchant's name and the label; the
 * status filters read the current occurrence's payment state, or `paused`
 * and `ended`. Sorted by status then next date, by name, or by amount.
 * With `type = subscription`, Sure's subscription rollup comes beside.
 */
export async function allBills(deps: ServiceDeps, query: AllBillsQuery): Promise<AllBills> {
	const day = today(deps.timeZone);
	const rows = await withAmounts(
		deps.db,
		await toRecords(
			deps.db,
			await selectRecords(deps.db).where(ne(recurringTransactions.status, "suggested")),
			day,
		),
	);
	const needle = query.q?.toLocaleLowerCase("fr");
	const bills = rows
		.filter(
			(row) =>
				(needle === undefined ||
					[row.name, row.merchantName, row.label].some(
						(text) => text?.toLocaleLowerCase("fr").includes(needle) ?? false,
					)) &&
				(query.status === undefined || inStatus(row, query.status)) &&
				(query.type === undefined || row.billType === query.type),
		)
		.toSorted(SORTS[query.sort]);

	return {
		bills,
		subscriptions:
			query.type === "subscription" ? await subscriptionRollup(deps.db, bills, day) : null,
	};
}

/** Sure's `bills#show`, as the drawer reads it. */
export type BillDetail = {
	record: BillRecord;
	/** Over the paid occurrences' confirmed sums; `null` when none is paid. */
	averagePaid: { average: MinorUnits; lowest: MinorUnits; highest: MinorUnits } | null;
	/** The five latest. */
	priceChanges: PriceChange[];
	/** How many occurrences are paid, of the plan's payments. */
	installment: { paid: number; total: number } | null;
	/** The account of the latest confirmed payment with a transaction. */
	lastAccount: { id: string; name: string } | null;
	/** Twelve months to this one, what was paid toward the occurrences due in each. */
	months: { month: IsoMonth; paid: MinorUnits }[];
};

/**
 * Sure's `bills#show` without its matching rules, yearly table, upcoming
 * dates, recent payments and history: the series with its current
 * occurrence, Sure's `@analytics` average and range, its price changes, an
 * installment's progress, the last account used and Sure's twelve-month
 * sparkline, each month summing the confirmed payments of the occurrences
 * due in it, whatever their status.
 */
export async function billDetail(deps: ServiceDeps, id: string): Promise<BillDetail> {
	const day = today(deps.timeZone);
	const [record] = await withAmounts(deps.db, [await getRecord(deps.db, id, day)]);
	const occurrences = await deps.db
		.select({
			id: recurringOccurrences.id,
			dueOn: recurringOccurrences.dueOn,
			status: recurringOccurrences.status,
		})
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.recurringTransactionId, id));
	const payments = (
		await deps.db
			.select({
				occurrenceId: recurringAllocations.recurringOccurrenceId,
				amount: recurringAllocations.allocatedAmount,
				entryId: recurringAllocations.entryId,
				paidOn: recurringAllocations.paidOn,
				createdAt: recurringAllocations.createdAt,
			})
			.from(recurringAllocations)
			.innerJoin(
				recurringOccurrences,
				eq(recurringOccurrences.id, recurringAllocations.recurringOccurrenceId),
			)
			.where(
				and(
					eq(recurringOccurrences.recurringTransactionId, id),
					eq(recurringAllocations.state, "confirmed"),
				),
			)
	).map((payment) => ({ ...payment, amount: toMinorUnits(payment.amount) }));
	const paidIds = new Set(
		occurrences.filter((occurrence) => occurrence.status === "paid").map((one) => one.id),
	);
	// Sure groups the payments by occurrence, so a paid one without any has no sum.
	const sums = [...paidIds].flatMap((occurrenceId) => {
		const own = payments.filter((payment) => payment.occurrenceId === occurrenceId);

		return own.length === 0 ? [] : [sumOf(own.map((payment) => payment.amount))];
	});
	const latest = payments
		.filter((payment) => payment.entryId !== null)
		.toSorted(
			(a, b) =>
				(b.paidOn ?? "").localeCompare(a.paidOn ?? "") ||
				b.createdAt - a.createdAt ||
				a.occurrenceId.localeCompare(b.occurrenceId),
		)[0];
	const entry =
		latest === undefined || latest.entryId === null
			? undefined
			: (await paymentEntries(deps.db, [latest.entryId])).get(latest.entryId);
	const account =
		entry === undefined
			? undefined
			: await deps.db
					.select({ id: accounts.id, name: accounts.name })
					.from(accounts)
					.where(eq(accounts.id, entry.accountId))
					.get();
	const dueOf = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence.dueOn]));
	const first = shiftMonth(day.slice(0, 7), 1 - HISTORY_MONTHS);

	return {
		record: record!,
		averagePaid:
			sums.length === 0
				? null
				: {
						average: toMinorUnits(roundHalfUp(sumOf(sums), sums.length)),
						lowest: toMinorUnits(Math.min(...sums)),
						highest: toMinorUnits(Math.max(...sums)),
					},
		priceChanges: await priceChangesWhere(
			deps.db,
			eq(recurringPriceChanges.recurringTransactionId, id),
			DETAIL_PRICE_CHANGES,
		),
		installment:
			record!.billType === "installment" && record!.endAfterCount !== null
				? { paid: paidIds.size, total: record!.endAfterCount }
				: null,
		lastAccount: account ?? null,
		months: Array.from({ length: HISTORY_MONTHS }, (_, index) => {
			const month = shiftMonth(first, index);

			return {
				month,
				paid: sumOf(
					payments
						.filter((payment) => dueOf.get(payment.occurrenceId)?.startsWith(month) ?? false)
						.map((payment) => payment.amount),
				),
			};
		}),
	};
}
