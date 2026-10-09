import type { IsoDate, IsoMonth } from "../../domain/dates.ts";
import type { SeriesKey } from "../../domain/recurring/identifier.ts";
import type { OccurrenceState } from "../../domain/recurring/occurrences.ts";
import type {
	AllBillsQuery,
	BillKind,
	BillSort,
	BillStatusFilter,
	DeclareInput,
	EditInput,
} from "../../schemas/bills.ts";
import type { RecurringPatch } from "../../schemas/recurring.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { CurrentOccurrence } from "./occurrences.ts";
import type { RecurringRecord } from "./series.ts";
import type { SQL } from "drizzle-orm";

import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import type { AllocationSource } from "@archant/data/recurring";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import type { MatchSignals } from "@archant/data/schema/recurring-occurrences";
import {
	recurringAllocations,
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../../domain/cash-flow.ts";
import {
	addDays,
	addMonths,
	daysBetween,
	maxDate,
	monthRange,
	today,
	weekdayOf,
} from "../../domain/dates.ts";
import { normalizeLabel } from "../../domain/normalize-label.ts";
import { majorUnitOf } from "../../domain/recurring/classifier.ts";
import { applyFrequency } from "../../domain/recurring/frequency.ts";
import {
	claimOf,
	detectRecurring as detectPatterns,
	roundedMean,
	sameKey,
	seriesKeyOf,
} from "../../domain/recurring/identifier.ts";
import {
	changePercent,
	effectiveDueOn,
	occurrenceState,
	remainingOf,
	resolvedExpected,
	roundHalfUp,
} from "../../domain/recurring/occurrences.ts";
import { monthlyEquivalent, monthlyOn, monthlyRollup } from "../../domain/recurring/schedule.ts";
import { isKept, nextDateFrom, nextExpectedDate } from "../../domain/recurring/series.ts";
import { AppError } from "../../lib/errors.ts";
import { validationError } from "../../lib/zod-error.ts";
import { declareBillSchema, editBillSchema } from "../../schemas/bills.ts";
import { findTransaction } from "../ledger/queries.ts";
import { hasTransactions, paymentEntries } from "../ledger/recurring.ts";
import { KEYS_PER_LOOKUP, inSequence } from "../ledger/shared.ts";
import { getReportingCurrency } from "../settings.ts";
import { parseSignals } from "./hints.ts";
import { pinAmountsAlreadyDue, regenerateFuture } from "./occurrences.ts";
import { insertRules, replaceRules } from "./rules.ts";
import {
	getRecord,
	invalid,
	loadCandidates,
	merchantNames,
	notFound,
	nullableMinor,
	selectRecords,
	setRecurringStatus,
	setStatusWithin,
	toRecords,
} from "./series.ts";

// Sure's `first(8)`: the dialog offers a few starting points, never a list to page.
const MAX_CANDIDATES = 8;
// Sure's `income_source_candidates` reads 90 days of deposits, and needs two.
const INCOME_LOOKBACK_DAYS = 90;
const MIN_CANDIDATE_ROWS = 2;

/** A starting point of the declare dialog: a recurring charge or deposit no series follows. */
export type BillCandidate = {
	/** The latest transaction, which the dialog fills the form from. */
	entryId: string;
	/** The merchant's name, else the label. */
	name: string;
	/** The magnitude of the mean, in `currency`. */
	amount: MinorUnits;
	currency: string;
	accountId: string;
	occurrenceCount: number;
	lastOccurrenceDate: IsoDate;
	/** The latest transaction's own signed amount. */
	entryAmount: MinorUnits;
};

const alreadyExists = () =>
	new AppError("RECURRING_ALREADY_EXISTS", "A series with this account, key and amount exists.");

/** The account's currency, or a `VALIDATION_ERROR` on `accountId` when there is no such account. */
async function currencyOfAccount(
	db: Pick<Transaction, "select">,
	accountId: string | undefined,
): Promise<CurrencyCode> {
	const row =
		accountId === undefined
			? undefined
			: await db
					.select({ currency: accounts.currency })
					.from(accounts)
					.where(eq(accounts.id, accountId))
					.get();

	if (row === undefined || !isCurrencyCode(row.currency)) {
		throw invalid("accountId");
	}

	return row.currency;
}

/** A `VALIDATION_ERROR` on `categoryId` when there is no such category. */
async function mustBeCategory(db: Pick<Transaction, "select">, categoryId: string): Promise<void> {
	const found = await db
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.id, categoryId))
		.get();

	if (found === undefined) {
		throw invalid("categoryId");
	}
}

