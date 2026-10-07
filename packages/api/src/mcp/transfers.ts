import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import { TRANSFER_WINDOW_DAYS } from "../domain/transfer-matching.ts";
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
import { BANK_TEXT, CREATES, DESTROYS, READ_ONLY, decimal, defineTool } from "./tool.ts";

export const getTransferCandidates = defineTool({
	name: "get_transfer_candidates",
	title: "Transfer candidates",
	description: `The transactions a transaction can be paired with as one transfer, as « Rapprocher un virement » lists them in Archant, closest date first: the opposite amount in another active account of the same currency, within ${TRANSFER_WINDOW_DAYS} days, in no transfer, never a pair the owner refused. A transaction already in a transfer, excluded, or a split's line has none. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transferCandidatesInput,
	output: z.object({
		candidates: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				label: z.string(),
				amount: decimal("Signed: negative is money out"),
				currency: z.string(),
				accountId: z.string(),
				accountName: z.string(),
			}),
		),
	}),
	run: async (deps, input) => {
		const found = await listTransferCandidates(deps, input.transactionId);

		return {
			result: {
				candidates: found.map((candidate) => ({
					id: candidate.id,
					date: candidate.date,
					label: candidate.label,
					amount: toDecimalString(candidate),
					currency: candidate.currency,
					accountId: candidate.accountId,
					accountName: candidate.accountName,
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
		"Pairs a transaction with one of its candidates as one transfer, as « Rapprocher un virement » does in Archant: the negative side becomes the outflow, and both leave income and expenses. No balance, category or tag changes. An unknown transactionId answers NOT_FOUND; a counterpart get_transfer_candidates does not list, a refused pair included, answers VALIDATION_ERROR on counterpartId.",
	scope: "archant:write",
	annotations: CREATES,
	input: pairTransferInput,
	output: z.object({
		id: z.string().describe("The transfer's id, which unpair_transfer takes."),
		kind: z.enum(TRANSFER_KINDS),
		outflowTransactionId: z.string(),
		inflowTransactionId: z.string(),
	}),
	run: async (deps, input) => {
		const transfer = await createTransfer(deps, input);

		return {
			result: {
				id: transfer.id,
				kind: transfer.kind,
				outflowTransactionId: transfer.outflowTransactionId,
				inflowTransactionId: transfer.inflowTransactionId,
			},
			changedRows: 1,
		};
	},
});

export const unpairTransferTool = defineTool({
	name: "unpair_transfer",
	title: "Unpair a transfer",
	description:
		"Undoes a transfer, as « Dissocier » does in Archant: both sides become standard transactions again, with their category, locks and tags, and count in income and expenses. With neverPropose, as « Ne plus proposer », the pair is also refused for good: no candidate list, import or sync pairs these two again, and the refusal cannot be undone.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: unpairTransferInput,
	output: z.object({
		transferId: z.string(),
		outflowTransactionId: z.string(),
		inflowTransactionId: z.string(),
		neverPropose: z.boolean().describe("Whether the pair is now refused for good."),
	}),
	run: async (deps, { transferId, neverPropose }) => {
		const undone = await (neverPropose ? rejectTransfer : deleteTransfer)(deps, transferId);

		return {
			result: {
				transferId: undone.id,
				outflowTransactionId: undone.outflowTransactionId,
				inflowTransactionId: undone.inflowTransactionId,
				neverPropose,
			},
			changedRows: 1,
		};
	},
});
