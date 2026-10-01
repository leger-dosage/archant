import type { IsoDate } from "../../domain/dates.ts";
import type { RejectionCode } from "../../domain/statement.ts";
import type { Origin, Transaction } from "./shared.ts";

import { count, eq, inArray } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import type { CategoryOrigin } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { merchants } from "@archant/data/schema/merchants";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import type { LockableField } from "@archant/data/schema/transactions";
import { LOCKABLE_FIELDS, transactions } from "@archant/data/schema/transactions";

import { AppError } from "../../lib/errors.ts";
import { KEYS_PER_LOOKUP, inSequence } from "./shared.ts";

/**
 * The `category_origin` a write records; a sync brings the provider's
 * category. Maintenance has none: it moves categories wholesale through
 * `recategorise`, never one transaction's through `updateTransaction`.
 */
const CATEGORY_ORIGIN_OF: Record<Exclude<Origin, "maintenance">, CategoryOrigin> = {
	user: "user",
	rule: "rule",
	provider: "provider",
	sync: "provider",
};

function categoryOriginOf(origin: Origin): CategoryOrigin {
	if (origin === "maintenance") {
		// A programming error, not a request error: no caller does this, and
		// the row would get an origin without the lock that goes with it.
		throw new Error("A maintenance write cannot set one transaction's category.");
	}

	return CATEGORY_ORIGIN_OF[origin];
}

/** An absent or `undefined` field is left as it is. */
export type TransactionPatch = {
	date?: IsoDate | undefined;
	amount?: MinorUnits | undefined;
	label?: string | undefined;
	notes?: string | null | undefined;
	excluded?: boolean | undefined;
	/** `null` leaves the transaction « Sans catégorie ». */
	categoryId?: string | null | undefined;
	/** `null` leaves the transaction « Sans marchand ». */
	merchantId?: string | null | undefined;
	/** The whole set, replacing the current one; `[]` removes every tag. */
	tagIds?: readonly string[] | undefined;
};

/** The patch key and the row column behind each lockable field. */
const PATCH_KEY_OF = {
	date: "date",
	amount: "amount",
	label: "label",
	notes: "notes",
	excluded: "excluded",
	category: "categoryId",
	merchant: "merchantId",
	tags: "tagIds",
} as const satisfies Record<LockableField, keyof TransactionPatch>;

export type UpdateResult = { status: "updated" } | { status: "rejected"; reason: RejectionCode };

// What a row edit reads: the entry's date and amount beside the detail row.
export const editableColumns = {
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
	excluded: transactions.excluded,
	categoryId: transactions.categoryId,
	merchantId: transactions.merchantId,
	lockedFields: transactions.lockedFields,
};

export async function transactionRow(tx: Transaction, entryId: string) {
	const row = await tx
		.select(editableColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return { ...row, tagIds: await tagIdsOf(tx, entryId) };
}

/** A transaction as an edit sees it, tags included. */
export type EditableRow = Awaited<ReturnType<typeof transactionRow>>;

export async function tagIdsOf(
	db: Pick<Transaction, "select">,
	entryId: string,
): Promise<string[]> {
	const rows = await db
		.select({ tagId: taggings.tagId })
		.from(taggings)
		.where(eq(taggings.transactionId, entryId))
		.orderBy(taggings.tagId);

	return rows.map((row) => row.tagId);
}

/** Tags are a set: the same ids in another order, or repeated, are no change. */
function sameValue(current: unknown, value: unknown): boolean {
	if (Array.isArray(current) && Array.isArray(value)) {
		const wanted = new Set<unknown>(value);

		return wanted.size === current.length && current.every((item) => wanted.has(item));
	}

	return current === value;
}

type RowChange = { next: EditableRow; changed: LockableField[] };

/**
 * What `patch` changes on one row. A field changes only where the value
 * differs; a `user` write changes a locked field, any other origin leaves it
 * as it is (AD-10). Shared by the single and the bulk edit, so both lock the
 * same way.
 */
export function changeOf(current: EditableRow, patch: TransactionPatch, origin: Origin): RowChange {
	const locked = new Set(current.lockedFields);
	const next = { ...current };
	const changed: LockableField[] = [];

	for (const field of LOCKABLE_FIELDS) {
		const key = PATCH_KEY_OF[field];
		const value = patch[key];
		const allowed = origin === "user" || !locked.has(field);

		if (value !== undefined && !sameValue(current[key], value) && allowed) {
			changed.push(field);
			Object.assign(next, { [key]: Array.isArray(value) ? [...new Set(value)] : value });
		}
	}

	return { next, changed };
}

/**
 * The `transactions` columns a change writes: the fields it changed, the
 * category's origin with the category, `null` without one, and the locks a
 * `user` write adds. The entry's date and amount and the taggings are the
 * caller's.
 */
export function detailOf(
	current: EditableRow,
	{ next, changed }: RowChange,
	origin: Origin,
): Partial<typeof transactions.$inferInsert> {
	// Asked even when the category is cleared, so a maintenance write fails either way.
	const categoryOrigin = changed.includes("category") ? categoryOriginOf(origin) : null;

	return {
		...(changed.includes("label") ? { label: next.label } : {}),
		...(changed.includes("notes") ? { notes: next.notes } : {}),
		...(changed.includes("excluded") ? { excluded: next.excluded } : {}),
		...(changed.includes("category")
			? {
					categoryId: next.categoryId,
					categoryOrigin: next.categoryId === null ? null : categoryOrigin,
				}
			: {}),
		...(changed.includes("merchant") ? { merchantId: next.merchantId } : {}),
		lockedFields:
			origin === "user"
				? [...new Set([...current.lockedFields, ...changed])]
				: current.lockedFields,
	};
}

export async function categoryExists(tx: Transaction, id: string): Promise<boolean> {
	const row = await tx
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.id, id))
		.get();

	return row !== undefined;
}

export async function merchantExists(tx: Transaction, id: string): Promise<boolean> {
	const row = await tx
		.select({ id: merchants.id })
		.from(merchants)
		.where(eq(merchants.id, id))
		.get();

	return row !== undefined;
}

/** Whether every one of `ids`, without repeats, names a tag. */
export async function tagsExist(tx: Transaction, ids: readonly string[]): Promise<boolean> {
	const found = await tx
		.select({ count: count() })
		.from(tags)
		.where(inArray(tags.id, [...ids]))
		.get();

	return found?.count === ids.length;
}

/**
 * The tags of each of `entryIds`, one query for a page rather than a join that
 * would repeat a row once per tag.
 */
export async function tagIdsByEntry(
	db: Pick<Transaction, "select">,
	entryIds: readonly string[],
): Promise<Map<string, string[]>> {
	const found = new Map<string, string[]>();

	await inSequence(entryIds, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await db
			.select({ transactionId: taggings.transactionId, tagId: taggings.tagId })
			.from(taggings)
			.where(inArray(taggings.transactionId, chunk))
			.orderBy(taggings.tagId);

		for (const row of rows) {
			found.set(row.transactionId, [...(found.get(row.transactionId) ?? []), row.tagId]);
		}
	});

	return found;
}
