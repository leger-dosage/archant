import type { IsoDate } from "../domain/dates.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../domain/cash-flow.ts";
import { addMonths, today } from "../domain/dates.ts";
import { normalizeLabel } from "../domain/normalize-label.ts";
import {
	LOOKBACK_MONTHS,
	detectRecurring as detectPatterns,
	isStale,
	nextDateFrom,
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
 * Sure's `RecurringTransaction::Identifier` run over the last three months:
 * a detected pattern updates its stored row, keeping its status, or creates
 * one. A dismissed row blocks its key: it is neither updated nor recreated.
 * Then every `detected` row with no occurrence for two months becomes
 * `inactive`; a confirmed row changes only by the user's hand, and detection
 * never brings an inactive row back, as in Sure. Reads and writes in one
 * write transaction, so two detections racing each other cannot insert the
 * same pattern twice.
 */
export async function detectRecurring(deps: ServiceDeps): Promise<DetectionResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const candidates = await ruleCandidates(tx, addMonths(day, -LOOKBACK_MONTHS));
			const stored = await tx
				.select({
					id: recurringTransactions.id,
					accountId: recurringTransactions.accountId,
					merchantId: recurringTransactions.merchantId,
					labelKey: recurringTransactions.labelKey,
					amount: recurringTransactions.amount,
					status: recurringTransactions.status,
					lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
				})
				.from(recurringTransactions);
			const storedOf = new Map(stored.map((row) => [keyOf(row), row]));
			const patterns = detectPatterns(candidates, day).filter(
				(pattern) => storedOf.get(keyOf(pattern))?.status !== "dismissed",
			);
			const now = Date.now();
			const updates = patterns.flatMap((pattern) => {
				const row = storedOf.get(keyOf(pattern));

				return row === undefined ? [] : [{ id: row.id, pattern }];
			});
			const inserts = patterns
				.filter((pattern) => !storedOf.has(keyOf(pattern)))
				.map((pattern) => ({
					...pattern,
					id: crypto.randomUUID(),
					createdAt: now,
					updatedAt: now,
				}));

			await oneByOne(updates, ({ id, pattern }) =>
				tx
					.update(recurringTransactions)
					.set({
						label: pattern.label,
						expectedDayOfMonth: pattern.expectedDayOfMonth,
						lastOccurrenceDate: pattern.lastOccurrenceDate,
						nextExpectedDate: pattern.nextExpectedDate,
						occurrenceCount: pattern.occurrenceCount,
						updatedAt: now,
					})
					.where(eq(recurringTransactions.id, id)),
			);
			await oneByOne(chunks(inserts, ROWS_PER_INSERT), (chunk) =>
				tx.insert(recurringTransactions).values(chunk),
			);

			const lastDateOf = new Map(
				updates.map(({ id, pattern }) => [id, pattern.lastOccurrenceDate]),
			);
			// A new row is at most 45 days old, so only a stored one can be stale.
			const stale = stored
				.filter(
					(row) =>
						row.status === "detected" &&
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

/** Confirms, deactivates or dismisses a pattern; any other move is refused. */
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

			await tx
				.update(recurringTransactions)
				.set({ status, updatedAt: Date.now() })
				.where(eq(recurringTransactions.id, id));

			return { ...current, status };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's « add as recurring » from one transaction: a confirmed, manual
 * pattern on the transaction's day, next due on that day from today on. A
 * pattern already stored under the same key is confirmed instead, a dismissed
 * one included, since the user now asks for it.
 */
export async function addRecurringFromEntry(
	deps: ServiceDeps,
	entryId: string,
): Promise<RecurringRecord> {
	const transaction = await findTransaction(deps, entryId);

	if (transaction === null) {
		throw notFound("transaction");
	}

	// A loan payment's or investment contribution's outflow is spent, and detection groups it.
	if (direction(transaction) === "transfer") {
		throw invalid("entryId");
	}

	const key = {
		accountId: transaction.accountId,
		merchantId: transaction.merchantId,
		labelKey: transaction.merchantId === null ? normalizeLabel(transaction.label) : null,
		amount: transaction.amount,
	};
	const day = Number(transaction.date.slice(8, 10));

	return deps.db.transaction(
		async (tx) => {
			const now = Date.now();
			const existing = await tx
				.select({ id: recurringTransactions.id })
				.from(recurringTransactions)
				.where(
					and(
						eq(recurringTransactions.accountId, key.accountId),
						key.merchantId === null
							? isNull(recurringTransactions.merchantId)
							: eq(recurringTransactions.merchantId, key.merchantId),
						key.labelKey === null
							? isNull(recurringTransactions.labelKey)
							: eq(recurringTransactions.labelKey, key.labelKey),
						eq(recurringTransactions.amount, key.amount),
					),
				)
				.get();

			if (existing !== undefined) {
				await tx
					.update(recurringTransactions)
					.set({ status: "confirmed", updatedAt: now })
					.where(eq(recurringTransactions.id, existing.id));

				return getRecord(tx, existing.id);
			}

			const id = crypto.randomUUID();

			await tx.insert(recurringTransactions).values({
				...key,
				id,
				label: transaction.label,
				currency: transaction.currency,
				expectedDayOfMonth: day,
				lastOccurrenceDate: transaction.date,
				nextExpectedDate: nextDateFrom(today(deps.timeZone), day),
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
