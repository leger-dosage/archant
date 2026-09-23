import type { MerchantRequest } from "../schemas/merchants.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { merchants } from "@archant/data/schema/merchants";
import type { Merchant } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { countByMerchant, moveMerchant } from "./ledger.ts";

export type MerchantSummary = {
	id: string;
	name: string;
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

/**
 * Refuses a name another merchant holds, ignoring case. Compared here with a
 * locale-aware fold, since SQLite's `lower` in the unique index folds ASCII
 * only and would let « épicerie » beside « Épicerie ».
 */
async function assertNameFree(db: Db, name: string, ownId: string | null): Promise<void> {
	const folded = name.toLocaleLowerCase("fr");
	const rows = await db.select({ id: merchants.id, name: merchants.name }).from(merchants);

	if (rows.some((row) => row.id !== ownId && row.name.toLocaleLowerCase("fr") === folded)) {
		throw invalid("name", "name_taken");
	}
}

export async function createMerchant(
	deps: ServiceDeps,
	input: MerchantRequest,
): Promise<MerchantSummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, input.name, null);
			const now = Date.now();

			await tx.insert(merchants).values({ id, name: input.name, createdAt: now, updatedAt: now });
		},
		{ behavior: "immediate" },
	);

	return getMerchant(deps, id);
}

export async function renameMerchant(
	deps: ServiceDeps,
	id: string,
	input: MerchantRequest,
): Promise<MerchantSummary> {
	await deps.db.transaction(
		async (tx) => {
			if ((await findMerchant(tx, id)) === undefined) {
				throw notFound();
			}

			await assertNameFree(tx, input.name, id);
			await tx
				.update(merchants)
				.set({ name: input.name, updatedAt: Date.now() })
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
 * Merges a merchant into `targetId`: its transactions move to the target,
 * keeping their locks, then it is deleted. Returns the target.
 */
export async function mergeMerchant(
	deps: ServiceDeps,
	id: string,
	targetId: string,
): Promise<MerchantSummary> {
	await deps.db.transaction(
		async (tx) => {
			if ((await findMerchant(tx, id)) === undefined) {
				throw notFound();
			}

			if (targetId === id || (await findMerchant(tx, targetId)) === undefined) {
				throw invalid("targetId", "invalid_value");
			}

			await moveMerchant({ ...deps, db: tx }, id, targetId, { origin: "maintenance" });
			await tx.delete(merchants).where(eq(merchants.id, id));
		},
		{ behavior: "immediate" },
	);

	return getMerchant(deps, targetId);
}
