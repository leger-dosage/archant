import type { IsoDate } from "../../domain/dates.ts";
import type { RowPlan, RuleCandidate } from "../../domain/rules/matching.ts";
import type { ServiceDeps } from "../deps.ts";
import type { EditableRow } from "./patch.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq, gte, inArray } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { merchants } from "@archant/data/schema/merchants";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import { transactions } from "@archant/data/schema/transactions";

import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import { changeOf, detailOf, editableColumns, tagIdsByEntry } from "./patch.ts";
import {
	KEYS_PER_LOOKUP,
	ROWS_PER_INSERT,
	asInflow,
	asOutflow,
	chunksOf,
	inAnyTransfer,
	inSequence,
	notSplitParent,
	oneByOne,
	transferColumns,
} from "./shared.ts";
import { matchTransfers } from "./transfers.ts";

/** Which of `ids` `find` still finds, looked up 500 per query. */
async function stillThere(
	ids: Iterable<string>,
	find: (chunk: string[]) => Promise<{ id: string }[]>,
): Promise<Set<string>> {
	const found = new Set<string>();

	await inSequence([...new Set(ids)], KEYS_PER_LOOKUP, async (chunk) => {
		for (const row of await find(chunk)) {
			found.add(row.id);
		}
	});

	return found;
}

/** `id` when `set` still holds it, `undefined` otherwise. */
function ifStillThere(set: ReadonlySet<string>, id: string | undefined): string | undefined {
	return id !== undefined && set.has(id) ? id : undefined;
}

/** What `applyRulePlan` re-reads of each planned row; a row deleted since the plan is absent. */
function plannedRows(tx: Transaction, ids: string[]) {
	return tx
		.select({
			id: entries.id,
			...editableColumns,
			inTransfer: inAnyTransfer.mapWith(Boolean),
			expectedTransferAccountId: transactions.expectedTransferAccountId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(inArray(entries.id, ids));
}

/**
 * Writes what rules planned, by entry id, with `origin: "rule"` (AD-10): a
 * category's origin becomes `rule` and nothing is locked. It re-reads each
 * row inside the transaction and skips a locked field, a value the row
 * already holds, and a category, merchant, tag or account deleted since the
 * plan. A tag is added beside the others while the row holds fewer than
 * `MAX_TAGS_PER_TRANSACTION`; the expected counterpart account is set only on
 * a row in no transfer. Returns the ids of the rows it changed. Step 5 of
 * `ingest` calls it; applying rules to history reuses it.
 */
export async function applyRulePlan(
	tx: Transaction,
	plan: ReadonlyMap<string, RowPlan>,
	_options: { origin: "rule" },
): Promise<{ changed: string[] }> {
	const origin: Origin = "rule";
	const ids = [...plan.keys()];
	const plans = [...plan.values()];
	const rows: Awaited<ReturnType<typeof plannedRows>> = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(...(await plannedRows(tx, chunk)));
	});

	const tagsOf = await tagIdsByEntry(tx, ids);
	const [knownCategories, knownMerchants, knownTags, knownAccounts] = [
		await stillThere(
			plans.flatMap((row) => (row.categoryId === undefined ? [] : [row.categoryId])),
			(chunk) =>
				tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) => (row.merchantId === undefined ? [] : [row.merchantId])),
			(chunk) =>
				tx.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) => row.addTagIds ?? []),
			(chunk) => tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, chunk)),
		),
		await stillThere(
			plans.flatMap((row) =>
				row.expectedTransferAccountId === undefined ? [] : [row.expectedTransferAccountId],
			),
			(chunk) => tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, chunk)),
		),
	];
	// Rows whose write is the same share one statement per chunk, as in a bulk edit.
	const writes = new Map<
		string,
		{ detail: Partial<typeof transactions.$inferInsert>; ids: string[] }
	>();
	const newTaggings: { transactionId: string; tagId: string }[] = [];

	const rowById = new Map(rows.map((row) => [row.id, row]));

	for (const [id, planned] of plan) {
		const found = rowById.get(id);

		// Deleted since the plan: nothing left to write.
		if (found === undefined) {
			continue;
		}

		const { inTransfer, expectedTransferAccountId, ...row } = found;
		const current: EditableRow = { ...row, tagIds: tagsOf.get(id) ?? [] };
		const tagIds = [...current.tagIds];

		for (const tagId of planned.addTagIds ?? []) {
			if (
				knownTags.has(tagId) &&
				!tagIds.includes(tagId) &&
				tagIds.length < MAX_TAGS_PER_TRANSACTION
			) {
				tagIds.push(tagId);
			}
		}

		const change = changeOf(
			current,
			{
				categoryId: ifStillThere(knownCategories, planned.categoryId),
				merchantId: ifStillThere(knownMerchants, planned.merchantId),
				tagIds,
				label: planned.label,
				excluded: planned.excluded,
			},
			origin,
		);
		const expected = ifStillThere(knownAccounts, planned.expectedTransferAccountId);
		const expects =
			expected !== undefined &&
			expected !== expectedTransferAccountId &&
			expected !== row.accountId &&
			!inTransfer;

		if (change.changed.length === 0 && !expects) {
			continue;
		}

		const detail = {
			...detailOf(current, change, origin),
			...(expects ? { expectedTransferAccountId: expected } : {}),
		};
		const key = JSON.stringify(detail);
		const group = writes.get(key);

		if (group === undefined) {
			writes.set(key, { detail, ids: [id] });
		} else {
			group.ids.push(id);
		}

		if (change.changed.includes("tags")) {
			newTaggings.push(
				...change.next.tagIds
					.filter((tagId) => !current.tagIds.includes(tagId))
					.map((tagId) => ({ transactionId: id, tagId })),
			);
		}
	}

	const statements = [...writes.values()].flatMap(({ detail, ids: group }) =>
		chunksOf(group, ROWS_PER_INSERT).map((chunk) => ({ detail, chunk })),
	);

	await oneByOne(statements, ({ detail, chunk }) =>
		tx.update(transactions).set(detail).where(inArray(transactions.entryId, chunk)),
	);
	await inSequence(newTaggings, ROWS_PER_INSERT, (chunk) => tx.insert(taggings).values(chunk));

	return { changed: [...writes.values()].flatMap(({ ids: group }) => group) };
}

