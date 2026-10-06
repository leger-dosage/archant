import type { IsoDate } from "../../domain/dates.ts";
import type { DerivedState } from "../../domain/recurring/occurrences.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "../ledger/shared.ts";
import type { LoadedSeries } from "./rules.ts";

import { and, eq, inArray, isNotNull, isNull, lt, lte, gte, notExists, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { OccurrenceStatus } from "@archant/data/recurring";
import {
	recurringAllocations,
	recurringMatchRejections,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";
import { settings } from "@archant/data/schema/settings";

import { addMonths, daysBetween, maxDate, today } from "../../domain/dates.ts";
import { entryWindow, matchPayments, rejectionKey } from "../../domain/recurring/matcher.ts";
import {
	BACKFILL_MONTHS,
	derivedState,
	effectiveDueOn,
	horizonOf,
} from "../../domain/recurring/occurrences.ts";
import { cycleFor, occurrencesBetween } from "../../domain/recurring/schedule.ts";
import { matchableTransactions } from "../ledger/recurring.ts";
import { KEYS_PER_LOOKUP, inSequence, oneByOne } from "../ledger/shared.ts";
import { allocateMatched } from "./payments.ts";
import { seriesWithSchedules } from "./rules.ts";

type Writer = Pick<Transaction, "select" | "selectDistinct" | "insert" | "update" | "delete">;

// Seven columns an occurrence row: 500 rows bind 3 500 parameters.
const ROWS_PER_INSERT = 500;

/** Inserts the occurrences of `series` on `dates`, leaving any already there untouched. */
async function insertOccurrences(
	tx: Writer,
	series: LoadedSeries,
	dates: readonly IsoDate[],
	now: number,
): Promise<void> {
	const rows = dates.map((date) => ({
		id: crypto.randomUUID(),
		recurringTransactionId: series.id,
		originalDueOn: date,
		dueOn: date,
		currency: series.currency,
		createdAt: now,
		updatedAt: now,
	}));

	await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
		tx.insert(recurringOccurrences).values(chunk).onConflictDoNothing(),
	);
}

/**
 * Sure's `OccurrenceGenerator#generate!` for every active series, or those of
 * `ids`: one occurrence per due date from the start of the current cycle, so
 * a recent unpaid one exists, never before a manual series' anchor, through
 * `horizonOf`. Idempotent: an occurrence already there is left as it is. A
 * series that is not active gets none.
 */
export async function generateOccurrences(
	tx: Writer,
	day: IsoDate,
	ids?: readonly string[],
): Promise<void> {
	const now = Date.now();
	const active = [...(await seriesWithSchedules(tx, ids)).values()].filter(
		(series) => series.status === "active",
	);

	await oneByOne(active, async (series) => {
		const cycle = cycleFor(series.schedule, day);
		const start = cycle?.start ?? day;
		// A declared bill's anchor is its first due date: no debt before it.
		const from =
			series.manual && series.anchorDate !== null ? maxDate(start, series.anchorDate) : start;

		await insertOccurrences(
			tx,
			series,
			occurrencesBetween(series.schedule, from, horizonOf(series.schedule, series, day)),
			now,
		);
	});
}

/** No payment of any state points at the occurrence. */
const unallocated = notExists(
	sql`(select 1 from ${recurringAllocations} where ${recurringAllocations.recurringOccurrenceId} = ${recurringOccurrences.id})`,
);

/**
 * Sure's `regenerate_future!`: the open occurrences of `ids` due today or
 * later that carry no payment go, and the schedule rebuilds them. A paid,
 * skipped or allocated occurrence is history and stays.
 */
export async function regenerateFuture(
	tx: Writer,
	ids: readonly string[],
	day: IsoDate,
): Promise<void> {
	if (ids.length === 0) {
		return;
	}

	await inSequence(ids, KEYS_PER_LOOKUP, (chunk) =>
		tx
			.delete(recurringOccurrences)
			.where(
				and(
					inArray(recurringOccurrences.recurringTransactionId, chunk),
					eq(recurringOccurrences.status, "scheduled"),
					gte(recurringOccurrences.dueOn, day),
					unallocated,
				),
			),
	);
	await generateOccurrences(tx, day, ids);
}

/**
 * Sure's `pin_amount_on_dates_already_due`: a new price applies from now
 * on, so the open occurrences already due that read the series' amount keep
 * the one they claimed.
 */
export async function pinAmountsAlreadyDue(
	tx: Pick<Transaction, "update">,
	seriesId: string,
	previous: MinorUnits,
	day: IsoDate,
): Promise<void> {
	await tx
		.update(recurringOccurrences)
		.set({ expectedAmount: Math.abs(previous), updatedAt: Date.now() })
		.where(
			and(
				eq(recurringOccurrences.recurringTransactionId, seriesId),
				eq(recurringOccurrences.status, "scheduled"),
				isNull(recurringOccurrences.expectedAmount),
				lte(recurringOccurrences.dueOn, day),
			),
		);
}

/**
 * Sure's `Matcher#run!`, or `run_backfill!` with `backfill`: every open
 * occurrence against the transactions of its window, written through the
 * allocator. A live run reads transactions up to today only.
 */
export async function matchOccurrences(
	tx: Writer,
	day: IsoDate,
	{ backfill }: { backfill: boolean },
): Promise<void> {
	const open = await tx
		.select({
			id: recurringOccurrences.id,
			seriesId: recurringOccurrences.recurringTransactionId,
			dueOn: recurringOccurrences.dueOn,
			snoozedUntil: recurringOccurrences.snoozedUntil,
			expectedAmount: recurringOccurrences.expectedAmount,
		})
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.status, "scheduled"))
		.orderBy(recurringOccurrences.dueOn, recurringOccurrences.id);
	const occurrences = open.map((row) => ({
		...row,
		expectedAmount: row.expectedAmount === null ? null : toMinorUnits(row.expectedAmount),
	}));
	const series = await seriesWithSchedules(tx);
	const window = entryWindow(series, occurrences, day, backfill);

	if (window === null) {
		return;
	}

	const found = await matchableTransactions(tx, window);
	const rejected = await tx
		.select({
			seriesId: recurringMatchRejections.recurringTransactionId,
			entryId: recurringMatchRejections.entryId,
		})
		.from(recurringMatchRejections);
	const confirmed = await tx
		.selectDistinct({ entryId: sql<string>`${recurringAllocations.entryId}` })
		.from(recurringAllocations)
		.where(
			and(eq(recurringAllocations.state, "confirmed"), isNotNull(recurringAllocations.entryId)),
		);
	const decisions = matchPayments(
		series,
		occurrences,
		found,
		{
			today: day,
			rejected: new Set(rejected.map((row) => rejectionKey(row.seriesId, row.entryId))),
			confirmedEntryIds: new Set(confirmed.map((row) => row.entryId)),
		},
		{ backfill },
	);
	const byId = new Map(found.map((entry) => [entry.id, entry]));
	const now = Date.now();

	await oneByOne(decisions, (decision) =>
		allocateMatched(tx, decision, byId.get(decision.entryId)!, now),
	);
}

