import type { IsoDate } from "../../domain/dates.ts";
import type { SeriesKey } from "../../domain/recurring/identifier.ts";
import type { DeclareInput, EditInput } from "../../schemas/bills.ts";
import type { RecurringPatch } from "../../schemas/recurring.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { RecurringRecord } from "./series.ts";

import { and, eq, isNull, ne } from "drizzle-orm";

import { classificationOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { maxDate, today, weekdayOf } from "../../domain/dates.ts";
import { normalizeLabel } from "../../domain/normalize-label.ts";
import { applyFrequency } from "../../domain/recurring/frequency.ts";
import { monthlyOn } from "../../domain/recurring/schedule.ts";
import { isKept, nextDateFrom, nextExpectedDate } from "../../domain/recurring/series.ts";
import { AppError } from "../../lib/errors.ts";
import { validationError } from "../../lib/zod-error.ts";
import { declareBillSchema, editBillSchema } from "../../schemas/bills.ts";
import { transferPair } from "../ledger/recurring.ts";
import { getReportingCurrency } from "../settings.ts";
import { pinAmountsAlreadyDue, regenerateFuture } from "./occurrences.ts";
import { insertRules, replaceRules } from "./rules.ts";
import { getRecord, invalid, notFound, setRecurringStatus, setStatusWithin } from "./series.ts";
import { ensureRecurringEnabled } from "./switch.ts";

const alreadyExists = () =>
	new AppError("RECURRING_ALREADY_EXISTS", "A series with this account, key and amount exists.");

/**
 * The currency of a series without an account, as Sure's: the reporting one
 * when declared, the series' own once it exists, so moving a bill to any
 * account never converts it.
 */
function currencyWithoutAccount(currency: string): CurrencyCode {
	if (!isCurrencyCode(currency)) {
		throw invalid("accountId");
	}

	return currency;
}

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
 * Whether another series holds what the unique indexes key on: account, key
 * or destination, amount, currency and dedup scope. Checked inside the write
 * transaction, so the answer is a `409`, never a constraint failure. A series
 * without an account is held by another without one, as Sure's
 * `account_less_duplicate?`, which the indexes cannot see since SQLite keeps
 * NULLs distinct.
 */
export async function taken(
	tx: Pick<Transaction, "select">,
	row: SeriesKey & {
		accountId: string | null;
		destinationAccountId: string | null;
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
				row.accountId === null
					? isNull(recurringTransactions.accountId)
					: eq(recurringTransactions.accountId, row.accountId),
				row.destinationAccountId === null
					? isNull(recurringTransactions.destinationAccountId)
					: eq(recurringTransactions.destinationAccountId, row.destinationAccountId),
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
 * on that date's day, weekday and month. Its key is its normalised name and
 * never a merchant, even when the dialog started from a transaction, as
 * Sure's, whose create never reads that transaction. Its amount is its
 * `dedup_scope`, as Sure's: the same account, key and amount twice answers
 * `RECURRING_ALREADY_EXISTS`.
 */
export async function declareBill(
	deps: ServiceDeps,
	input: DeclareInput,
): Promise<RecurringRecord> {
	const currency =
		input.accountId === null
			? currencyWithoutAccount(getReportingCurrency())
			: await currencyOfAccount(deps.db, input.accountId);
	const parsed = declareBillSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const bill = parsed.data;
	const key: SeriesKey = { merchantId: null, labelKey: normalizeLabel(bill.name) };
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
		destinationAccountId: null,
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
				label: bill.name,
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

/**
 * Sure's `RecurringTransaction.create_from_transfer`, « Marquer comme
 * récurrent » on a transfer: an active manual recurring transfer from the
 * outflow's account into the inflow's, of the outflow's amount and currency
 * (AD-5), monthly on the outflow's day, last seen on its date and due next
 * from today on, named as Sure's `Transfer#name`. A series already on the
 * same account, destination, amount and currency, whatever its status,
 * answers `RECURRING_TRANSFER_ALREADY_EXISTS`, as Sure's controller, and
 * the switch off `RECURRING_DISABLED`, as its `transfer_feature_disabled`.
 */
export async function markTransferRecurring(
	deps: ServiceDeps,
	transferId: string,
): Promise<RecurringRecord> {
	await ensureRecurringEnabled(deps);
	const date = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const pair = await transferPair(tx, transferId);

			if (pair === null) {
				throw notFound("transfer");
			}

			const { outflow, destination } = pair;
			const existing = await tx
				.select({ id: recurringTransactions.id })
				.from(recurringTransactions)
				.where(
					and(
						eq(recurringTransactions.accountId, outflow.accountId),
						eq(recurringTransactions.destinationAccountId, destination.id),
						eq(recurringTransactions.amount, outflow.amount),
						eq(recurringTransactions.currency, outflow.currency),
					),
				)
				.get();

			if (existing !== undefined) {
				throw new AppError(
					"RECURRING_TRANSFER_ALREADY_EXISTS",
					"A recurring transfer already exists for this pair of accounts.",
				);
			}

			const id = crypto.randomUUID();
			const now = Date.now();
			const day = Number(outflow.date.slice(8, 10));
			const rules = [monthlyOn(day)];
			// Sure's `Transfer#name`: a payment into a liability, a transfer otherwise.
			const name =
				classificationOf(destination.type) === "liability"
					? `Remboursement vers ${destination.name}`
					: `Virement vers ${destination.name}`;

			await tx.insert(recurringTransactions).values({
				id,
				accountId: outflow.accountId,
				destinationAccountId: destination.id,
				merchantId: null,
				labelKey: null,
				label: outflow.label,
				name,
				amount: outflow.amount,
				currency: outflow.currency,
				expectedDayOfMonth: day,
				lastOccurrenceDate: outflow.date,
				// A plain monthly series always has a next date.
				nextExpectedDate:
					nextDateFrom(
						{
							rules,
							anchorDate: null,
							lastOccurrenceDate: outflow.date,
							endAfterCount: null,
							expectedDayOfMonth: day,
						},
						date,
					) ?? date,
				occurrenceCount: 1,
				status: "active",
				manual: true,
				billType: "transfer",
				createdAt: now,
				updatedAt: now,
			});
			await insertRules(tx, [{ id, rules }]);
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
 * its currency but never a recurring transfer's, type but never to or from
 * `income` or `transfer`, category, frequency,
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
	const target = input.accountId === undefined ? current.accountId : input.accountId;
	const currency =
		target === null
			? currencyWithoutAccount(current.currency)
			: await currencyOfAccount(tx, target);
	const parsed = editBillSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const edit = parsed.data;

	// An income stays one, and a recurring transfer's type follows its
	// destination, as Sure's `derive_transfer_bill_type`.
	if (
		edit.billType !== undefined &&
		(current.billType === "income" || current.billType === "transfer")
	) {
		throw invalid("billType");
	}

	// Sure's edit dialog moves neither end of a recurring transfer.
	if (
		current.destinationAccountId !== null &&
		edit.accountId !== undefined &&
		edit.accountId !== current.accountId
	) {
		throw invalid("accountId");
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
	const accountId = edit.accountId === undefined ? current.accountId : edit.accountId;
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

/** The key, destination and dedup scope a series is stored under, which an edit keeps. */
async function storedKeyOf(tx: Pick<Transaction, "select">, id: string) {
	const row = await tx
		.select({
			destinationAccountId: recurringTransactions.destinationAccountId,
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
