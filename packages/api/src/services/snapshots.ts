import type { SnapshotRejectionCode } from "../domain/balances/snapshot.ts";
import type { FieldError } from "../lib/errors.ts";
import type { SnapshotInput, SnapshotPatchInput } from "../schemas/snapshots.ts";
import type { ServiceDeps } from "./deps.ts";
import type { SnapshotRecord } from "./ledger.ts";

import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { createSnapshotSchema, updateSnapshotSchema } from "../schemas/snapshots.ts";
import { getAccount } from "./accounts.ts";
import * as ledger from "./ledger.ts";

export type SnapshotPage = {
	items: SnapshotRecord[];
	page: number;
	pageSize: number;
	total: number;
};

// The ledger names why it refused a snapshot; the form shows it under the date.
const REJECTION_FIELDS: Record<SnapshotRejectionCode, FieldError> = {
	BEFORE_OPENING_DATE: { path: "date", code: "not_after_opening_date" },
	DATE_IN_FUTURE: { path: "date", code: "date_in_future" },
	SNAPSHOT_EXISTS: { path: "date", code: "snapshot_exists" },
};

function rejectionError(reason: SnapshotRejectionCode): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [REJECTION_FIELDS[reason]]);
}

async function currencyOf(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

async function found(deps: ServiceDeps, id: string): Promise<SnapshotRecord> {
	const record = await ledger.findSnapshot(deps, id);

	if (record === null) {
		throw new AppError("NOT_FOUND", "No snapshot has this id.");
	}

	return record;
}

/** A page of one account's snapshots with their gaps, most recent first. */
export async function listAccountSnapshots(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<SnapshotPage> {
	await getAccount(deps, accountId);
	const { items, total } = await ledger.listSnapshots(deps, accountId, page);

	return { items, page: page.page, pageSize: page.pageSize, total };
}

/** Records the balance the user read at the bank; replaces one on the same date. */
export async function createSnapshot(
	deps: ServiceDeps,
	accountId: string,
	input: SnapshotInput,
): Promise<SnapshotRecord> {
	const currency = await currencyOf(deps, accountId);
	const parsed = createSnapshotSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await ledger.recordSnapshot(deps, accountId, parsed.data, { origin: "user" });

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return found(deps, result.id);
}

/** Moves or changes a snapshot on the user's behalf. */
export async function updateSnapshot(
	deps: ServiceDeps,
	id: string,
	input: SnapshotPatchInput,
): Promise<SnapshotRecord> {
	const current = await found(deps, id);
	const currency = await currencyOf(deps, current.accountId);
	const parsed = updateSnapshotSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await ledger.updateSnapshot(deps, id, parsed.data, { origin: "user" });

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return found(deps, id);
}

/** Deletes a snapshot for good. */
export async function deleteSnapshot(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await ledger.deleteSnapshot(deps, id, { origin: "user" });

	return { id };
}