/**
 * Sure's `HistoryBackfiller`: six months of past occurrences for every active
 * series, or those of `ids`, the anchor left aside since history predates
 * it; then a backfill match over every open occurrence, confirmed payments
 * only; then the open occurrences before the current cycle that nothing
 * pays go, since a rebuild reconstructs what happened and invents no debt.
 * Running it twice changes nothing.
 */
export async function backfillOccurrences(
	tx: Writer,
	day: IsoDate,
	ids?: readonly string[],
): Promise<void> {
	const now = Date.now();
	const active = [...(await seriesWithSchedules(tx, ids)).values()].filter(
		(series) => series.status === "active",
	);

	await oneByOne(active, (series) =>
		insertOccurrences(
			tx,
			series,
			occurrencesBetween(series.schedule, addMonths(day, -BACKFILL_MONTHS), day),
			now,
		),
	);
	await matchOccurrences(tx, day, { backfill: true });
	await oneByOne(active, async (series) => {
		const cycle = cycleFor(series.schedule, day);

		if (cycle === null) {
			return;
		}

		await tx
			.delete(recurringOccurrences)
			.where(
				and(
					eq(recurringOccurrences.recurringTransactionId, series.id),
					eq(recurringOccurrences.status, "scheduled"),
					lt(recurringOccurrences.dueOn, cycle.start),
					unallocated,
				),
			);
	});
}

