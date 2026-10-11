import type { TransferRequest } from "../schemas/transfers.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TransferCandidate, TransferSides } from "./ledger/transfers.ts";

import type { Transfer } from "@archant/data/types";

import {
	confirmTransfer as confirmLedgerTransfer,
	matchTransfer,
	rejectTransfer as rejectLedgerTransfer,
	transferCandidates,
	transferStatusOf,
	unmatchTransfer,
} from "./ledger/transfers.ts";

/** What the picker lists for a transaction, closest date first. */
export async function listTransferCandidates(
	deps: ServiceDeps,
	transactionId: string,
): Promise<TransferCandidate[]> {
	return transferCandidates(deps, transactionId);
}

/** Links a transaction and the counterpart the user picked, on the user's behalf. */
export async function createTransfer(deps: ServiceDeps, body: TransferRequest): Promise<Transfer> {
	return matchTransfer(deps, body.transactionId, body.counterpartId, { origin: "user" });
}

/** A transfer confirmed or undone, with the two sides it joins or joined. */
type TransferOutcome = TransferSides & { id: string };

/**
 * The status of the transfer `id` names, `undefined` for none: what an
 * assistant's unpair answers the transfer had. Reads only.
 */
export async function getTransferStatus(
	deps: ServiceDeps,
	id: string,
): Promise<Transfer["status"] | undefined> {
	return transferStatusOf(deps, id);
}

/** Undoes a transfer, both sides becoming standard transactions again. */
export async function deleteTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	return { id, ...(await unmatchTransfer(deps, id, { origin: "user" })) };
}

/** Undoes a transfer and refuses its pair for good, on the user's behalf. */
export async function rejectTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	return { id, ...(await rejectLedgerTransfer(deps, id, { origin: "user" })) };
}

/** Confirms a transfer the matcher proposed, on the user's behalf. */
export async function confirmTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	return { id, ...(await confirmLedgerTransfer(deps, id, { origin: "user" })) };
}
