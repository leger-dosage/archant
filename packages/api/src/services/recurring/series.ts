import type { IsoDate } from "../../domain/dates.ts";
import type { RecurringCandidate } from "../../domain/recurring/identifier.ts";
import type { StoredSeries } from "../../domain/recurring/series.ts";
import type { RecurringView } from "../../schemas/recurring.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";

import { and, asc, between, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../../domain/cash-flow.ts";
import { addDays, addMonths, today } from "../../domain/dates.ts";
import {
	claimOf,
	detectRecurring as detectPatterns,
	seriesKeyOf,
} from "../../domain/recurring/identifier.ts";
import {
	MANUAL_LOOKBACK_MONTHS,
	cleanerSteps,
	currentNextDate,
	isKept,
	nextDateFrom,
	nextExpectedDate,
	refreshSeries,
	rekey,
} from "../../domain/recurring/series.ts";
import { AppError } from "../../lib/errors.ts";
import { findTransaction } from "../ledger/queries.ts";
import { ruleCandidates } from "../ledger/rule-plans.ts";

export type DetectionResult = { detected: number };

export type CleanupResult = { inactive: number };

/** A stored pattern as the page lists it, with its account's and merchant's names. */
export type RecurringRecord = {
	id: string;
	accountId: string;
	accountName: string;
	accountType: AccountType;
	merchantId: string | null;
	merchantName: string | null;
	label: string;
	amount: MinorUnits;
	/** Signed like `amount`: for an expense the minimum is the largest magnitude. */
	expectedAmountMin: MinorUnits | null;
	expectedAmountMax: MinorUnits | null;
	currency: string;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
	status: RecurringStatus;
	manual: boolean;
};

// Nineteen columns a row: 500 rows bind 9 500 parameters, below SQLite's cap
// of 32 766.
const ROWS_PER_INSERT = 500;
const IDS_PER_UPDATE = 500;

const notFound = (what: string) => new AppError("NOT_FOUND", `No ${what} has this id.`);

const invalid = (path: string) =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code: "invalid_value" }]);

/**
 * The statuses each target can be reached from by the user. Nothing returns a
 * series to `suggested`: only detection writes it.
 */
const ALLOWED_FROM: Record<RecurringStatus, readonly RecurringStatus[]> = {
	suggested: [],
	active: ["suggested", "inactive", "ended"],
	inactive: ["active"],
	ended: ["suggested"],
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

const nullableMinor = (amount: number | null) => (amount === null ? null : toMinorUnits(amount));

/** Every stored series, as the passes around detection read them. */
async function loadSeries(tx: Pick<Transaction, "select">): Promise<StoredSeries[]> {
	const rows = await tx
		.select({
			id: recurringTransactions.id,
			accountId: recurringTransactions.accountId,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			label: recurringTransactions.label,
			amount: recurringTransactions.amount,
			expectedAmountMin: recurringTransactions.expectedAmountMin,
			expectedAmountMax: recurringTransactions.expectedAmountMax,
			expectedAmountAvg: recurringTransactions.expectedAmountAvg,
			currency: recurringTransactions.currency,
			status: recurringTransactions.status,
			manual: recurringTransactions.manual,
			dedupScope: recurringTransactions.dedupScope,
			expectedDayOfMonth: recurringTransactions.expectedDayOfMonth,
			lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
			nextExpectedDate: recurringTransactions.nextExpectedDate,
			occurrenceCount: recurringTransactions.occurrenceCount,
		})
		.from(recurringTransactions)
		.orderBy(asc(recurringTransactions.createdAt), asc(recurringTransactions.id));

	return rows.map((row) => ({
		...row,
		amount: toMinorUnits(row.amount),
		expectedAmountMin: nullableMinor(row.expectedAmountMin),
		expectedAmountMax: nullableMinor(row.expectedAmountMax),
		expectedAmountAvg: nullableMinor(row.expectedAmountAvg),
	}));
}

/**
 * Six months of transactions, split parents left out for their children, every
 * account read as Sure's identifier does. `detectable` also leaves out the
 * investment accounts, whose dividends and contributions recur without being
 * bills, as Sure's `NON_BILLABLE_ACCOUNTABLE_TYPES`.
 */
async function loadCandidates(
	tx: Pick<Transaction, "select">,
	day: IsoDate,
): Promise<{ candidates: RecurringCandidate[]; detectable: RecurringCandidate[] }> {
	const candidates = await ruleCandidates(tx, addMonths(day, -MANUAL_LOOKBACK_MONTHS), {
		activeAccountsOnly: false,
	});
	const investments = new Set(
		(
			await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, "investment"))
		).map((row) => row.id),
	);

	return {
		candidates,
		detectable: candidates.filter((candidate) => !investments.has(candidate.accountId)),
	};
}

