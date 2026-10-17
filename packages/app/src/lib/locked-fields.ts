import type { LockableField } from "@archant/data/schema/transactions";

import { toIsoDate } from "@/lib/dates";

/** Each lockable field's name, the French word where Sure falls back to English. */
const FIELD_NAMES = {
	date: "transactions.protection.fields.date",
	amount: "transactions.protection.fields.amount",
	label: "transactions.protection.fields.label",
	notes: "transactions.protection.fields.notes",
	excluded: "transactions.protection.fields.excluded",
	category: "transactions.protection.fields.category",
	merchant: "transactions.protection.fields.merchant",
	tags: "transactions.protection.fields.tags",
	investmentActivityLabel: "transactions.protection.fields.investmentActivityLabel",
} as const satisfies Record<LockableField, string>;

/** `LockedFields` as the API's JSON reads it, each absent key possibly `undefined`. */
type ReadLocks = { [Field in LockableField]?: number | null | undefined };

function isLockable(field: string): field is LockableField {
	return Object.hasOwn(FIELD_NAMES, field);
}

/**
 * Whether a transaction shows Sure's protection indicator, as its
 * `protected_from_sync? && !excluded?`. Sure reads its `user_modified` and
 * `import_locked` flags; a hand edit here always locks a field (AD-10), so a
 * lock stands for both.
 */
export function protectedFromSync(transaction: {
	lockedFields: ReadLocks;
	excluded: boolean;
}): boolean {
	return Object.keys(transaction.lockedFields).length > 0 && !transaction.excluded;
}

/**
 * Each lock as the block lists it, in the order the fields were first locked,
 * as Sure lists `locked_attributes`: the field's name and the local day it was
 * locked, `null` for a lock older than the times.
 */
export function listedLocks(
	lockedFields: ReadLocks,
): { field: LockableField; name: (typeof FIELD_NAMES)[LockableField]; day: string | null }[] {
	return Object.entries(lockedFields).flatMap(([field, at]) =>
		isLockable(field) && at !== undefined
			? [{ field, name: FIELD_NAMES[field], day: at === null ? null : toIsoDate(new Date(at)) }]
			: [],
	);
}
