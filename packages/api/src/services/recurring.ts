import type { IsoDate } from "../domain/dates.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../domain/cash-flow.ts";
import { addMonths, today } from "../domain/dates.ts";
import {
	MANUAL_LOOKBACK_MONTHS,
	currentNextDate,
	detectRecurring as detectPatterns,
	isKept,
	isStale,
	nextDateFrom,
	refreshSeries,
	rekey,
	seriesKeyOf,
} from "../domain/recurring.ts";
import { AppError } from "../lib/errors.ts";
import { findTransaction, ruleCandidates } from "./ledger.ts";

export type DetectionResult = { detected: number };

/** A stored pattern as the page lists it, with its account's and merchant's names. */
export type RecurringRecord = {
	id: string;
	accountId: string;
	accountName: string;
	merchantId: string | null;
	merchantName: string | null;
	label: string;
	amount: MinorUnits;
	currency: string;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
	status: RecurringStatus;
	manual: boolean;
};

type PatternKey = {
	accountId: string;
	merchantId: string | null;
	labelKey: string | null;
	amount: number;
};

// The check keeps exactly one of merchant and label key set, so the two never
// collide in one key.
const keyOf = (row: PatternKey) =>
	JSON.stringify([row.accountId, row.merchantId, row.labelKey, row.amount]);

// Thirteen columns a row: 500 rows bind 6 500 parameters, below SQLite's cap.
const ROWS_PER_INSERT = 500;
const IDS_PER_UPDATE = 500;

const notFound = (what: string) => new AppError("NOT_FOUND", `No ${what} has this id.`);

const invalid = (path: string) =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code: "invalid_value" }]);

/** The statuses each target can be reached from by the user. */
const ALLOWED_FROM: Record<RecurringStatus, readonly RecurringStatus[]> = {
	detected: [],
	confirmed: ["detected", "inactive"],
	inactive: ["confirmed"],
	dismissed: ["detected", "confirmed", "inactive"],
};

/** Runs `step` on each item strictly in sequence, inside the caller's transaction. */
async function oneByOne<Item>(
	items: readonly Item[],
	step: (item: Item) => Promise<unknown>,
): Promise<void> {
	await items.reduce<Promise<unknown>>(
		(pending, item) => pending.then(() => step(item)),
		Promise.resolve(),
	);
}

function chunks<Item>(items: readonly Item[], size: number): Item[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	);
}

/**
 * Sure's `RecurringTransaction::Identifier` run over the last three months,
 * between two passes. First, a stored row whose latest transaction no longer
 * carries its key follows it (`rekey`), so renaming a series' rows or setting
 * their merchant never leaves a twin. Then a detected pattern updates its
 * stored row, keeping its status, or creates one; a dismissed row blocks its
 * key: it is neither updated nor recreated. Then every other row but the
 * dismissed ones is recomputed from its current transactions
 * (`refreshSeries`), as Sure's manual pass, so a revert or a delete never
 * leaves counts and dates built on rows that are gone. A confirmed or manual
 * row never keeps a past next date. Last, every `detected` row with no
 * occurrence for two months becomes `inactive`; a confirmed row changes only
 * by the user's hand, and detection never brings an inactive row back, as in
 * Sure. Reads and writes in one write transaction, so two detections racing
 * each other cannot insert the same pattern twice.
 */
