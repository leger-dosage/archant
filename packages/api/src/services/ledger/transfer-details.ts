import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transferFees } from "@archant/data/schema/transfer-fees";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind, TransferStatus } from "@archant/data/transfer-kinds";
import { takesCategory } from "@archant/data/transfer-kinds";

import { AppError } from "../../lib/errors.ts";
import {
	categoryExists,
	changeOf,
	detailOf,
	stampedLocks,
	tagIdsOf,
	tagsExist,
	transactionRow,
} from "./patch.ts";
import { invalidField, isSplitChild, oneByOne, refuseSplit } from "./shared.ts";

/** One side of a transfer as its drawer shows it. */
type TransferSideDetails = {
	transactionId: string;
	accountId: string;
	accountName: string;
	accountType: AccountType;
	date: IsoDate;
	/** Signed as the entry: below zero on the outflow, above on the inflow. */
	amount: MinorUnits;
	currency: string;
	/** The transfer's fee lines on this side's account, as a positive magnitude. */
	fee: MinorUnits;
};

/** What Sure's `transfers/show.html.erb` shows of a transfer. */
export type TransferDetails = {
	id: string;
	kind: TransferKind;
	status: TransferStatus;
	notes: string | null;
	/** Sure's `categorizable?`: whether « Catégorie » applies to the outflow. */
	categorizable: boolean;
	/** The outflow's category, the one the drawer sets. */
	categoryId: string | null;
	/** The outflow's tags, which the drawer sets on both sides at once. */
	tagIds: string[];
	outflow: TransferSideDetails;
	inflow: TransferSideDetails;
};

async function transferRow(db: Pick<Transaction, "select">, transferId: string) {
	const row = await db.select().from(transfers).where(eq(transfers.id, transferId)).get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transfer has this id.");
	}

	return row;
}

const feeEntry = alias(entries, "fee_entry");

/**
 * A transfer with both sides, the sum of its fee lines on each side's account,
 * as Sure's `derived_source_fee_amount` and `derived_destination_fee_amount`,
 * and the outflow's category and tags. Throws `NOT_FOUND` for an unknown id.
 */
export async function transferDetails(
	deps: ServiceDeps,
	transferId: string,
): Promise<TransferDetails> {
	return deps.db.transaction(async (tx) => {
		// A fee line is an expense, below zero; the drawer shows its magnitude.
		const fee = tx
			.select({ total: sql<number>`coalesce(-sum(${feeEntry.amount}), 0)` })
			.from(transferFees)
			.innerJoin(feeEntry, eq(feeEntry.id, transferFees.transactionId))
			.where(
				and(eq(transferFees.transferId, transfers.id), eq(feeEntry.accountId, entries.accountId)),
			);
		// The outflow first, its amount below zero.
		const rows = await tx
			.select({
				kind: transfers.kind,
				status: transfers.status,
				notes: transfers.notes,
				categoryId: transactions.categoryId,
				side: {
					transactionId: entries.id,
					accountId: entries.accountId,
					accountName: accounts.name,
					accountType: accounts.type,
					date: entries.date,
					amount: entries.amount,
					currency: entries.currency,
					fee: sql<number>`(${fee})`,
				},
			})
			.from(transfers)
			.innerJoin(
				entries,
				or(
					eq(entries.id, transfers.outflowTransactionId),
					eq(entries.id, transfers.inflowTransactionId),
				),
			)
			.innerJoin(accounts, eq(accounts.id, entries.accountId))
			.innerJoin(transactions, eq(transactions.entryId, entries.id))
			.where(eq(transfers.id, transferId))
			.orderBy(entries.amount);

		const [outflow, inflow] = rows;

		if (outflow === undefined || inflow === undefined) {
			throw new AppError("NOT_FOUND", "No transfer has this id.");
		}

		const side = ({ side: row }: typeof outflow): TransferSideDetails => ({
			...row,
			amount: toMinorUnits(row.amount),
			fee: toMinorUnits(row.fee),
		});

		return {
			id: transferId,
			kind: outflow.kind,
			status: outflow.status,
			notes: outflow.notes,
			categorizable: takesCategory(outflow.kind),
			categoryId: outflow.categoryId,
			tagIds: await tagIdsOf(tx, outflow.side.transactionId),
			outflow: side(outflow),
			inflow: side(inflow),
		};
	});
}

/** An absent or `undefined` field is left as it is. */
export type TransferPatch = {
	/** `null` leaves the outflow « Non classé ». */
	categoryId?: string | null | undefined;
	/** `null` clears the notes. */
	notes?: string | null | undefined;
};

/**
 * Sure's `transfers#update` from the drawer: the category on the outflow, only
 * when the kind takes one (`categorizable?`), locked as any category saved by
 * hand (AD-10), and the transfer's own notes. Throws `NOT_FOUND` for an
 * unknown id; a category on a kind that takes none is `not_categorizable` on
 * `categoryId`.
 */
export async function updateTransferDetails(
	deps: ServiceDeps,
	transferId: string,
	patch: TransferPatch,
	options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const transfer = await transferRow(tx, transferId);

			if (patch.categoryId !== undefined) {
				if (!takesCategory(transfer.kind)) {
					throw invalidField("categoryId", "not_categorizable");
				}

				const outflowId = transfer.outflowTransactionId;
				const change = changeOf(
					await transactionRow(tx, outflowId),
					{ categoryId: patch.categoryId },
					options.origin,
				);

				if (change.changed.includes("category")) {
					// A split line's category is its split's (AD-20).
					await refuseSplit(tx, [outflowId], isSplitChild);

					if (patch.categoryId !== null && !(await categoryExists(tx, patch.categoryId))) {
						throw invalidField("categoryId");
					}

					await tx
						.update(transactions)
						.set(detailOf(change, options.origin, Date.now()))
						.where(eq(transactions.entryId, outflowId));
				}
			}

			if (patch.notes !== undefined) {
				await tx.update(transfers).set({ notes: patch.notes }).where(eq(transfers.id, transferId));
			}
		},
		{ behavior: "immediate" },
	);
}

/**
 * Sure's `transfers#update_tags`: the same tags on both sides, replacing each
 * set, and `tags` locked on both by a user write, as its `lock_attr!(:tag_ids)`.
 * Throws `NOT_FOUND` for an unknown id; an unknown tag is a field error on
 * `tagIds`.
 */
export async function setTransferTags(
	deps: ServiceDeps,
	transferId: string,
	tagIds: readonly string[],
	options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const transfer = await transferRow(tx, transferId);

			if (tagIds.length > 0 && !(await tagsExist(tx, [...new Set(tagIds)]))) {
				throw invalidField("tagIds");
			}

			const now = Date.now();

			await oneByOne(
				[transfer.outflowTransactionId, transfer.inflowTransactionId],
				async (entryId) => {
					const { next, changed } = changeOf(
						await transactionRow(tx, entryId),
						{ tagIds },
						options.origin,
					);

					if (changed.includes("tags")) {
						await tx.delete(taggings).where(eq(taggings.transactionId, entryId));

						if (next.tagIds.length > 0) {
							await tx
								.insert(taggings)
								.values(next.tagIds.map((tagId) => ({ transactionId: entryId, tagId })));
						}
					}

					// Both sides lock, the one whose tags were already these included.
					if (options.origin === "user") {
						await tx
							.update(transactions)
							.set({ lockedFields: stampedLocks(["tags"], now) })
							.where(eq(transactions.entryId, entryId));
					}
				},
			);
		},
		{ behavior: "immediate" },
	);
}
