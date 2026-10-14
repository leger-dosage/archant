import { z } from "zod";

import { clampedPageFields } from "./fields.ts";

const transferTransactionId = z
	.string()
	.min(1)
	.describe("A transaction id from get_transactions, in no transfer.");

/**
 * `get_transfer_candidates`: what « Rapprocher un virement » lists for a
 * transaction, a page at a time as Sure's `get_categories`.
 */
export const transferCandidatesInput = z.strictObject({
	transaction_id: transferTransactionId,
	...clampedPageFields,
});

/** `pair_transfer`: the body of `POST /api/transfers`, as the picker sends it. */
export const pairTransferInput = z.strictObject({
	transaction_id: transferTransactionId,
	counterpart_id: z
		.string()
		.min(1)
		.describe("A candidate's id, as get_transfer_candidates lists it for transaction_id."),
});

/** `unpair_transfer`: « Dissocier », or « Ne plus proposer » with `never_propose`. */
export const unpairTransferInput = z.strictObject({
	transfer_id: z
		.string()
		.min(1)
		.describe("A transfer's id, as get_transactions or get_transaction gives it in transfer.id."),
	never_propose: z
		.boolean()
		.default(false)
		.describe(
			"true also refuses the pair for good: no search, by hand, by an import or by a sync, offers it again, and nothing undoes the refusal. Pass it only when the owner said so.",
		),
});