/**
 * Whether another series holds what the unique indexes key on: account, key,
 * amount, currency and dedup scope. Checked inside the write transaction, so
 * the answer is a `409`, never a constraint failure.
 */
export async function taken(
	tx: Pick<Transaction, "select">,
	row: SeriesKey & {
		accountId: string;
		amount: MinorUnits;
		currency: string;
		dedupScope: string;
	},
	except?: string,
): Promise<boolean> {
	const found = await tx
		.select({ id: recurringTransactions.id })
		.from(recurringTransactions)
		.where(
			and(
				eq(recurringTransactions.accountId, row.accountId),
				row.merchantId === null
					? isNull(recurringTransactions.merchantId)
					: eq(recurringTransactions.merchantId, row.merchantId),
				row.labelKey === null
					? isNull(recurringTransactions.labelKey)
					: eq(recurringTransactions.labelKey, row.labelKey),
				eq(recurringTransactions.amount, row.amount),
				eq(recurringTransactions.currency, row.currency),
				eq(recurringTransactions.dedupScope, row.dedupScope),
				except === undefined ? undefined : ne(recurringTransactions.id, except),
			),
		)
		.get();

	return found !== undefined;
}

/**
 * Sure's `DeclaredBill`: an active manual series, anchored, last seen and due
 * on its first due date, with no payment yet, its amount negative for a bill
 * and positive for an income (AD-5), typed and categorised as asked, an
 * income always `income` and uncategorised, its rules those of the frequency picked
 * on that date's day, weekday and month. Its key is the merchant or label of
 * the transaction it started from, so 23.3's matcher still finds it, else its
 * normalised name. Its amount is its `dedup_scope`, as Sure's: the same
 * account, key and amount twice answers `RECURRING_ALREADY_EXISTS`.
 */
export async function declareBill(
	deps: ServiceDeps,
	input: DeclareInput,
): Promise<RecurringRecord> {
	const currency = await currencyOfAccount(deps.db, input.accountId);
	const parsed = declareBillSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const bill = parsed.data;
	const entry = bill.entryId === null ? null : await findTransaction(deps, bill.entryId);

	if (bill.entryId !== null && entry === null) {
		throw notFound("transaction");
	}

	const key: SeriesKey =
		entry === null ? { merchantId: null, labelKey: normalizeLabel(bill.name) } : seriesKeyOf(entry);
	const amount = toMinorUnits(bill.kind === "income" ? bill.amount : -Math.abs(bill.amount));
	const due = bill.firstDueOn;
	const day = Number(due.slice(8, 10));
	// No rule yet, so any preset changes the cadence.
	const schedule = applyFrequency(
		{ rules: [], anchorDate: due, lastOccurrenceDate: due, expectedDayOfMonth: day },
		{
			...bill.frequency,
			dayOfMonth: day,
			weekday: weekdayOf(due),
			monthOfYear: Number(due.slice(5, 7)),
		},
	) ?? { rules: [monthlyOn(day)], expectedDayOfMonth: day, anchorDate: due };
	const row = {
		...key,
		accountId: bill.accountId,
		amount,
		currency,
		dedupScope: String(amount),
	};

	const date = today(deps.timeZone);
	const income = bill.kind === "income";
	// An income carries no category, as detection writes one (Sure's `create_suggested_series`).
	const categoryId = income ? null : bill.categoryId;

	return deps.db.transaction(
		async (tx) => {
			if (await taken(tx, row)) {
				throw alreadyExists();
			}

			if (categoryId !== null) {
				await mustBeCategory(tx, categoryId);
			}

			const id = crypto.randomUUID();
			const now = Date.now();

			await tx.insert(recurringTransactions).values({
				...row,
				id,
				label: entry?.label ?? bill.name,
				name: bill.name,
				expectedDayOfMonth: schedule.expectedDayOfMonth,
				anchorDate: due,
				lastOccurrenceDate: due,
				nextExpectedDate: due,
				occurrenceCount: 0,
				status: "active",
				manual: true,
				billType: income ? "income" : bill.billType,
				categoryId,
				autopay: bill.autopay,
				notes: bill.notes,
				paymentUrl: bill.paymentUrl,
				createdAt: now,
				updatedAt: now,
			});
			await insertRules(tx, [{ id, rules: schedule.rules }]);
			await regenerateFuture(tx, [id], date);

			return getRecord(tx, id, date);
		},
		{ behavior: "immediate" },
	);
}