/** A series' current occurrence, as `/recurring` shows it. */
export type CurrentOccurrence = {
	id: string;
	dueOn: IsoDate;
	/** The due date, or a later snooze. */
	effectiveDueOn: IsoDate;
	status: OccurrenceStatus;
	state: DerivedState;
	/** Days past the effective due date in `APP_TIMEZONE` once overdue, else `null`. */
	daysLate: number | null;
};

/**
 * Each series' earliest open occurrence, else its latest, for `ids`. A
 * series with none is left out.
 */
export async function currentOccurrences(
	db: Pick<Transaction, "select">,
	ids: readonly string[],
	day: IsoDate,
): Promise<Map<string, CurrentOccurrence>> {
	const rows: {
		id: string;
		seriesId: string;
		dueOn: string;
		snoozedUntil: string | null;
		status: OccurrenceStatus;
	}[] = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(
			...(await db
				.select({
					id: recurringOccurrences.id,
					seriesId: recurringOccurrences.recurringTransactionId,
					dueOn: recurringOccurrences.dueOn,
					snoozedUntil: recurringOccurrences.snoozedUntil,
					status: recurringOccurrences.status,
				})
				.from(recurringOccurrences)
				.where(inArray(recurringOccurrences.recurringTransactionId, chunk))
				.orderBy(recurringOccurrences.dueOn, recurringOccurrences.id)),
		);
	});

	const found = new Map<string, CurrentOccurrence>();

	for (const row of rows) {
		const held = found.get(row.seriesId);
		const state = derivedState(row, day);
		const current: CurrentOccurrence = {
			id: row.id,
			dueOn: row.dueOn,
			effectiveDueOn: effectiveDueOn(row),
			status: row.status,
			state,
			daysLate: state === "overdue" ? daysBetween(effectiveDueOn(row), day) : null,
		};

		// Rows run by date: the first open one stays, else the last closed one.
		if (held === undefined || held.status !== "scheduled") {
			found.set(row.seriesId, current);
		}
	}

	return found;
}

// The day the daily generation last ran, in `APP_TIMEZONE`.
const GENERATED_ON = "recurring_generated_on";

const generatedOn = async (db: Pick<Transaction, "select">) =>
	(
		await db
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, GENERATED_ON))
			.get()
	)?.value;

/**
 * The first signed-in read of the day generates every active series'
 * occurrences, so a bill due today exists without a sync. The day is claimed
 * in one immediate transaction, as the price run's lease: of two requests
 * racing, one runs. `null` once today's run is claimed.
 */
export async function startDailyOccurrences(
	deps: ServiceDeps,
): Promise<{ run: () => Promise<void> } | null> {
	const day = today(deps.timeZone);

	// Every page load comes here: a plain read settles it once the day is
	// claimed, and only a due run opens the write transaction.
	if ((await generatedOn(deps.db)) === day) {
		return null;
	}

	const claimed = await deps.db.transaction(
		async (tx) => {
			if ((await generatedOn(tx)) === day) {
				return false;
			}

			const now = Date.now();

			await tx
				.insert(settings)
				.values({ key: GENERATED_ON, value: day, updatedAt: now })
				.onConflictDoUpdate({ target: settings.key, set: { value: day, updatedAt: now } });

			return true;
		},
		{ behavior: "immediate" },
	);

	return claimed
		? {
				run: () =>
					deps.db.transaction((tx) => generateOccurrences(tx, day), { behavior: "immediate" }),
			}
		: null;
}
