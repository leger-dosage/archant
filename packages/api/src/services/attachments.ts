import type { ServiceDeps } from "./deps.ts";
import type { AttachmentFile, AttachmentItem } from "./ledger/attachments.ts";

import { MAX_ATTACHMENT_BYTES } from "@archant/data/attachments";

import { attachmentFileName, attachmentTypeOf } from "../domain/attachment-files.ts";
import { AppError } from "../lib/errors.ts";
import { requireEntry } from "./account-access.ts";
import {
	addAttachment,
	deleteAttachment,
	listAttachments,
	readAttachment,
} from "./ledger/attachments.ts";

/** A refusal of the uploaded file, shown under the sheet's list with the file's name. */
export function refusedFile(code: "attachment_too_large" | "attachment_type"): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path: "file", code }]);
}

/**
 * Attaches an uploaded file to a transaction, as Sure's
 * `TransactionAttachmentsController#create`. Its type is read from its first
 * bytes, whatever the client declared, and its name cleaned. Throws
 * `VALIDATION_ERROR` on `file`: `attachment_too_large` past 10 MiB,
 * `attachment_type` for an empty file or any other type, `attachment_limit`
 * past ten files; `NOT_FOUND` for an unknown transaction.
 */
export async function uploadAttachment(
	deps: ServiceDeps,
	transactionId: string,
	file: { name: string; bytes: Uint8Array },
): Promise<AttachmentItem> {
	await requireEntry(deps, transactionId, "annotate");
	if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
		throw refusedFile("attachment_too_large");
	}

	const contentType = attachmentTypeOf(file.bytes);

	if (contentType === null) {
		throw refusedFile("attachment_type");
	}

	return addAttachment(
		deps,
		transactionId,
		{ filename: attachmentFileName(file.name), contentType, bytes: file.bytes },
		{ origin: "user" },
	);
}

export async function listTransactionAttachments(
	deps: ServiceDeps,
	transactionId: string,
): Promise<AttachmentItem[]> {
	await requireEntry(deps, transactionId, "read");
	return listAttachments(deps, transactionId);
}

export async function getAttachmentFile(
	deps: ServiceDeps,
	transactionId: string,
	attachmentId: string,
): Promise<AttachmentFile> {
	await requireEntry(deps, transactionId, "read");
	return readAttachment(deps, transactionId, attachmentId);
}

export async function removeAttachment(
	deps: ServiceDeps,
	transactionId: string,
	attachmentId: string,
): Promise<{ id: string }> {
	await requireEntry(deps, transactionId, "annotate");
	await deleteAttachment(deps, transactionId, attachmentId, { origin: "user" });

	return { id: attachmentId };
}