/** `PATCH /api/recurring/:id`: a status move or an edit, the schema never letting both through. */
export async function patchRecurring(
	deps: ServiceDeps,
	id: string,
	{ status, ...edit }: RecurringPatch,
): Promise<RecurringRecord> {
	return status === undefined ? editBill(deps, id, edit) : setRecurringStatus(deps, id, status);
}

/**
 * Sure's edit dialog: name, amount with the series' sign kept, account with
 * its currency, type but never to or from `income`, category, frequency,
 * number of payments for an installment, cleared for any other type,
 * autopay, notes and payment link. A changed cadence pins the schedule, as
 * Sure's `pin_schedule`, so detection moves its dates but never its day, and
 * a series the owner follows is due on its new schedule's first date from
 * today on, or from its first due date for a bill declared ahead of it.
 */
export async function editBill(
	deps: ServiceDeps,
	id: string,
	input: EditInput,
): Promise<RecurringRecord> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			await editWithin(tx, id, input, day);

			return getRecord(tx, id, day);
		},
		{ behavior: "immediate" },
	);
}

/**
 * The assistant's `update_bill`: the edit dialog's fields and a status move,
 * in one transaction, so a refusal of either writes nothing. The edit comes
 * first, so a bill resumed on a new cadence gets that cadence's occurrences.
 * A status the series already has is left as it is.
 */
export async function updateBill(
	deps: ServiceDeps,
	id: string,
	{ status, ...edit }: EditInput & { status?: "active" | "inactive" | undefined },
): Promise<RecurringRecord> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			if (Object.values(edit).some((value) => value !== undefined)) {
				await editWithin(tx, id, edit, day);
			}

			if (status !== undefined && (await getRecord(tx, id, day)).status !== status) {
				await setStatusWithin(tx, id, status, day);
			}

			return getRecord(tx, id, day);
		},
		{ behavior: "immediate" },
	);
}

