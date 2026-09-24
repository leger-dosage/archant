import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addMonths, today } from "../domain/dates.ts";
import { LOOKBACK_MONTHS, detectRecurring as detectPatterns } from "../domain/recurring.ts";
import { ruleCandidates } from "./ledger.ts";

export type DetectionResult = { detected: number };

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

/**
 * Sure's `RecurringTransaction::Identifier` run over the last three months:
 * a detected pattern updates its stored row or creates one. A stored row no
 * longer detected stays as it is. Reads and writes in one write transaction,
 * so two detections racing each other cannot insert the same pattern twice.
 */
export async function detectRecurring(deps: ServiceDeps): Promise<DetectionResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const candidates = await ruleCandidates(tx, addMonths(day, -LOOKBACK_MONTHS));
			const patterns = detectPatterns(candidates, day);
			const stored = await tx
				.select({
					id: recurringTransactions.id,
					accountId: recurringTransactions.accountId,
					merchantId: recurringTransactions.merchantId,
					labelKey: recurringTransactions.labelKey,
					amount: recurringTransactions.amount,
				})
				.from(recurringTransactions);
			const idOf = new Map(stored.map((row) => [keyOf(row), row.id]));
			const now = Date.now();
			const updates = patterns.flatMap((pattern) => {
				const id = idOf.get(keyOf(pattern));

				return id === undefined ? [] : [{ id, pattern }];
			});
			const inserts = patterns
				.filter((pattern) => !idOf.has(keyOf(pattern)))
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
			await oneByOne(
				Array.from({ length: Math.ceil(inserts.length / ROWS_PER_INSERT) }, (_, index) =>
					inserts.slice(index * ROWS_PER_INSERT, (index + 1) * ROWS_PER_INSERT),
				),
				(chunk) => tx.insert(recurringTransactions).values(chunk),
			);

			return { detected: patterns.length };
		},
		{ behavior: "immediate" },
	);
}