/**
 * Applies Sure's `Cleaner` to `stored`: stale active series become inactive,
 * suggestions with no transaction left go. Returns how many became inactive.
 */
async function clean(
	tx: Transaction,
	stored: readonly StoredSeries[],
	candidates: readonly RecurringCandidate[],
	day: IsoDate,
	now: number,
): Promise<number> {
	const steps = cleanerSteps(stored, candidates, day);

	await oneByOne(chunks(steps.inactive, IDS_PER_UPDATE), (ids) =>
		tx
			.update(recurringTransactions)
			.set({ status: "inactive", updatedAt: now })
			.where(inArray(recurringTransactions.id, ids)),
	);
	await oneByOne(chunks(steps.deleted, IDS_PER_UPDATE), (ids) =>
		tx.delete(recurringTransactions).where(inArray(recurringTransactions.id, ids)),
	);

	return steps.inactive.length;
}

/**
 * Sure's `RecurringTransaction::Identifier` at `14638a701` run over the last
 * three months, between two passes. First, a stored row whose latest
 * transaction no longer carries its key follows it (`rekey`), so renaming a
 * series' rows or setting their merchant never leaves a twin. Then each
 * pattern claims the stored series of its account, key and currency nearest
 * its mean within 7.5 %, whatever its status: an ended or manual one is left
 * untouched, so detection never recreates a bill the owner declared or
 * dismissed; any other takes the pattern's dates, count, day and band, never
 * its amount or status. An unclaimed pattern lands as `suggested`, with the
 * cluster's mean as `dedup_scope` when its key already has a series. Then
 * every other series but the ended ones is recomputed from its current
 * transactions (`refreshSeries`), Sure's manual pass among them, so a revert
 * or a delete never leaves counts and dates built on rows that are gone. Last,
 * Sure's `Cleaner` runs. Reads and writes in one write transaction, so two
 * detections racing each other cannot insert the same pattern twice.
 */
export async function detectRecurring(deps: ServiceDeps): Promise<DetectionResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const { candidates, detectable } = await loadCandidates(tx, day);
			const now = Date.now();
			const rekeyed = rekey(await loadSeries(tx), candidates, day);

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

			const patterns = detectPatterns(detectable, day);
			// What the series stand as after each write, read by the passes that follow.
			const current = new Map(rekeyed.stored.map((series) => [series.id, series]));
			const claimed = new Set<string>();
			let tombstoned = 0;
			const created = new Set<string>();

			for (const pattern of patterns) {
				const series = claimOf(pattern, [...current.values()]);
				const band = {
					expectedAmountMin: pattern.expectedAmountMin,
					expectedAmountMax: pattern.expectedAmountMax,
					expectedAmountAvg: pattern.expectedAmountAvg,
				};
				const next = nextExpectedDate(pattern.lastOccurrenceDate, pattern.expectedDayOfMonth);

				if (series !== undefined) {
					// The owner settled these: an ended one is a tombstone, a manual one
					// follows its own pass.
					if (series.status === "ended") {
						tombstoned += 1;
						continue;
					}

					if (series.manual) {
						continue;
					}

					claimed.add(series.id);
					current.set(series.id, {
						...series,
						...band,
						label: pattern.label,
						expectedDayOfMonth: pattern.expectedDayOfMonth,
						lastOccurrenceDate: pattern.lastOccurrenceDate,
						nextExpectedDate: isKept(series)
							? currentNextDate(next, pattern.expectedDayOfMonth, day)
							: next,
						occurrenceCount: pattern.occurrenceCount,
					});
					continue;
				}

				const sharesKey = [...current.values()].some(
					(other) =>
						other.accountId === pattern.accountId &&
						other.currency === pattern.currency &&
						other.merchantId === pattern.merchantId &&
						other.labelKey === pattern.labelKey,
				);
				const fresh: StoredSeries = {
					...band,
					id: crypto.randomUUID(),
					accountId: pattern.accountId,
					merchantId: pattern.merchantId,
					labelKey: pattern.labelKey,
					label: pattern.label,
					amount: pattern.amount,
					currency: pattern.currency,
					status: "suggested",
					manual: false,
					// A second tier of one key, as Sure's `identity_conditions`.
					dedupScope: sharesKey ? String(pattern.expectedAmountAvg) : "",
					expectedDayOfMonth: pattern.expectedDayOfMonth,
					lastOccurrenceDate: pattern.lastOccurrenceDate,
					nextExpectedDate: next,
					occurrenceCount: pattern.occurrenceCount,
				};

				current.set(fresh.id, fresh);
				claimed.add(fresh.id);
				created.add(fresh.id);
			}

			// From where the run left them: a later pattern may claim a series an
			// earlier one created, as Sure's `update_claimed_series` after `create!`.
			const inserts = [...created].map((id) => ({
				...current.get(id)!,
				createdAt: now,
				updatedAt: now,
			}));

			await oneByOne(
				[...claimed].filter((id) => !created.has(id)),
				(id) => {
					const series = current.get(id)!;

					return tx
						.update(recurringTransactions)
						.set({
							label: series.label,
							expectedAmountMin: series.expectedAmountMin,
							expectedAmountMax: series.expectedAmountMax,
							expectedAmountAvg: series.expectedAmountAvg,
							expectedDayOfMonth: series.expectedDayOfMonth,
							lastOccurrenceDate: series.lastOccurrenceDate,
							nextExpectedDate: series.nextExpectedDate,
							occurrenceCount: series.occurrenceCount,
							updatedAt: now,
						})
						.where(eq(recurringTransactions.id, id));
				},
			);
			await oneByOne(chunks(inserts, ROWS_PER_INSERT), (chunk) =>
				tx.insert(recurringTransactions).values(chunk),
			);

			const refreshes = [...current.values()]
				.filter((series) => series.status !== "ended" && !claimed.has(series.id))
				.map((series) => ({ series, refresh: refreshSeries(series, candidates, day) }));

			await oneByOne(refreshes, ({ series, refresh }) => {
				if (refresh.kind === "delete") {
					current.delete(series.id);

					return tx.delete(recurringTransactions).where(eq(recurringTransactions.id, series.id));
				}

				const { band, ...dates } = refresh;
				const updated = { ...series, ...dates, ...band };

				current.set(series.id, updated);

				return tx
					.update(recurringTransactions)
					.set({ ...dates, ...band, updatedAt: now })
					.where(eq(recurringTransactions.id, series.id));
			});

			await clean(tx, [...current.values()], candidates, day, now);

			// A pattern an ended series claims is not offered again, so it is not counted.
			return { detected: patterns.length - tombstoned };
		},
		{ behavior: "immediate" },
	);
}