/**
 * Applying rules to existing transactions: writes `plan` through
 * `applyRulePlan`, then proposes transfers over every unmatched line, as
 * step 6 of `ingest` does, so a row whose expected counterpart account it
 * set finds its pair. No balance moves: no rule action changes an amount.
 * Returns how many rows changed, each once.
 */
export async function applyRulePlanToHistory(
	deps: ServiceDeps,
	plan: ReadonlyMap<string, RowPlan>,
	options: { origin: "rule" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const { changed } = await applyRulePlan(tx, plan, options);

			await matchTransfers(tx, Date.now());

			return changed.length;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Every transaction as a rule reads it, for applying rules to history:
 * possible duplicates and excluded rows included, split parents left out for
 * their children (AD-20), with their merchant,
 * category, tags, notes, transfer kind, expected counterpart and locks.
 * `from` keeps rows dated on or after it; `null` keeps every date.
 * `activeAccountsOnly` leaves out a deactivated account's rows, as Sure's
 * rules read `family.transactions.visible` while its recurring identifier,
 * which also reads these rows, reads every account. Tags are
 * read `KEYS_PER_LOOKUP` rows per query, below SQLite's parameter cap.
 */
export async function ruleCandidates(
	db: Pick<Transaction, "select">,
	from: IsoDate | null,
	{ activeAccountsOnly }: { activeAccountsOnly: boolean },
): Promise<RuleCandidate[]> {
	const rows = await db
		.select({
			id: entries.id,
			...editableColumns,
			expectedTransferAccountId: transactions.expectedTransferAccountId,
			transferKind: transferColumns.transferKind,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(
			and(
				eq(entries.kind, "transaction"),
				notSplitParent,
				activeAccountsOnly ? eq(accounts.active, true) : undefined,
				from === null ? undefined : gte(entries.date, from),
			),
		)
		.orderBy(entries.date, entries.createdAt, entries.id);
	const tagsOf = await tagIdsByEntry(
		db,
		rows.map((row) => row.id),
	);

	return rows.map(({ transferKind, amount, ...row }) => ({
		...row,
		amount: toMinorUnits(amount),
		tagIds: tagsOf.get(row.id) ?? [],
		transfer: transferKind === null ? null : { kind: transferKind },
	}));
}
