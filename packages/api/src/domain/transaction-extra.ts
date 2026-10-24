import type { TransactionExtra } from "@archant/data/schema/transactions";

/**
 * The details an entry keeps once a sync reads its line again, as Sure's
 * `apply_provider_extra` deep-merges them on every import: the stored ones,
 * `pending` dropped once the line is booked (`clear_pending_flags_from_extra`),
 * overwritten by the line's. `null` when nothing is left.
 */
export function mergeExtra(
	stored: TransactionExtra | null | undefined,
	incoming: TransactionExtra | null | undefined,
	pending: boolean,
): TransactionExtra | null {
	const { pending: wasPending, ...kept } = stored?.enable_banking ?? {};
	const details = {
		...kept,
		...(pending && wasPending === true ? { pending: true as const } : {}),
		...incoming?.enable_banking,
	};

	return Object.keys(details).length === 0 ? null : { enable_banking: details };
}
