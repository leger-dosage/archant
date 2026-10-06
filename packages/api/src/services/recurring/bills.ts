import type { IsoDate } from "../../domain/dates.ts";
import type { SeriesKey } from "../../domain/recurring/identifier.ts";
import type { BillKind, DeclareInput, EditInput } from "../../schemas/bills.ts";
import type { RecurringPatch } from "../../schemas/recurring.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { RecurringRecord } from "./series.ts";

import { and, eq, isNull, ne } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../../domain/cash-flow.ts";
import { addDays, maxDate, today, weekdayOf } from "../../domain/dates.ts";
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
import { monthlyOn } from "../../domain/recurring/schedule.ts";
import { isKept, nextDateFrom, nextExpectedDate } from "../../domain/recurring/series.ts";
import { AppError } from "../../lib/errors.ts";
import { validationError } from "../../lib/zod-error.ts";
import { declareBillSchema, editBillSchema } from "../../schemas/bills.ts";
import { findTransaction } from "../ledger/queries.ts";
import { pinAmountsAlreadyDue, regenerateFuture } from "./occurrences.ts";
import { insertRules, replaceRules } from "./rules.ts";
import {
	getRecord,
	invalid,
	loadCandidates,
	merchantNames,
	notFound,
	setRecurringStatus,
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
 * and positive for an income (AD-5), its rules those of the frequency picked
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

	return deps.db.transaction(
		async (tx) => {
			if (await taken(tx, row)) {
				throw alreadyExists();
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
				billType: bill.kind === "income" ? "income" : "bill",
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

			if (
				edit.categoryId !== undefined &&
				edit.categoryId !== null &&
				(await tx
					.select({ id: categories.id })
					.from(categories)
					.where(eq(categories.id, edit.categoryId))
					.get()) === undefined
			) {
				throw invalid("categoryId");
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
				change !== null ||
				endAfterCount !== current.endAfterCount ||
				anchorDate !== current.anchorDate;
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

			return getRecord(tx, id, day);
		},
		{ behavior: "immediate" },
	);
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

/**
 * The declare dialog's starting points, eight at most, on active accounts
 * only, the ones it offers. For a bill, Sure's
 * `candidate_patterns`; for an income, Sure's `income_source_candidates`:
 * deposits of the last 90 days grouped by account, key and currency, two or
 * more whose mean is one major unit at least, that no income series of that
 * account, key and currency follows, the largest total first.
 */
export async function billCandidates(deps: ServiceDeps, kind: BillKind): Promise<BillCandidate[]> {
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
			.slice(0, MAX_CANDIDATES)
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
		.slice(0, MAX_CANDIDATES)
		.map(({ total: _total, ...candidate }) => candidate);
}
