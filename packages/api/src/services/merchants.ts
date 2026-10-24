import type { MerchantRequest } from "../schemas/merchants.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq, inArray } from "drizzle-orm";

import { sampleCategoryColor } from "@archant/data/category-presets";
import { merchants } from "@archant/data/schema/merchants";
import type { Merchant } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { countByMerchant, moveMerchant } from "./ledger/edits.ts";
import { oneByOne } from "./ledger/shared.ts";
import { assertNameFree } from "./names.ts";

export type MerchantSummary = {
	id: string;
	name: string;
	color: string;
	websiteUrl: string | null;
	transactionCount: number;
};

type Db = ServiceDeps["db"];

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const notFound = () => new AppError("NOT_FOUND", "No merchant has this id.");

const invalid = (path: string, code: string) =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);

function summarise(merchant: Merchant, counts: Map<string, number>): MerchantSummary {
	return {
		id: merchant.id,
		name: merchant.name,
		color: merchant.color,
		websiteUrl: merchant.websiteUrl,
		transactionCount: counts.get(merchant.id) ?? 0,
	};
}

/**
 * Every merchant with its transaction count, sorted by name as a French
 * reader expects. The whole set, not a page: the interface resolves each
 * row's merchant name from it, as it does for categories.
 */
export async function listMerchants(deps: ServiceDeps): Promise<MerchantSummary[]> {
	const [rows, counts] = await Promise.all([
		deps.db.select().from(merchants),
		countByMerchant(deps),
	]);

	return rows
		.map((row) => summarise(row, counts))
		.toSorted((a, b) => byName.compare(a.name, b.name));
}

async function findMerchant(db: Db, id: string): Promise<Merchant | undefined> {
	return db.select().from(merchants).where(eq(merchants.id, id)).get();
}

async function getMerchant(deps: ServiceDeps, id: string): Promise<MerchantSummary> {
	const row = await findMerchant(deps.db, id);

	if (row === undefined) {
		throw notFound();
	}

	return summarise(row, await countByMerchant(deps));
}

export async function createMerchant(
	deps: ServiceDeps,
	input: MerchantRequest,
): Promise<MerchantSummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, merchants, input.name, null);
			const now = Date.now();

			await tx.insert(merchants).values({
				id,
				name: input.name,
				color: input.color ?? sampleCategoryColor(),
				websiteUrl: input.websiteUrl ?? null,
				createdAt: now,
				updatedAt: now,
			});
		},
		{ behavior: "immediate" },
	);

	return getMerchant(deps, id);
}

/** Renames a merchant, and recolours it or changes its website when given. */
export async function updateMerchant(
	deps: ServiceDeps,
	id: string,
	input: MerchantRequest,
): Promise<MerchantSummary> {
	await deps.db.transaction(
		async (tx) => {
			if ((await findMerchant(tx, id)) === undefined) {
				throw notFound();
			}

			await assertNameFree(tx, merchants, input.name, id);
			await tx
				.update(merchants)
				.set({
					name: input.name,
					...(input.color === undefined ? {} : { color: input.color }),
					...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
					updatedAt: Date.now(),
				})
				.where(eq(merchants.id, id));
		},
		{ behavior: "immediate" },
	);

	return getMerchant(deps, id);
}

/**
 * Deletes a merchant after unlinking its transactions, which keep their
 * locks, and returns how many lost it. One transaction for both.
 */
export async function deleteMerchant(
	deps: ServiceDeps,
	id: string,
): Promise<{ id: string; unlinked: number }> {
	return deps.db.transaction(
		async (tx) => {
			if ((await findMerchant(tx, id)) === undefined) {
				throw notFound();
			}

			const unlinked = await moveMerchant({ ...deps, db: tx }, id, null, {
				origin: "maintenance",
			});
			await tx.delete(merchants).where(eq(merchants.id, id));

			return { id, unlinked };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Merges `sourceIds` into `targetId`, as Sure's `Merchant::Merger`: each
 * source's transactions move to the target, keeping their locks, then the
 * sources go, their recurring series with them, as a single delete does:
 * the next detection finds the target's. Refused before any write when the
 * target is among the sources. Returns the target and how many merchants went.
 */
export async function mergeMerchants(
	deps: ServiceDeps,
	targetId: string,
	sourceIds: readonly string[],
): Promise<{ target: MerchantSummary; merged: number }> {
	const ids = [...new Set(sourceIds)];

	await deps.db.transaction(
		async (tx) => {
			if ((await findMerchant(tx, targetId)) === undefined) {
				throw invalid("targetId", "invalid_value");
			}

			if (ids.includes(targetId)) {
				throw invalid("sourceIds", "same_merchant");
			}

			const found = await tx
				.select({ id: merchants.id })
				.from(merchants)
				.where(inArray(merchants.id, ids));

			if (found.length !== ids.length) {
				throw invalid("sourceIds", "invalid_value");
			}

			await oneByOne(ids, async (id) =>
				moveMerchant({ ...deps, db: tx }, id, targetId, { origin: "maintenance" }),
			);
			await tx.delete(merchants).where(inArray(merchants.id, ids));
		},
		{ behavior: "immediate" },
	);

	return { target: await getMerchant(deps, targetId), merged: ids.length };
}
