import type { IsoDate } from "../../domain/dates.ts";
import type { GroupCandidate } from "../../domain/pending.ts";
import type { NormalizedTransaction } from "../../domain/statement.ts";
import type { KeyTarget, WrittenKeys } from "./entry-keys.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq, exists, inArray } from "drizzle-orm";

import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { EntryKeySource } from "@archant/data/schema/entry-keys";
import { transactions } from "@archant/data/schema/transactions";

import { minDate } from "../../domain/dates.ts";
import { attachKeys } from "./entry-keys.ts";
import { changeOf, detailOf, transactionRow } from "./patch.ts";
import { KEYS_PER_LOOKUP, inSequence } from "./shared.ts";

/**
 * The account's pending entries carrying a key of the connection (AD-17):
 * those a statement of that connection speaks for, so its booked lines may
 * absorb them, as Sure's `find_pending_transaction` keeps to the entries of
 * the line's `source`.
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
 * the line's keys join the ones it has. With `keepDate`, for a line paired by
 * amount, the survivor keeps its own date, as Sure's `effective_date` keeps
 * the pending date of the entry its amount claimed; a line found by its
 * reference takes the booked date, as Sure's same-`external_id` path assigns
 * `date`. The old keys stay, so the bank sending the old pending line again
 * finds a booked entry and changes nothing. It takes the line's merchant only
 * when it has none and `merchant` is not locked: rules do not run again here,
 * where Sure's re-run after each sync would put a rule's merchant back. The
 * id, the category, the tags, the transfer and the exclusion stay as they
 * are. Returns the earlier of the old and new dates, where balances move.
 */
export async function absorb(
	tx: Transaction,
	survivorId: string,
	line: {
		line: NormalizedTransaction;
		keys: WrittenKeys;
		merchantId: string | null;
		keepDate: boolean;
	},
	keyTarget: KeyTarget,
	origin: Origin,
	now: number,
): Promise<IsoDate> {
	const current = await transactionRow(tx, survivorId);
	const merchantId = current.merchantId === null ? line.merchantId : null;
	const change = changeOf(
		current,
		{
			date: line.keepDate ? current.date : line.line.date,
			amount: line.line.amount,
			label: line.line.label,
			notes: line.line.notes,
			...(merchantId === null ? {} : { merchantId }),
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
		.set({ ...detailOf(change, origin, now), pending: line.line.pending })
		.where(eq(transactions.entryId, survivorId));
	await attachKeys(tx, current.accountId, keyTarget, [{ entryId: survivorId, keys: line.keys }], {
		keepExisting: true,
	});

	return minDate(current.date, next.date);
}
