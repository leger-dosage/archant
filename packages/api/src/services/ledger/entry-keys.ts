import type { IsoDate } from "../../domain/dates.ts";
import type { LineKeys, PairCandidate } from "../../domain/keys.ts";
import type { Transaction } from "./shared.ts";

import { and, between, eq, inArray, notExists, sql } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import { BANK_CONNECTOR_IDS } from "@archant/data/schema/bank-connections";
import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { deletedEntryKeys, entryKeys } from "@archant/data/schema/entry-keys";
import type { EntryKeySource } from "@archant/data/schema/entry-keys";
import { transactions } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import { MATCH_WINDOW_DAYS } from "../../domain/keys.ts";
import { KEYS_PER_LOOKUP, ROWS_PER_INSERT, inSequence } from "./shared.ts";

/** The entry holding each key already, and whether it is pending, looked up 500 keys per query. */
export async function entriesByKey(
	tx: Transaction,
	accountId: string,
	source: EntryKeySource,
	keys: readonly string[],
): Promise<Map<string, KnownEntry>> {
	const found = new Map<string, KnownEntry>();

	await inSequence(keys, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await tx
			.select({ key: entryKeys.key, entryId: entryKeys.entryId, pending: transactions.pending })
			.from(entryKeys)
			.innerJoin(transactions, eq(transactions.entryId, entryKeys.entryId))
			.where(
				and(
					eq(entryKeys.accountId, accountId),
					eq(entryKeys.source, source),
					inArray(entryKeys.key, chunk),
				),
			);

		for (const row of rows) {
			found.set(row.key, { entryId: row.entryId, pending: row.pending });
		}
	});

	return found;
}

type KnownEntry = { entryId: string; pending: boolean };

/**
 * The key a tombstone is judged by: the reference when the line has one,
 * since a new line's fingerprint may shift onto a deleted one's index, else
 * the fingerprint.
 */
export const tombstoneLookupKey = (keys: LineKeys) => keys.external ?? keys.fingerprint;

/** Only a bank connector's keys are ever tombstoned: a file's lines come back on re-import. */
export const isBankConnector = (source: EntryKeySource): source is BankConnectorId =>
	BANK_CONNECTOR_IDS.some((id) => id === source);

/** The keys among `keys` the user deleted an entry under, looked up 500 keys per query. */
export async function tombstonedKeys(
	tx: Transaction,
	accountId: string,
	source: BankConnectorId,
	keys: readonly string[],
): Promise<Set<string>> {
	const found = new Set<string>();

	await inSequence(keys, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await tx
			.select({ key: deletedEntryKeys.key })
			.from(deletedEntryKeys)
			.where(
				and(
					eq(deletedEntryKeys.accountId, accountId),
					eq(deletedEntryKeys.source, source),
					inArray(deletedEntryKeys.key, chunk),
				),
			);

		for (const row of rows) {
			found.add(row.key);
		}
	});

	return found;
}

/**
 * Keeps the bank keys of the entries `ids` as tombstones, so a sync never
 * brings back a transaction the user deleted. File keys are not kept:
 * re-importing a file brings its lines back, as in Sure.
 */
export async function tombstoneBankKeys(
	tx: Transaction,
	ids: readonly string[],
	now: number,
): Promise<void> {
	await tx
		.insert(deletedEntryKeys)
		.select(
			tx
				.select({
					accountId: entryKeys.accountId,
					source: entryKeys.source,
					key: entryKeys.key,
					deletedAt: sql<number>`${now}`.as("deleted_at"),
				})
				.from(entryKeys)
				.where(and(inArray(entryKeys.entryId, ids), inArray(entryKeys.source, BANK_CONNECTOR_IDS))),
		)
		.onConflictDoNothing();
}

/**
 * The account's transactions a line may pair with (AD-7): dated within the
 * window of the lines, and carrying no key from this source.
 */
export async function pairCandidates(
	tx: Transaction,
	accountId: string,
	source: EntryKeySource,
	dates: readonly IsoDate[],
): Promise<PairCandidate[]> {
	const sorted = dates.toSorted();
	const [first] = sorted;
	const last = sorted.at(-1);

	if (first === undefined || last === undefined) {
		return [];
	}

	const rows = await tx
		.select({ id: entries.id, date: entries.date, amount: entries.amount })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.kind, "transaction"),
				between(entries.date, addDays(first, -MATCH_WINDOW_DAYS), addDays(last, MATCH_WINDOW_DAYS)),
				notExists(
					tx
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(and(eq(entryKeys.entryId, entries.id), eq(entryKeys.source, source))),
				),
			),
		);

	return rows.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));
}

/**
 * Who a keyed ingest writes for: an import, or a bank connection. Keys carry
 * one of the two ids, so a revert finds its import's and a disconnection
 * leaves its connection's in place.
 */
export type KeyTarget = {
	source: EntryKeySource;
	importId: string | null;
	connectionId: string | null;
};

/** A line's keys as written: `null` for one its entry must not take. */
export type WrittenKeys = { fingerprint: string | null; external: string | null };

/**
 * Writes the keys of a statement's lines onto their entries (AD-7). Two
 * lines of one statement may share an external id: the second keeps its
 * fingerprint only. A key already stored fails the write, unless
 * `keepExisting`: an absorbed line brings the key that found its entry.
 */
export async function attachKeys(
	tx: Transaction,
	accountId: string,
	target: KeyTarget,
	lines: readonly { entryId: string; keys: WrittenKeys }[],
	options: { keepExisting?: boolean } = {},
): Promise<void> {
	const claimed = new Set<string>();
	const rows = lines.flatMap(({ entryId, keys }) =>
		[keys.fingerprint, keys.external]
			.filter((key): key is string => key !== null && !claimed.has(key))
			.map((key) => {
				claimed.add(key);

				return {
					entryId,
					accountId,
					source: target.source,
					key,
					importId: target.importId,
					connectionId: target.connectionId,
				};
			}),
	);

	await inSequence(rows, ROWS_PER_INSERT, (chunk) => {
		const insert = tx.insert(entryKeys).values(chunk);

		return options.keepExisting === true ? insert.onConflictDoNothing() : insert;
	});
}