export async function detectRecurring(deps: ServiceDeps): Promise<DetectionResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const candidates = await ruleCandidates(tx, addMonths(day, -MANUAL_LOOKBACK_MONTHS));
			const loaded = await tx
				.select({
					id: recurringTransactions.id,
					accountId: recurringTransactions.accountId,
					merchantId: recurringTransactions.merchantId,
					labelKey: recurringTransactions.labelKey,
					label: recurringTransactions.label,
					amount: recurringTransactions.amount,
					currency: recurringTransactions.currency,
					status: recurringTransactions.status,
					manual: recurringTransactions.manual,
					expectedDayOfMonth: recurringTransactions.expectedDayOfMonth,
					lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
					nextExpectedDate: recurringTransactions.nextExpectedDate,
					occurrenceCount: recurringTransactions.occurrenceCount,
				})
				.from(recurringTransactions);
			const now = Date.now();
			const rekeyed = rekey(
				loaded.map((row) => ({ ...row, amount: toMinorUnits(row.amount) })),
				candidates,
				day,
			);

			// In order: a move may take a key a delete just freed.
			await oneByOne(rekeyed.steps, (step) =>
				step.kind === "delete"
					? tx.delete(recurringTransactions).where(eq(recurringTransactions.id, step.id))
					: tx
							.update(recurringTransactions)
							.set({
								merchantId: step.merchantId,
								labelKey: step.labelKey,
								label: step.label,
								updatedAt: now,
							})
							.where(eq(recurringTransactions.id, step.id)),
			);

			const stored = rekeyed.stored;
			const storedOf = new Map(stored.map((row) => [keyOf(row), row]));
			const patterns = detectPatterns(candidates, day).filter(
				(pattern) => storedOf.get(keyOf(pattern))?.status !== "dismissed",
			);
			const updates = patterns.flatMap((pattern) => {
				const row = storedOf.get(keyOf(pattern));

				return row === undefined ? [] : [{ row, pattern }];
			});
			const inserts = patterns
				.filter((pattern) => !storedOf.has(keyOf(pattern)))
				.map((pattern) => ({
					...pattern,
					id: crypto.randomUUID(),
					createdAt: now,
					updatedAt: now,
				}));

			await oneByOne(updates, ({ row, pattern }) =>
				tx
					.update(recurringTransactions)
					.set({
						label: pattern.label,
						expectedDayOfMonth: pattern.expectedDayOfMonth,
						lastOccurrenceDate: pattern.lastOccurrenceDate,
						nextExpectedDate: isKept(row)
							? currentNextDate(pattern.nextExpectedDate, pattern.expectedDayOfMonth, day)
							: pattern.nextExpectedDate,
						occurrenceCount: pattern.occurrenceCount,
						updatedAt: now,
					})
					.where(eq(recurringTransactions.id, row.id)),
			);
			await oneByOne(chunks(inserts, ROWS_PER_INSERT), (chunk) =>
				tx.insert(recurringTransactions).values(chunk),
			);

			const updated = new Set(updates.map(({ row }) => row.id));
			const refreshes = stored
				.filter((row) => row.status !== "dismissed" && !updated.has(row.id))
				.map((row) => ({ row, refresh: refreshSeries(row, candidates, day) }));

			await oneByOne(refreshes, ({ row, refresh }) => {
				if (refresh.kind === "delete") {
					return tx.delete(recurringTransactions).where(eq(recurringTransactions.id, row.id));
				}

				return tx
					.update(recurringTransactions)
					.set({
						label: refresh.label,
						lastOccurrenceDate: refresh.lastOccurrenceDate,
						nextExpectedDate: refresh.nextExpectedDate,
						occurrenceCount: refresh.occurrenceCount,
						updatedAt: now,
					})
					.where(eq(recurringTransactions.id, row.id));
			});

			const lastDateOf = new Map<string, IsoDate>([
				...updates.map(({ row, pattern }) => [row.id, pattern.lastOccurrenceDate] as const),
				...refreshes.flatMap(({ row, refresh }) =>
					refresh.kind === "delete" ? [] : [[row.id, refresh.lastOccurrenceDate] as const],
				),
			]);
			const deleted = new Set(
				refreshes.flatMap(({ row, refresh }) => (refresh.kind === "delete" ? [row.id] : [])),
			);
			// A new row is at most 45 days old, so only a stored one can be stale.
			const stale = stored
				.filter(
					(row) =>
						row.status === "detected" &&
						!deleted.has(row.id) &&
						isStale(lastDateOf.get(row.id) ?? row.lastOccurrenceDate, day),
				)
				.map((row) => row.id);

			await oneByOne(chunks(stale, IDS_PER_UPDATE), (ids) =>
				tx
					.update(recurringTransactions)
					.set({ status: "inactive", updatedAt: now })
					.where(inArray(recurringTransactions.id, ids)),
			);

			return { detected: patterns.length };
		},
		{ behavior: "immediate" },
	);
}

const recordColumns = {
	id: recurringTransactions.id,
	accountId: recurringTransactions.accountId,
	accountName: accounts.name,
	merchantId: recurringTransactions.merchantId,
	merchantName: merchants.name,
	label: recurringTransactions.label,
	amount: recurringTransactions.amount,
	currency: recurringTransactions.currency,
	expectedDayOfMonth: recurringTransactions.expectedDayOfMonth,
	lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
	nextExpectedDate: recurringTransactions.nextExpectedDate,
	occurrenceCount: recurringTransactions.occurrenceCount,
	status: recurringTransactions.status,
	manual: recurringTransactions.manual,
};

function selectRecords(db: Pick<ServiceDeps["db"], "select">) {
	return db
		.select(recordColumns)
		.from(recurringTransactions)
		.innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
		.leftJoin(merchants, eq(merchants.id, recurringTransactions.merchantId));
}

function toRecord(row: Omit<RecurringRecord, "amount"> & { amount: number }): RecurringRecord {
	return { ...row, amount: toMinorUnits(row.amount) };
}

async function getRecord(db: Pick<ServiceDeps["db"], "select">, id: string) {
	const row = await selectRecords(db).where(eq(recurringTransactions.id, id)).get();

	if (row === undefined) {
		throw notFound("recurring transaction");
	}

	return toRecord(row);
}

/**
 * Every pattern but the dismissed ones, current before inactive, each by next
 * expected date as Sure orders them. The whole set, not a page: a household
 * has a few dozen at most.
 */
export async function listRecurring(deps: ServiceDeps): Promise<RecurringRecord[]> {
	const rows = await selectRecords(deps.db)
		.where(ne(recurringTransactions.status, "dismissed"))
		.orderBy(
			sql`case when ${recurringTransactions.status} = 'inactive' then 1 else 0 end`,
			asc(recurringTransactions.nextExpectedDate),
			asc(recurringTransactions.id),
		);

	return rows.map(toRecord);
}