async function editWithin(
	tx: Transaction,
	id: string,
	input: EditInput,
	day: IsoDate,
): Promise<void> {
	const current = await getRecord(tx, id, day);
	const currency = await currencyOfAccount(tx, input.accountId ?? current.accountId);
	const parsed = editBillSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const edit = parsed.data;

	if (edit.billType !== undefined && current.billType === "income") {
		throw invalid("billType");
	}

	if (edit.categoryId !== undefined && edit.categoryId !== null) {
		await mustBeCategory(tx, edit.categoryId);
	}

	const billType = edit.billType ?? current.billType;
	const amount =
		edit.amount === undefined
			? current.amount
			: toMinorUnits(current.amount > 0 ? edit.amount : -Math.abs(edit.amount));
	const change = edit.frequency === undefined ? null : applyFrequency(current, edit.frequency);
	const endAfterCount =
		billType === "installment"
			? edit.endAfterCount === undefined
				? current.endAfterCount
				: edit.endAfterCount
			: null;
	// An installment counts its payments from an anchor, as Sure's update.
	const anchorDate =
		(change === null ? current.anchorDate : change.anchorDate) ??
		(endAfterCount === null ? null : current.lastOccurrenceDate);
	const schedule = {
		rules: change?.rules ?? current.rules,
		anchorDate,
		lastOccurrenceDate: current.lastOccurrenceDate,
		endAfterCount,
		expectedDayOfMonth: change?.expectedDayOfMonth ?? current.expectedDayOfMonth,
	};
	const rescheduled =
		change !== null || endAfterCount !== current.endAfterCount || anchorDate !== current.anchorDate;
	// A bill declared ahead of its first payment is due from that date on.
	const from = current.occurrenceCount === 0 ? maxDate(day, current.lastOccurrenceDate) : day;
	const next = !rescheduled
		? current.nextExpectedDate
		: isKept(current)
			? (nextDateFrom(schedule, from) ?? current.nextExpectedDate)
			: nextExpectedDate(schedule, current.lastOccurrenceDate);
	const accountId = edit.accountId ?? current.accountId;
	const moved = currency !== current.currency;
	if (
		(accountId !== current.accountId || amount !== current.amount || moved) &&
		(await taken(tx, { ...(await storedKeyOf(tx, id)), accountId, amount, currency }, id))
	) {
		throw alreadyExists();
	}

	await tx
		.update(recurringTransactions)
		.set({
			...(edit.name === undefined ? {} : { name: edit.name }),
			accountId,
			amount,
			currency,
			// A band in another currency means nothing in this one.
			...(moved
				? { expectedAmountMin: null, expectedAmountMax: null, expectedAmountAvg: null }
				: {}),
			billType,
			...(edit.categoryId === undefined ? {} : { categoryId: edit.categoryId }),
			...(edit.autopay === undefined ? {} : { autopay: edit.autopay }),
			...(edit.notes === undefined ? {} : { notes: edit.notes }),
			...(edit.paymentUrl === undefined ? {} : { paymentUrl: edit.paymentUrl }),
			anchorDate,
			endAfterCount,
			expectedDayOfMonth: schedule.expectedDayOfMonth,
			nextExpectedDate: next,
			...(change === null ? {} : { schedulePinnedAt: Date.now() }),
			updatedAt: Date.now(),
		})
		.where(eq(recurringTransactions.id, id));

	if (change !== null) {
		await replaceRules(tx, id, change.rules);
	}

	// Sure's `SCHEDULE_SHAPING_ATTRIBUTES`: the occurrences to come follow
	// a new cadence, day, anchor, number of payments or currency.
	if (rescheduled || schedule.expectedDayOfMonth !== current.expectedDayOfMonth || moved) {
		await regenerateFuture(tx, [id], day);
	}

	if (amount !== current.amount) {
		await pinAmountsAlreadyDue(tx, id, current.amount, day);
	}
}

/** The key and dedup scope a series is stored under, which an edit keeps. */
async function storedKeyOf(tx: Pick<Transaction, "select">, id: string) {
	const row = await tx
		.select({
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			dedupScope: recurringTransactions.dedupScope,
		})
		.from(recurringTransactions)
		.where(eq(recurringTransactions.id, id))
		.get();

	if (row === undefined) {
		throw notFound("recurring transaction");
	}

	return row;
}

/** The declare dialog's starting points: `candidatePatterns`' first eight. */
export async function billCandidates(deps: ServiceDeps, kind: BillKind): Promise<BillCandidate[]> {
	return (await candidatePatterns(deps, kind)).slice(0, MAX_CANDIDATES);
}

/**
 * What no series follows yet, on active accounts only, the ones the declare
 * dialog offers. For a bill, Sure's `candidate_patterns`, latest first; for
 * an income, Sure's `income_source_candidates`: deposits of the last 90 days
 * grouped by account, key and currency, two or more whose mean is one major
 * unit at least, that no income series of that account, key and currency
 * follows, the largest total first. Every one: the audit lists them all.
 */
