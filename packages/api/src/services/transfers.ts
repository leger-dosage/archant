import type { NewTransferInput, TransferRequest } from "../schemas/transfers.ts";
import type { ServiceDeps } from "./deps.ts";
import type { TransferDetails, TransferPatch } from "./ledger/transfer-details.ts";
import type { CreatedTransfer, TransferCandidate, TransferSides } from "./ledger/transfers.ts";

import type { CurrencyCode } from "@archant/data/money";
import type { Transfer } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { newTransferSchema } from "../schemas/transfers.ts";
import { requireAccount, requireEntry, requireTransfer } from "./account-access.ts";
import { currencyOf } from "./accounts.ts";
import { invalidField } from "./ledger/shared.ts";
import {
	setTransferTags as setLedgerTransferTags,
	transferDetails,
	updateTransferDetails,
} from "./ledger/transfer-details.ts";
import {
	confirmTransfer as confirmLedgerTransfer,
	createTransferBetween,
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
	await requireEntry(deps, transactionId);
	return transferCandidates(deps, transactionId);
}

/** Links a transaction and the counterpart the user picked, on the user's behalf. */
export async function createTransfer(deps: ServiceDeps, body: TransferRequest): Promise<Transfer> {
	await requireEntry(deps, body.transactionId, "edit");
	return matchTransfer(deps, body.transactionId, body.counterpartId, { origin: "user" });
}

/** The source account's currency, the amounts' unit; an unknown account is a field error. */
async function sourceCurrency(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	try {
		await requireAccount(deps, accountId, "edit");
		return await currencyOf(deps, accountId);
	} catch (error) {
		if (error instanceof AppError && error.code === "NOT_FOUND") {
			throw invalidField("fromAccountId");
		}

		throw error;
	}
}

/**
 * Creates a transfer between two accounts from « Virement », on the user's
 * behalf: the amount and the fees parsed in the source account's currency.
 */
export async function createTransferBetweenAccounts(
	deps: ServiceDeps,
	body: NewTransferInput,
): Promise<CreatedTransfer> {
	const currency = await sourceCurrency(deps, body.fromAccountId);
	const parsed = newTransferSchema(currency).safeParse(body);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	return createTransferBetween(deps, parsed.data, { origin: "user" });
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
	await requireTransfer(deps, id);
	return transferStatusOf(deps, id);
}

/** Undoes a transfer, both sides becoming standard transactions again. */
export async function deleteTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	await requireTransfer(deps, id, "edit");
	return { id, ...(await unmatchTransfer(deps, id, { origin: "user" })) };
}

/** Undoes a transfer and refuses its pair for good, on the user's behalf. */
export async function rejectTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	await requireTransfer(deps, id, "edit");
	return { id, ...(await rejectLedgerTransfer(deps, id, { origin: "user" })) };
}

/** Confirms a transfer the matcher proposed, on the user's behalf. */
export async function confirmTransfer(deps: ServiceDeps, id: string): Promise<TransferOutcome> {
	await requireTransfer(deps, id, "edit");
	return { id, ...(await confirmLedgerTransfer(deps, id, { origin: "user" })) };
}

/** What the transfer's drawer shows. Reads only. */
export async function getTransfer(deps: ServiceDeps, id: string): Promise<TransferDetails> {
	await requireTransfer(deps, id);
	return transferDetails(deps, id);
}

/** Saves the drawer's category and notes on the user's behalf, then reads the transfer again. */
export async function updateTransfer(
	deps: ServiceDeps,
	id: string,
	patch: TransferPatch,
): Promise<TransferDetails> {
	await requireTransfer(deps, id, "annotate");
	await updateTransferDetails(deps, id, patch, { origin: "user" });

	return transferDetails(deps, id);
}

/** Sets the same tags on both sides on the user's behalf, then reads the transfer again. */
export async function setTransferTags(
	deps: ServiceDeps,
	id: string,
	tagIds: readonly string[],
): Promise<TransferDetails> {
	await requireTransfer(deps, id, "annotate");
	await setLedgerTransferTags(deps, id, tagIds, { origin: "user" });

	return transferDetails(deps, id);
}
