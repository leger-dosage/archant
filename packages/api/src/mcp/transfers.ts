import { z } from "zod";

import { TRANSFER_STATUSES } from "@archant/data/transfer-kinds";

import { HAND_TRANSFER_WINDOW_DAYS } from "../domain/transfer-matching.ts";
import {
	pairTransferInput,
	transferCandidatesInput,
	unpairTransferInput,
} from "../schemas/assistants/transfers.ts";
import { transactionsById } from "../services/transactions.ts";
import {
	createTransfer,
	deleteTransfer,
	getTransferStatus,
	listTransferCandidates,
	rejectTransfer,
} from "../services/transfers.ts";
import { BANK_TEXT, CREATES, DESTROYS, READ_ONLY, defineTool, pageOf, pageOutput } from "./tool.ts";
import { itemOf, namesFor, transaction } from "./transactions.ts";

export const getTransferCandidates = defineTool({
	name: "get_transfer_candidates",
	title: "Transfer candidates",
	description: `The transactions a transaction can be paired with as one transfer, as « Rapprocher un virement » lists them in Archant, closest date first, a page at a time as Sure's get_categories, each as get_transactions lists it: the opposite amount in another active account of the same currency, within ${HAND_TRANSFER_WINDOW_DAYS} days, in no transfer, a pair the owner told the matcher never to propose included. A transaction already in a transfer or excluded, a split's parent included, has none. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transferCandidatesInput,
	output: z.object({ candidates: z.array(transaction), ...pageOutput }),
	run: async (deps, { transaction_id: transactionId, page, page_size: pageSize }) => {
		const { items, ...fields } = pageOf(
			await listTransferCandidates(deps, transactionId),
			page,
			pageSize,
		);
		const rows = await transactionsById(
			deps,
			items.map((candidate) => candidate.id),
		);
		const names = await namesFor(deps, rows);

		return {
			result: { candidates: rows.map((row) => itemOf(row, names)), ...fields },
			changedRows: 0,
		};
	},
});

/** A transfer as the pairing tools answer it, in Sure's `{ success, <row>, message }`. */
const transferOutput = z.object({
	id: z.string().describe("The transfer's id, which unpair_transfer takes."),
	status: z
		.enum(TRANSFER_STATUSES)
		.describe(
			"confirmed once the owner paired or confirmed it; for an unpaired transfer, the status it had.",
		),
	outflow_transaction_id: z.string(),
	inflow_transaction_id: z.string(),
});

type Paired = {
	id: string;
	status: z.output<typeof transferOutput>["status"];
	outflowTransactionId: string;
	inflowTransactionId: string;
};

function transferOf(transfer: Paired): z.input<typeof transferOutput> {
	return {
		id: transfer.id,
		status: transfer.status,
		outflow_transaction_id: transfer.outflowTransactionId,
		inflow_transaction_id: transfer.inflowTransactionId,
	};
}

const written = z.object({
	success: z.literal(true),
	transfer: transferOutput,
	message: z.string(),
});

export const pairTransferTool = defineTool({
	name: "pair_transfer",
	title: "Pair a transfer",
	description:
		"Pairs a transaction with one of its candidates as one confirmed transfer, as « Rapprocher un virement » does in Archant: the negative side becomes the outflow, and both leave income and expenses. No balance, category or tag changes. Answers { success, transfer, message }. An unknown transaction_id answers not_found; a counterpart get_transfer_candidates does not list answers validation_error on counterpart_id.",
	scope: "archant:write",
	annotations: CREATES,
	input: pairTransferInput,
	output: written,
	run: async (deps, input) => {
		const transfer = await createTransfer(deps, {
			transactionId: input.transaction_id,
			counterpartId: input.counterpart_id,
		});

		return {
			result: {
				success: true as const,
				transfer: transferOf(transfer),
				message: "Transfer confirmed: both transactions now count in neither income nor expenses.",
			},
			changedRows: 1,
		};
	},
});

export const unpairTransferTool = defineTool({
	name: "unpair_transfer",
	title: "Unpair a transfer",
	description:
		"Undoes a transfer, as « Dissocier » does in Archant: both sides become standard transactions again, with their category, locks and tags, and count in income and expenses; the fee lines of a transfer created with fees are deleted, as Sure's `Transfer#destroy!`. With never_propose, as « Ne plus proposer », the pair is also refused for good: no import, sync or rule proposes these two again, though pair_transfer still may, and the refusal cannot be undone. Answers { success, transfer, message }, the transfer as it was, the message saying whether the pair stays refused.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: unpairTransferInput,
	output: written,
	run: async (deps, { transfer_id: transferId, never_propose: neverPropose }) => {
		// Read first: once unpaired, the transfer and its status are gone.
		const status = await getTransferStatus(deps, transferId);
		const undone = await (neverPropose ? rejectTransfer : deleteTransfer)(deps, transferId);

		return {
			result: {
				success: true as const,
				transfer: transferOf({ ...undone, status: status ?? "pending" }),
				message: neverPropose
					? "Transfer unpaired. The pair is refused for good: no import, sync or rule proposes it again."
					: "Transfer unpaired. Matching may propose the pair again.",
			},
			changedRows: 1,
		};
	},
});