export async function candidatePatterns(
	deps: ServiceDeps,
	kind: BillKind,
): Promise<BillCandidate[]> {
	const day = today(deps.timeZone);
	const { detectable: all } = await loadCandidates(deps.db, day);
	// The dialog offers active accounts only, as the account it would fill.
	const active = new Set(
		(await deps.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.active, true))).map(
			(row) => row.id,
		),
	);
	const detectable = all.filter((row) => active.has(row.accountId));
	const names = await merchantNames(deps.db);
	const nameOf = (row: { merchantId: string | null; label: string }) =>
		(row.merchantId === null ? undefined : names.get(row.merchantId)) ?? row.label;
	const stored = await deps.db
		.select({
			accountId: recurringTransactions.accountId,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			currency: recurringTransactions.currency,
			amount: recurringTransactions.amount,
			billType: recurringTransactions.billType,
		})
		.from(recurringTransactions);
	const series = stored.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));

	// Sure's `candidate_patterns(sign: :outflow)`: the identifier's patterns of
	// two rows or more, outflows whose mean is one major unit at least, that no
	// series of their account, key and currency claims within 7.5 %, latest first.
	if (kind === "bill") {
		return detectPatterns(detectable, day, MIN_CANDIDATE_ROWS)
			.filter(
				(pattern) =>
					pattern.amount < 0 &&
					Math.abs(pattern.amountTotal) >=
						pattern.occurrenceCount * majorUnitOf(pattern.currency) &&
					claimOf(pattern, series) === undefined,
			)
			.toSorted((a, b) => b.lastOccurrenceDate.localeCompare(a.lastOccurrenceDate))
			.map((pattern) => ({
				entryId: pattern.latest.id,
				name: nameOf(pattern.latest),
				amount: toMinorUnits(Math.abs(pattern.expectedAmountAvg)),
				currency: pattern.currency,
				accountId: pattern.accountId,
				occurrenceCount: pattern.occurrenceCount,
				lastOccurrenceDate: pattern.lastOccurrenceDate,
				entryAmount: pattern.latest.amount,
			}));
	}

	const from = addDays(day, -INCOME_LOOKBACK_DAYS);
	const groups = new Map<string, typeof detectable>();

	for (const row of detectable) {
		if (row.date < from || direction(row) !== "income") {
			continue;
		}

		const key = seriesKeyOf(row);
		const group = JSON.stringify([row.accountId, key.merchantId, key.labelKey, row.currency]);
		groups.set(group, [...(groups.get(group) ?? []), row]);
	}

	return [...groups.values()]
		.flatMap((group): (BillCandidate & { total: MinorUnits })[] => {
			const first = group[0]!;
			const total = toMinorUnits(group.reduce((sum, row) => sum + row.amount, 0));
			const key = seriesKeyOf(first);
			// The first of the latest day, as Ruby's `max_by`.
			const latest = group.reduce((best, row) => (row.date > best.date ? row : best));

			if (
				group.length < MIN_CANDIDATE_ROWS ||
				total < group.length * majorUnitOf(first.currency) ||
				series.some(
					(other) =>
						other.billType === "income" &&
						other.accountId === first.accountId &&
						other.currency === first.currency &&
						sameKey(other, key),
				)
			) {
				return [];
			}

			return [
				{
					entryId: latest.id,
					name: nameOf(latest),
					amount: roundedMean(total, group.length),
					currency: first.currency,
					accountId: first.accountId,
					occurrenceCount: group.length,
					lastOccurrenceDate: latest.date,
					entryAmount: latest.amount,
					total,
				},
			];
		})
		.toSorted((a, b) => b.total - a.total)
		.map(({ total: _total, ...candidate }) => candidate);
}

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
	accountId: string;
	accountName: string;
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
type AmountRange = { min: MinorUnits; max: MinorUnits };

/**
 * Sure's `occurrence_amount_estimated?` with `has_amount_variance?` for a
 * `fixed` series, Archant having no other strategy: the occurrence has no
 * expected amount of its own and the series' amounts spread. The band, as
 * magnitudes ascending, else `null`.
 */
function estimatedRange(
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

type Reader = Pick<Transaction, "select">;

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
			merchantName: merchants.name,
		})
		.from(recurringOccurrences)
		.innerJoin(
			recurringTransactions,
			eq(recurringTransactions.id, recurringOccurrences.recurringTransactionId),
		)
		.innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
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
 * month's paid ones. An inactive series' open ones are « Inactive »; an
 * active series' overdue ones need attention, those due by the month's end
 * are the month's, beside its paid ones, and the later ones show one per
 * series. Skipped and missed occurrences are not listed. The totals are
 * Sure's `compute_kpis` in the reporting currency, a row in another one left
 * out and its series named (NFR2). The review queue holds the suggestions
 * of every payable occurrence, open or paid this month, later ones
 * included though « Après ce mois-ci » shows one per series, as Sure's
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

// Sure's `upcoming_window_days` of `transactions/_upcoming`.
const UPCOMING_DAYS = 10;

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export const displayName = (row: {
	name: string | null;
	merchantName: string | null;
	label: string;
}) => row.name ?? row.merchantName ?? row.label;

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
