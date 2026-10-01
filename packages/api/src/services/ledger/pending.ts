import type { IsoDate } from "../../domain/dates.ts";
import type { GroupCandidate } from "../../domain/pending.ts";
import type { NormalizedTransaction } from "../../domain/statement.ts";
import type { KeyTarget, WrittenKeys } from "./entry-keys.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq, exists, inArray, sql } from "drizzle-orm";

import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { EntryKeySource } from "@archant/data/schema/entry-keys";
import { transactions } from "@archant/data/schema/transactions";

import { minDate } from "../../domain/dates.ts";
import { MAX_MISSED_SYNCS } from "../../domain/pending.ts";
import { attachKeys } from "./entry-keys.ts";
import { changeOf, detailOf, transactionRow } from "./patch.ts";
import { KEYS_PER_LOOKUP, deleteTransactionRows, inSequence } from "./shared.ts";

/**
 * The account's pending entries carrying a key of the connection (AD-17):
 * those a statement of that connection speaks for, so its booked lines may
 * absorb them and its silence counts as a miss.
 */
export async function pendingOfConnection(
	tx: Transaction,
	accountId: string,
	connectionId: string,
) {
	return tx
		.select({
			id: entries.id,
			date: entries.date,
			amount: entries.amount,
			createdAt: entries.createdAt,
			missedSyncs: transactions.pendingMissedSyncs,
			missedOn: transactions.pendingMissedOn,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(transactions.pending, true),
				exists(
					tx
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(
							and(eq(entryKeys.entryId, entries.id), eq(entryKeys.connectionId, connectionId)),
						),
				),
			),
		);
}

/**
 * The `fp:` keys the entries `ids` hold under `source`, each with its entry
 * and whether that entry holds an `ext:` key too.
 */
export async function heldFingerprints(
	tx: Transaction,
	source: EntryKeySource,
	ids: readonly string[],
): Promise<Map<string, Omit<GroupCandidate, "occurrence">>> {
	const rows: { key: string; id: string; createdAt: number }[] = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(
			...(await tx
				.select({ key: entryKeys.key, id: entries.id, createdAt: entries.createdAt })
				.from(entryKeys)
				.innerJoin(entries, eq(entries.id, entryKeys.entryId))
				.where(and(eq(entryKeys.source, source), inArray(entryKeys.entryId, chunk)))),
		);
	});

	const referenced = new Set(rows.filter(({ key }) => key.startsWith("ext:")).map(({ id }) => id));

	return new Map(
		rows
			.filter(({ key }) => key.startsWith("fp:"))
			.map(({ key, id, createdAt }) => [key, { id, createdAt, referenced: referenced.has(id) }]),
	);
}

/**
 * Step 3's write (AD-17): the survivor takes the line's date, amount, label
 * and notes, except the fields a user locked (`changeOf`), and its status;
 * its missed syncs start over, their count and their last day both, and the
 * line's keys join the ones it has. The old keys stay, so the bank sending
 * the old pending line again finds a booked entry and changes nothing. The
 * id, the category, the merchant, the tags, the transfer and the exclusion
 * stay as they are, and rules do not run again. Returns the earlier of the
 * old and new dates, where balances move.
 */
export async function absorb(
	tx: Transaction,
	survivorId: string,
	line: { line: NormalizedTransaction; keys: WrittenKeys },
	keyTarget: KeyTarget,
	origin: Origin,
	now: number,
): Promise<IsoDate> {
	const current = await transactionRow(tx, survivorId);
	const change = changeOf(
		current,
		{
			date: line.line.date,
			amount: line.line.amount,
			label: line.line.label,
			notes: line.line.notes,
		},
		origin,
	);
	const { next } = change;

	await tx
		.update(entries)
		.set({ date: next.date, amount: next.amount, updatedAt: now })
		.where(eq(entries.id, survivorId));
	await tx
		.update(transactions)
		.set({
			...detailOf(current, change, origin),
			pending: line.line.pending,
			pendingMissedSyncs: 0,
			pendingMissedOn: null,
		})
		.where(eq(transactions.entryId, survivorId));
	await attachKeys(tx, current.accountId, keyTarget, [{ entryId: survivorId, keys: line.keys }], {
		keepExisting: true,
	});

	return minDate(current.date, next.date);
}

/**
 * Counts a miss on every pending entry of the connection dated `from` or
 * later and outside `seen`, unless one was counted on `day` already, and
 * deletes those reaching `MAX_MISSED_SYNCS` (AD-17). Two syncs an hour apart
 * both missing a line the bank dropped a little before booking it count
 * once, so the booked line still finds its entry the next day. Returns the
 * dates of the deleted ones, where balances move.
 */
export async function countMissedSyncs(
	tx: Transaction,
	accountId: string,
	connectionId: string,
	from: IsoDate,
	seen: ReadonlySet<string>,
	day: IsoDate,
): Promise<IsoDate[]> {
	const missed = (await pendingOfConnection(tx, accountId, connectionId)).filter(
		({ id, date, missedOn }) =>
			date >= from && !seen.has(id) && (missedOn === null || missedOn < day),
	);
	const gone = missed.filter(({ missedSyncs }) => missedSyncs + 1 >= MAX_MISSED_SYNCS);
	const kept = missed.filter(({ missedSyncs }) => missedSyncs + 1 < MAX_MISSED_SYNCS);

	await inSequence(kept, KEYS_PER_LOOKUP, (chunk) =>
		tx
			.update(transactions)
			.set({
				pendingMissedSyncs: sql`${transactions.pendingMissedSyncs} + 1`,
				pendingMissedOn: day,
			})
			.where(
				inArray(
					transactions.entryId,
					chunk.map(({ id }) => id),
				),
			),
	);
	await inSequence(gone, KEYS_PER_LOOKUP, (chunk) =>
		deleteTransactionRows(
			tx,
			chunk.map(({ id }) => id),
		),
	);

	return gone.map(({ date }) => date);
}
