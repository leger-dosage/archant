import type { TransferRequest } from "../schemas/transfers.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TransferCandidate } from "./ledger.ts";

import type { Transfer } from "@archant/data/types";

import * as ledger from "./ledger.ts";

/** What the picker lists for a transaction, closest date first. */
export async function listTransferCandidates(
	deps: ServiceDeps,
	transactionId: string,
): Promise<TransferCandidate[]> {
	return ledger.transferCandidates(deps, transactionId);
}

/** Links a transaction and the counterpart the user picked, on the user's behalf. */
export async function createTransfer(deps: ServiceDeps, body: TransferRequest): Promise<Transfer> {
	return ledger.matchTransfer(deps, body.transactionId, body.counterpartId, { origin: "user" });
}

/** Undoes a transfer, both sides becoming standard transactions again. */
export async function deleteTransfer(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await ledger.unmatchTransfer(deps, id, { origin: "user" });

	return { id };
}
