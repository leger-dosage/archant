import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import { HAND_TRANSFER_WINDOW_DAYS } from "../domain/transfer-matching.ts";
import {
	pairTransferInput,
	transferCandidatesInput,
	unpairTransferInput,
} from "../schemas/assistants.ts";
import {
	createTransfer,
	deleteTransfer,
	listTransferCandidates,
	rejectTransfer,
} from "../services/transfers.ts";
import { BANK_TEXT, CREATES, DESTROYS, READ_ONLY, decimal, defineTool, namedRef } from "./tool.ts";

export const getTransferCandidates = defineTool({
	name: "get_transfer_candidates",
	title: "Transfer candidates",
	description: `The transactions a transaction can be paired with as one transfer, as « Rapprocher un virement » lists them in Archant, closest date first: the opposite amount in another active account of the same currency, within ${HAND_TRANSFER_WINDOW_DAYS} days, in no transfer, a pair the owner told the matcher never to propose included. A transaction already in a transfer, excluded, or a split's line has none. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transferCandidatesInput,
	output: z.object({
		candidates: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				name: z.string().describe("The label the line shows."),
				amount: decimal("Signed: negative is money out"),
				currency: z.string(),
				account: namedRef,
			}),
		),
	}),
	run: async (deps, input) => {
		const found = await listTransferCandidates(deps, input.transaction_id);

		return {
			result: {
				candidates: found.map((candidate) => ({
					id: candidate.id,
					date: candidate.date,
					name: candidate.label,
					amount: toDecimalString(candidate),
					currency: candidate.currency,
					account: { id: candidate.accountId, name: candidate.accountName },
				})),
			},
			changedRows: 0,
		};
	},
});

export const pairTransferTool = defineTool({
	name: "pair_transfer",
	title: "Pair a transfer",
	description:
		"Pairs a transaction with one of its candidates as one confirmed transfer, as « Rapprocher un virement » does in Archant: the negative side becomes the outflow, and both leave income and expenses. No balance, category or tag changes. An unknown transaction_id answers NOT_FOUND; a counterpart get_transfer_candidates does not list answers VALIDATION_ERROR on counterpart_id.",
	scope: "archant:write",
	annotations: CREATES,
	input: pairTransferInput,
	output: z.object({
		id: z.string().describe("The transfer's id, which unpair_transfer takes."),
		kind: z.enum(TRANSFER_KINDS),
		outflow_transaction_id: z.string(),
		inflow_transaction_id: z.string(),
	}),
	run: async (deps, input) => {
		const transfer = await createTransfer(deps, {
			transactionId: input.transaction_id,
			counterpartId: input.counterpart_id,
		});

		return {
			result: {
				id: transfer.id,
				kind: transfer.kind,
				outflow_transaction_id: transfer.outflowTransactionId,
				inflow_transaction_id: transfer.inflowTransactionId,
			},
			changedRows: 1,
		};
	},
});

export const unpairTransferTool = defineTool({
	name: "unpair_transfer",
	title: "Unpair a transfer",
	description:
		"Undoes a transfer, as « Dissocier » does in Archant: both sides become standard transactions again, with their category, locks and tags, and count in income and expenses. With never_propose, as « Ne plus proposer », the pair is also refused for good: no import, sync or rule proposes these two again, though pair_transfer still may, and the refusal cannot be undone.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: unpairTransferInput,
	output: z.object({
		transfer_id: z.string(),
		outflow_transaction_id: z.string(),
		inflow_transaction_id: z.string(),
		never_propose: z.boolean().describe("Whether the pair is now refused for good."),
	}),
	run: async (deps, { transfer_id: transferId, never_propose: neverPropose }) => {
		const undone = await (neverPropose ? rejectTransfer : deleteTransfer)(deps, transferId);

		return {
			result: {
				transfer_id: undone.id,
				outflow_transaction_id: undone.outflowTransactionId,
				inflow_transaction_id: undone.inflowTransactionId,
				never_propose: neverPropose,
			},
			changedRows: 1,
		};
	},
});