/**
 * « Nettoyer les obsolètes »: Sure's `Cleaner` alone, outside a detection.
 * Returns how many active series became inactive.
 */
export async function cleanupRecurring(deps: ServiceDeps): Promise<CleanupResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const { candidates } = await loadCandidates(tx, day);

			return { inactive: await clean(tx, await loadSeries(tx), candidates, day, Date.now()) };
		},
		{ behavior: "immediate" },
	);
}

const recordColumns = {
	id: recurringTransactions.id,
	accountId: recurringTransactions.accountId,
	accountName: accounts.name,
	accountType: accounts.type,
	merchantId: recurringTransactions.merchantId,
	merchantName: merchants.name,
	label: recurringTransactions.label,
	amount: recurringTransactions.amount,
	expectedAmountMin: recurringTransactions.expectedAmountMin,
	expectedAmountMax: recurringTransactions.expectedAmountMax,
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

/** A row as SQLite returns it: its amounts are plain integers until `toMinorUnits`. */
function toRecord(
	row: Omit<RecurringRecord, "amount" | "expectedAmountMin" | "expectedAmountMax"> & {
		amount: number;
		expectedAmountMin: number | null;
		expectedAmountMax: number | null;
	},
): RecurringRecord {
	return {
		...row,
		amount: toMinorUnits(row.amount),
		expectedAmountMin: nullableMinor(row.expectedAmountMin),
		expectedAmountMax: nullableMinor(row.expectedAmountMax),
	};
}

async function getRecord(db: Pick<ServiceDeps["db"], "select">, id: string) {
	const row = await selectRecords(db).where(eq(recurringTransactions.id, id)).get();

	if (row === undefined) {
		throw notFound("recurring transaction");
	}

	return toRecord(row);
}

type RecurringFilter = {
	status: RecurringView;
	/** Keeps the series expected from today to today plus this many days, overdue ones out. */
	withinDays?: number | undefined;
};

const VIEW_STATUSES: Record<RecurringView, readonly RecurringStatus[]> = {
	current: ["suggested", "active"],
	inactive: ["inactive"],
	all: ["suggested", "active", "inactive"],
};

/**
 * Every pattern but the ended ones, current before inactive, each by next
 * expected date as Sure orders them. The whole set, not a page: a household
 * has a few dozen at most. `filter` narrows it by status and, as Sure's
 * `upcoming_within_days`, by next date; the page passes none.
 */
export async function listRecurring(
	deps: ServiceDeps,
	filter?: RecurringFilter,
): Promise<RecurringRecord[]> {
	const from = today(deps.timeZone);
	const window =
		filter?.withinDays === undefined
			? undefined
			: between(recurringTransactions.nextExpectedDate, from, addDays(from, filter.withinDays));
	const rows = await selectRecords(deps.db)
		.where(
			and(
				ne(recurringTransactions.status, "ended"),
				filter === undefined
					? undefined
					: inArray(recurringTransactions.status, [...VIEW_STATUSES[filter.status]]),
				window,
			),
		)
		.orderBy(
			sql`case when ${recurringTransactions.status} = 'inactive' then 1 else 0 end`,
			asc(recurringTransactions.nextExpectedDate),
			asc(recurringTransactions.id),
		);

	return rows.map(toRecord);
}

/**
 * Sure's moves: a suggestion is added or dismissed, an active series paused,
 * an inactive or ended one resumed; any other move is refused. An activated
 * series' past next date moves to its expected day from today on.
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

			const nextDate =
				status === "active"
					? currentNextDate(
							current.nextExpectedDate,
							current.expectedDayOfMonth,
							today(deps.timeZone),
						)
					: current.nextExpectedDate;

			await tx
				.update(recurringTransactions)
				.set({ status, nextExpectedDate: nextDate, updatedAt: Date.now() })
				.where(eq(recurringTransactions.id, id));

			return { ...current, status, nextExpectedDate: nextDate };
		},
		{ behavior: "immediate" },
	);
}

/**
 * « Supprimer »: a manual series is deleted, a detected one ended, so the
 * next detection claims it rather than suggest it again.
 */
export async function deleteRecurring(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			const current = await getRecord(tx, id);

			await (current.manual
				? tx.delete(recurringTransactions).where(eq(recurringTransactions.id, id))
				: tx
						.update(recurringTransactions)
						.set({ status: "ended", updatedAt: Date.now() })
						.where(eq(recurringTransactions.id, id)));

			return { id };
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
	transaction: { accountId: string; merchantId: string | null; label: string; amount: MinorUnits },
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

/**
 * The ids of `rows` a series not ended holds, by `recurringOfEntry`'s
 * rule: the series of the row's account and key, whatever its amount. One
 * query for a whole page, never one per row.
 */
export async function recurringEntryIds(
	db: Pick<ServiceDeps["db"], "select">,
	rows: readonly { id: string; accountId: string; merchantId: string | null; label: string }[],
): Promise<Set<string>> {
	if (rows.length === 0) {
		return new Set();
	}

	// A page holds at most a few hundred rows, so its accounts stay well below
	// SQLite's bound-parameter cap.
	const series = await db
		.select({
			accountId: recurringTransactions.accountId,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
		})
		.from(recurringTransactions)
		.where(
			and(
				inArray(recurringTransactions.accountId, [...new Set(rows.map((row) => row.accountId))]),
				ne(recurringTransactions.status, "ended"),
			),
		);
	const held = new Set(
		series.map((row) => JSON.stringify([row.accountId, row.merchantId, row.labelKey])),
	);

	return new Set(
		rows
			.filter((row) => {
				const key = seriesKeyOf(row);

				return held.has(JSON.stringify([row.accountId, key.merchantId, key.labelKey]));
			})
			.map((row) => row.id),
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
 * The series a transaction belongs to, for the sheet: the row not ended
 * of its account and key, the one of its amount first, else the latest.
 * `null` when there is none.
 */
export async function recurringOfEntry(
	deps: ServiceDeps,
	entryId: string,
): Promise<RecurringRecord | null> {
	const transaction = await transactionOf(deps, entryId);
	const found = (await seriesOfTransaction(deps.db, transaction)).find(
		(row) => row.status !== "ended",
	);

	return found === undefined ? null : getRecord(deps.db, found.id);
}

/**
 * Sure's « add as recurring » from one transaction: an active, manual
 * pattern on the transaction's day, next due on that day from today on, its
 * band the transaction's amount until the manual pass reads more. A pattern
 * already stored under the account and key is activated instead, whatever
 * its amount or status, an ended one included since the user now asks for
 * it: the one of the same amount, else the latest. It never inserts a second
 * row for the account and key.
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
						status: "active",
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
				expectedAmountMin: transaction.amount,
				expectedAmountMax: transaction.amount,
				expectedAmountAvg: transaction.amount,
				label: transaction.label,
				currency: transaction.currency,
				expectedDayOfMonth: day,
				lastOccurrenceDate: transaction.date,
				nextExpectedDate: nextDateFrom(date, day),
				occurrenceCount: 1,
				status: "active",
				manual: true,
				createdAt: now,
				updatedAt: now,
			});

			return getRecord(tx, id);
		},
		{ behavior: "immediate" },
	);
}