/**
 * Confirms, deactivates or dismisses a pattern; any other move is refused. A
 * confirmed pattern's past next date moves to its expected day from today on.
 */
export async function setRecurringStatus(
	deps: ServiceDeps,
	id: string,
	status: RecurringStatus,
): Promise<RecurringRecord> {
	return deps.db.transaction(
		async (tx) => {
			const current = await getRecord(tx, id);

			if (!ALLOWED_FROM[status].includes(current.status)) {
				throw invalid("status");
			}

			const nextExpectedDate =
				status === "confirmed"
					? currentNextDate(
							current.nextExpectedDate,
							current.expectedDayOfMonth,
							today(deps.timeZone),
						)
					: current.nextExpectedDate;

			await tx
				.update(recurringTransactions)
				.set({ status, nextExpectedDate, updatedAt: Date.now() })
				.where(eq(recurringTransactions.id, id));

			return { ...current, status, nextExpectedDate };
		},
		{ behavior: "immediate" },
	);
}

/**
 * The stored rows of a transaction's account and key, whatever their amount,
 * the one of the transaction's amount first, then the latest last date. Read
 * by `addRecurringFromEntry` and `recurringOfEntry`, so the sheet names the
 * series the button would confirm.
 */
async function seriesOfTransaction(
	db: Pick<ServiceDeps["db"], "select">,
	transaction: { accountId: string; merchantId: string | null; label: string; amount: number },
) {
	const key = seriesKeyOf(transaction);

	return db
		.select({ id: recurringTransactions.id, status: recurringTransactions.status })
		.from(recurringTransactions)
		.where(
			and(
				eq(recurringTransactions.accountId, transaction.accountId),
				key.merchantId === null
					? isNull(recurringTransactions.merchantId)
					: eq(recurringTransactions.merchantId, key.merchantId),
				key.labelKey === null
					? isNull(recurringTransactions.labelKey)
					: eq(recurringTransactions.labelKey, key.labelKey),
			),
		)
		.orderBy(
			sql`case when ${recurringTransactions.amount} = ${transaction.amount} then 0 else 1 end`,
			desc(recurringTransactions.lastOccurrenceDate),
			asc(recurringTransactions.id),
		);
}

async function transactionOf(deps: ServiceDeps, entryId: string) {
	const transaction = await findTransaction(deps, entryId);

	if (transaction === null) {
		throw notFound("transaction");
	}

	return transaction;
}

/**
 * The series a transaction belongs to, for the sheet: the non-dismissed row
 * of its account and key, the one of its amount first, else the latest.
 * `null` when there is none.
 */
export async function recurringOfEntry(
	deps: ServiceDeps,
	entryId: string,
): Promise<RecurringRecord | null> {
	const transaction = await transactionOf(deps, entryId);
	const found = (await seriesOfTransaction(deps.db, transaction)).find(
		(row) => row.status !== "dismissed",
	);

	return found === undefined ? null : getRecord(deps.db, found.id);
}

/**
 * Sure's « add as recurring » from one transaction: a confirmed, manual
 * pattern on the transaction's day, next due on that day from today on. A
 * pattern already stored under the account and key is confirmed instead,
 * whatever its amount or status, a dismissed one included since the user now
 * asks for it: the one of the same amount, else the latest. It never inserts
 * a second row for the account and key.
 */
export async function addRecurringFromEntry(
	deps: ServiceDeps,
	entryId: string,
): Promise<RecurringRecord> {
	const transaction = await transactionOf(deps, entryId);

	// A loan payment's or investment contribution's outflow is spent, and detection groups it.
	if (direction(transaction) === "transfer") {
		throw invalid("entryId");
	}

	const day = Number(transaction.date.slice(8, 10));
	const date = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const now = Date.now();
			const [existing] = await seriesOfTransaction(tx, transaction);

			if (existing !== undefined) {
				const current = await getRecord(tx, existing.id);

				await tx
					.update(recurringTransactions)
					.set({
						status: "confirmed",
						nextExpectedDate: currentNextDate(
							current.nextExpectedDate,
							current.expectedDayOfMonth,
							date,
						),
						updatedAt: now,
					})
					.where(eq(recurringTransactions.id, existing.id));

				return getRecord(tx, existing.id);
			}

			const id = crypto.randomUUID();

			await tx.insert(recurringTransactions).values({
				...seriesKeyOf(transaction),
				id,
				accountId: transaction.accountId,
				amount: transaction.amount,
				label: transaction.label,
				currency: transaction.currency,
				expectedDayOfMonth: day,
				lastOccurrenceDate: transaction.date,
				nextExpectedDate: nextDateFrom(date, day),
				occurrenceCount: 1,
				status: "confirmed",
				manual: true,
				createdAt: now,
				updatedAt: now,
			});

			return getRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}
