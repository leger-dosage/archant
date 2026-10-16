import type { SnapshotRejectionCode } from "../domain/balances/snapshot.ts";
import type { FieldError } from "../lib/errors.ts";
import type { SnapshotInput, SnapshotPatchInput } from "../schemas/snapshots.ts";
import type { ServiceDeps } from "./deps.ts";
import type {
	ReconciliationDryRun,
	SnapshotRecord,
	ValuationFilter,
	ValuationRecord,
} from "./ledger/snapshots.ts";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { createSnapshotSchema, updateSnapshotSchema } from "../schemas/snapshots.ts";
import { currencyOf, getAccount } from "./accounts.ts";
import {
	deleteSnapshot as deleteLedgerSnapshot,
	findSnapshot,
	listSnapshots,
	listValuations as listLedgerValuations,
	reconciliationDryRun,
	recordSnapshot,
	updateSnapshot as updateLedgerSnapshot,
} from "./ledger/snapshots.ts";

export type SnapshotPage = {
	items: SnapshotRecord[];
	page: number;
	pageSize: number;
	total: number;
};

// The ledger names why it refused a snapshot; the form shows it under the
// date. A snapshot may fall on the opening date, where it sets the opening
// balance.
const REJECTION_FIELDS: Record<SnapshotRejectionCode, FieldError> = {
	DATE_IN_FUTURE: { path: "date", code: "date_in_future" },
	SNAPSHOT_EXISTS: { path: "date", code: "snapshot_exists" },
};

function rejectionError(reason: SnapshotRejectionCode): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [REJECTION_FIELDS[reason]]);
}

async function found(deps: ServiceDeps, id: string): Promise<SnapshotRecord> {
	const record = await findSnapshot(deps, id);

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
	const { items, total } = await listSnapshots(deps, accountId, page);

	return { items, page: page.page, pageSize: page.pageSize, total };
}

/**
 * A page of valuations, anchors included, of every active account or the one
 * named, as Sure's `get_valuations`: an unknown account is `NOT_FOUND`.
 */
export async function listValuations(
	deps: ServiceDeps,
	filter: ValuationFilter,
	page: { page: number; pageSize: number },
): Promise<{ items: ValuationRecord[]; page: number; pageSize: number; total: number }> {
	if (filter.accountId !== undefined) {
		await getAccount(deps, filter.accountId);
	}

	const { items, total } = await listLedgerValuations(deps, filter, page);

	return { items, page: page.page, pageSize: page.pageSize, total };
}

/** What recording a snapshot answers: whether it replaced one already on its date. */
type RecordedSnapshot = SnapshotRecord & { replacedExisting: boolean };

/**
 * Records the balance the user read at the bank; replaces one on the same
 * date, keeping its notes. `source`, an assistant's parsed citation, is
 * appended to them, as Sure's `record_valuation` does.
 */
export async function createSnapshot(
	deps: ServiceDeps,
	accountId: string,
	input: SnapshotInput,
	cited: { source?: string } = {},
): Promise<RecordedSnapshot> {
	const currency = await currencyOf(deps, accountId);
	const parsed = createSnapshotSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await recordSnapshot(
		deps,
		accountId,
		{ ...parsed.data, source: cited.source },
		{ origin: "user" },
	);

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return { ...(await found(deps, result.id)), replacedExisting: result.replaced };
}

/**
 * What recording `input` would set, written nowhere: Sure's `confirm_create`
 * and `confirm_update`, which every balance form shows before it saves. The
 * amount and the date's format are checked, not the ledger's refusals, as
 * Sure's `prepare_reconciliation` checks nothing; those come with the save.
 * Its route is a POST, as Sure's, so `viewerReadOnly` refuses a viewer as
 * Sure's `require_account_permission!` does.
 */
export async function dryRunSnapshot(
	deps: ServiceDeps,
	accountId: string,
	input: SnapshotInput,
): Promise<ReconciliationDryRun> {
	const currency = await currencyOf(deps, accountId);
	const parsed = createSnapshotSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	return reconciliationDryRun(deps, accountId, parsed.data);
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

	const result = await updateLedgerSnapshot(deps, id, parsed.data, { origin: "user" });

	if (result.status === "rejected") {
		throw rejectionError(result.reason);
	}

	return found(deps, id);
}

/** Deletes a snapshot for good. */
export async function deleteSnapshot(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await deleteLedgerSnapshot(deps, id, { origin: "user" });

	return { id };
}
