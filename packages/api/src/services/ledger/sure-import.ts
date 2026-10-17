import type { IsoDate } from "../../domain/dates.ts";
import type { PlanAccount, PlanSecurity, PlanTransaction, SurePlan } from "../sure-import-plan.ts";
import type { Transaction } from "./shared.ts";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { costBasisLocks } from "@archant/data/schema/holdings";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { taggings } from "@archant/data/schema/taggings";
import { trades } from "@archant/data/schema/trades";
import type { LockableField, LockedFields } from "@archant/data/schema/transactions";
import { LOCKABLE_FIELDS, transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { NewEntry } from "@archant/data/types";
import type { Account } from "@archant/data/types";

import { minDate } from "../../domain/dates.ts";
import { transferKindOf } from "../../domain/transfer-matching.ts";
import { AppError } from "../../lib/errors.ts";
import { recomputeBalances } from "./balances.ts";
import { ROWS_PER_INSERT, inSequence, lockedBy, oneByOne } from "./shared.ts";
import { clearOneTime } from "./transfers.ts";

// What a Sure archive writes to the ledger's tables (AD-2): bulk inserts,
// then one balance recompute per new account, as Sure's importer saves rows
// and its sync computes the balances once afterwards. Every row is new and
// every id fresh; the archive's ids map to them per type.

/** Rows a few hundred at a time, as every bulk write of the ledger. */
const insertAll = async <Row>(rows: readonly Row[], write: (chunk: Row[]) => Promise<unknown>) =>
	inSequence(rows, ROWS_PER_INSERT, write);

/**
 * Creation times one millisecond apart from `now`, in the archive's order,
 * so the list and the cost basis read rows in the order they came, as Sure
 * orders a day's rows by creation.
 */
function clock(now: number) {
	let next = now;

	return () => next++;
}

type Clock = ReturnType<typeof clock>;

export type ImportedAccount = Pick<Account, "id" | "type" | "currency">;

/**
 * Inserts the archive's accounts as `createAccount` writes them, unlinked,
 * each with its opening anchor; their balances wait for
 * `insertSureEntries`. Returns each account by its archive id.
 */
export async function insertSureAccounts(
	tx: Transaction,
	plan: readonly PlanAccount[],
	now: number,
): Promise<Map<string, ImportedAccount>> {
	const stamp = clock(now);
	const rows = plan.map((account) => {
		const at = stamp();

		return {
			sourceId: account.sourceId,
			opening: account.opening,
			row: {
				id: crypto.randomUUID(),
				name: account.name,
				type: account.type,
				subtype: account.subtype,
				currency: account.currency,
				details: account.details,
				active: account.active,
				excludedFromReports: account.excludedFromReports,
				bankAccountId: null,
				institutionName: account.institutionName,
				institutionDomain: account.institutionDomain,
				notes: account.notes,
				createdAt: at,
				updatedAt: at,
			} satisfies Account,
		};
	});

	await insertAll(rows, (chunk) => tx.insert(accounts).values(chunk.map(({ row }) => row)));
	await insertAll(rows, (chunk) =>
		tx.insert(entries).values(
			chunk.map(({ row, opening }) => ({
				id: crypto.randomUUID(),
				accountId: row.id,
				kind: "valuation" as const,
				valuationKind: "opening_anchor" as const,
				date: opening.date,
				amount: opening.amount,
				currency: row.currency,
				createdAt: row.createdAt,
				updatedAt: row.createdAt,
			})),
		),
	);

	return new Map(
		rows.map(({ sourceId, row }) => [
			sourceId,
			{ id: row.id, type: row.type, currency: row.currency },
		]),
	);
}

/** The new ids of the rows an archive's lines name, per type. */
export type SureIds = {
	accounts: ReadonlyMap<string, ImportedAccount>;
	categories: ReadonlyMap<string, string>;
	tags: ReadonlyMap<string, string>;
	merchants: ReadonlyMap<string, string>;
};

/** A transaction written, as transfers and conversions check it. */
type Written = {
	id: string;
	accountId: string;
	type: AccountType;
	amount: MinorUnits;
	inSplit: boolean;
};

/** The locks of Archant's own export, the fields the ledger knows only (AD-10). */
function knownLocks(locks: Readonly<Record<string, number | null>>): LockedFields {
	return Object.fromEntries(
		Object.entries(locks).flatMap(([field, at]) => {
			const known = LOCKABLE_FIELDS.find((lockable) => lockable === field);

			return known === undefined ? [] : [[known, at]];
		}),
	);
}

const mapped = (ids: ReadonlyMap<string, string>, sourceId: string | null) =>
	sourceId === null ? null : (ids.get(sourceId) ?? null);

function tagIdsOf(ids: SureIds, sourceIds: readonly string[]): string[] {
	return [...new Set(sourceIds.flatMap((sourceId) => ids.tags.get(sourceId) ?? []))];
}

/**
 * Transactions and their split lines, as the ledger writes them: a split
 * becomes a parent, excluded and locked, and its lines children as
 * `services/ledger/splits.ts` writes them, a line without tags taking its
 * parent's. Returns every transaction written by its archive id.
 */
async function insertTransactions(
	tx: Transaction,
	plan: readonly PlanTransaction[],
	ids: SureIds,
	stamp: Clock,
	options: { now: number },
): Promise<Map<string, Written>> {
	const written = new Map<string, Written>();
	const entryRows: NewEntry[] = [];
	const childEntryRows: NewEntry[] = [];
	const transactionRows: (typeof transactions.$inferInsert)[] = [];
	const tagRows: (typeof taggings.$inferInsert)[] = [];

	for (const row of plan) {
		const account = ids.accounts.get(row.accountSourceId);

		if (account === undefined) {
			continue;
		}

		const id = crypto.randomUUID();
		const at = stamp();
		const split = row.splitLines.length > 0;
		const categoryId = mapped(ids.categories, row.categorySourceId);
		const merchantId = mapped(ids.merchants, row.merchantSourceId);
		const tagIds = tagIdsOf(ids, row.tagSourceIds);

		written.set(row.sourceId, {
			id,
			accountId: account.id,
			type: account.type,
			amount: row.amount,
			inSplit: split,
		});
		entryRows.push({
			id,
			accountId: account.id,
			kind: "transaction",
			date: row.date,
			amount: row.amount,
			currency: account.currency,
			createdAt: at,
			updatedAt: at,
		});
		transactionRows.push({
			entryId: id,
			label: row.label,
			notes: row.notes,
			reference: row.reference,
			excluded: split || row.excluded,
			oneTime: row.oneTime,
			possibleDuplicate: row.possibleDuplicate,
			pending: row.pending,
			// A split's parent is locked excluded, at the time the export kept when it has one.
			lockedFields:
				split && !Object.hasOwn(row.lockedFields, "excluded")
					? lockedBy("user", knownLocks(row.lockedFields), ["excluded"], options.now)
					: knownLocks(row.lockedFields),
			categoryId,
			categoryOrigin: categoryId === null ? null : row.categoryOrigin,
			merchantId,
			investmentActivityLabel: row.investmentActivityLabel,
		});
		tagRows.push(...tagIds.map((tagId) => ({ transactionId: id, tagId })));

		for (const line of row.splitLines) {
			const childId = crypto.randomUUID();
			const childAt = stamp();
			const childCategory = mapped(ids.categories, line.categorySourceId);
			const childTags = line.tagSourceIds === null ? tagIds : tagIdsOf(ids, line.tagSourceIds);
			const filled: LockableField[] = [
				"date",
				"amount",
				"label",
				"excluded",
				...(line.notes === null ? [] : ["notes" as const]),
				...(childCategory === null ? [] : ["category" as const]),
				...(childTags.length === 0 ? [] : ["tags" as const]),
			];

			if (line.sourceId !== null) {
				written.set(line.sourceId, {
					id: childId,
					accountId: account.id,
					type: account.type,
					amount: line.amount,
					inSplit: true,
				});
			}

			childEntryRows.push({
				id: childId,
				accountId: account.id,
				kind: "transaction",
				date: row.date,
				amount: line.amount,
				currency: account.currency,
				parentEntryId: id,
				createdAt: childAt,
				updatedAt: childAt,
			});
			transactionRows.push({
				entryId: childId,
				label: line.label,
				notes: line.notes,
				oneTime: row.oneTime || line.oneTime,
				merchantId:
					line.merchantSourceId === undefined
						? merchantId
						: mapped(ids.merchants, line.merchantSourceId),
				categoryId: childCategory,
				categoryOrigin: childCategory === null ? null : "user",
				lockedFields:
					line.lockedFields === null
						? lockedBy("user", {}, filled, options.now)
						: knownLocks(line.lockedFields),
			});
			tagRows.push(...childTags.map((tagId) => ({ transactionId: childId, tagId })));
		}
	}

	// Parents before their lines, which their foreign key restricts.
	await insertAll(entryRows, (chunk) => tx.insert(entries).values(chunk));
	await insertAll(childEntryRows, (chunk) => tx.insert(entries).values(chunk));
	await insertAll(transactionRows, (chunk) => tx.insert(transactions).values(chunk));
	await insertAll(tagRows, (chunk) => tx.insert(taggings).values(chunk));

	return written;
}

/**
 * Transfers, their kind from `archant.kind`, else from the two accounts as
 * `transferKindOf` reads them; a pair already in a transfer, on one account,
 * with a side missing or in a split (AD-20), is skipped. Both sides lose
 * `one_time`, as Sure's `Transfer::Creator` overwrites the kind. Then the
 * rejected pairs whose two sides came across.
 */
async function insertTransfers(
	tx: Transaction,
	plan: SurePlan,
	written: ReadonlyMap<string, Written>,
	stamp: Clock,
): Promise<ReadonlySet<string>> {
	const used = new Set<string>();
	const rows: (typeof transfers.$inferInsert)[] = [];

	for (const transfer of plan.transfers) {
		const outflow = written.get(transfer.outflowSourceId);
		const inflow = written.get(transfer.inflowSourceId);

		if (
			outflow === undefined ||
			inflow === undefined ||
			outflow.accountId === inflow.accountId ||
			// Archant's sign (AD-5): money leaves by the outflow and reaches the inflow.
			outflow.amount >= 0 ||
			inflow.amount <= 0 ||
			outflow.inSplit ||
			inflow.inSplit ||
			used.has(outflow.id) ||
			used.has(inflow.id)
		) {
			continue;
		}

		used.add(outflow.id);
		used.add(inflow.id);
		rows.push({
			id: crypto.randomUUID(),
			outflowTransactionId: outflow.id,
			inflowTransactionId: inflow.id,
			kind: transfer.kind ?? transferKindOf(inflow.type, outflow.type),
			status: transfer.status,
			createdAt: stamp(),
		});
	}

	await insertAll(rows, (chunk) => tx.insert(transfers).values(chunk));
	await clearOneTime(tx, [...used]);

	const pairs = new Set<string>();
	const rejected: (typeof rejectedTransfers.$inferInsert)[] = [];

	for (const pair of plan.rejectedTransfers) {
		const outflow = written.get(pair.outflowSourceId)?.id;
		const inflow = written.get(pair.inflowSourceId)?.id;
		const key = `${outflow} ${inflow}`;

		if (outflow !== undefined && inflow !== undefined && outflow !== inflow && !pairs.has(key)) {
			pairs.add(key);
			rejected.push({
				id: crypto.randomUUID(),
				outflowTransactionId: outflow,
				inflowTransactionId: inflow,
				createdAt: stamp(),
			});
		}
	}

	await insertAll(rejected, (chunk) => tx.insert(rejectedTransfers).values(chunk));

	return used;
}

const securityColumns = { id: securities.id, currency: securities.currency };

/**
 * The stored security a line names: a listing by its upper-cased ticker and
 * MIC, as the unique index compares them, else by ISIN; one typed by hand by
 * its ISIN, else by its name among those with neither.
 */
async function existingSecurity(tx: Transaction, security: PlanSecurity) {
	if (!security.byHand) {
		const listed = await tx
			.select(securityColumns)
			.from(securities)
			.where(
				and(
					sql`upper(${securities.ticker}) = ${security.ticker}`,
					sql`coalesce(${securities.mic}, '') = ${security.mic ?? ""}`,
				),
			)
			.get();

		if (listed !== undefined) {
			return listed;
		}
	}

	if (security.isin !== null) {
		return tx
			.select(securityColumns)
			.from(securities)
			.where(eq(securities.isin, security.isin))
			.orderBy(asc(securities.createdAt), asc(securities.id))
			.get();
	}

	return security.byHand
		? tx
				.select(securityColumns)
				.from(securities)
				.where(
					and(
						isNull(securities.ticker),
						isNull(securities.isin),
						eq(securities.name, security.name),
					),
				)
				.orderBy(asc(securities.createdAt), asc(securities.id))
				.get()
		: undefined;
}

/**
 * Finds or creates each security once per archive, in the account's currency
 * (AD-6): a listing priced by Yahoo, or one typed by hand. A security found
 * in another currency than the account's fails the import, as a trade the
 * form would refuse.
 */
function securityResolver(tx: Transaction, stamp: Clock) {
	const found = new Map<string, { id: string; currency: string }>();

	return async (security: PlanSecurity, currency: string): Promise<string> => {
		const known = found.get(security.key) ?? (await existingSecurity(tx, security));

		if (known === undefined) {
			const at = stamp();
			const row = {
				id: crypto.randomUUID(),
				isin: security.isin,
				ticker: security.byHand ? null : security.ticker,
				mic: security.byHand ? null : security.mic,
				name: security.name,
				currency,
				provider: security.byHand ? null : ("yahoo" as const),
				createdAt: at,
				updatedAt: at,
			};

			await tx.insert(securities).values(row);
			found.set(security.key, row);

			return row.id;
		}

		if (known.currency !== currency) {
			throw new AppError(
				"SURE_IMPORT_INVALID",
				"A security of the archive is priced in another currency than its account.",
			);
		}

		found.set(security.key, known);

		return known.id;
	};
}

/**
 * Trades, then what the `Holding` lines carry that Archant keeps: each day's
 * price of a security with none stored, and a cost basis the owner locked,
 * from the position's first locked day. The holdings themselves are derived
 * by the recompute, as Sure's sync computes them again after its import.
 */
async function insertTradesAndHoldings(
	tx: Transaction,
	plan: SurePlan,
	ids: SureIds,
	written: ReadonlyMap<string, Written>,
	transferSides: ReadonlySet<string>,
	stamp: Clock,
): Promise<void> {
	const resolve = securityResolver(tx, stamp);
	const parents = new Set<string>();
	const entryRows: NewEntry[] = [];
	const tradeRows: (typeof trades.$inferInsert)[] = [];

	await oneByOne(plan.trades, async (trade) => {
		const account = ids.accounts.get(trade.accountSourceId);

		if (account === undefined) {
			return;
		}

		const id = crypto.randomUUID();
		const at = stamp();
		const parent = trade.parentSourceId === null ? undefined : written.get(trade.parentSourceId);
		// One trade per converted transaction, never a transfer side (AD-22).
		const converted =
			parent !== undefined &&
			parent.accountId === account.id &&
			!parent.inSplit &&
			!transferSides.has(parent.id) &&
			!parents.has(parent.id);

		if (converted) {
			parents.add(parent.id);
		}

		entryRows.push({
			id,
			accountId: account.id,
			kind: "trade",
			date: trade.date,
			amount: trade.amount,
			currency: account.currency,
			// The transaction converted into it, when it came across whole.
			parentEntryId: converted ? parent.id : null,
			createdAt: at,
			updatedAt: at,
		});
		tradeRows.push({
			entryId: id,
			securityId: trade.security === null ? null : await resolve(trade.security, account.currency),
			incomeKind: trade.incomeKind,
			quantity: trade.quantity,
			price: trade.price,
			fee: trade.fee,
		});
	});

	await insertAll(entryRows, (chunk) => tx.insert(entries).values(chunk));
	await insertAll(tradeRows, (chunk) => tx.insert(trades).values(chunk));

	const prices: (typeof securityPrices.$inferInsert)[] = [];
	const locks = new Map<string, typeof costBasisLocks.$inferInsert>();

	await oneByOne(plan.holdings, async (holding) => {
		const account = ids.accounts.get(holding.accountSourceId);

		if (account === undefined) {
			return;
		}

		const securityId = await resolve(holding.security, account.currency);

		if (holding.price > 0) {
			prices.push({
				securityId,
				date: holding.date,
				price: holding.price,
				currency: account.currency,
				provisional: false,
				source: "provider",
			});
		}

		const key = `${account.id} ${securityId}`;
		const lock = locks.get(key);

		if (holding.lockedCostBasis !== null && (lock === undefined || holding.date < lock.lockedOn)) {
			locks.set(key, {
				accountId: account.id,
				securityId,
				costBasis: holding.lockedCostBasis,
				lockedOn: holding.date,
			});
		}
	});

	// A price already stored, the provider's or the owner's, stays.
	await insertAll(prices, (chunk) => tx.insert(securityPrices).values(chunk).onConflictDoNothing());
	await insertAll([...locks.values()], (chunk) => tx.insert(costBasisLocks).values(chunk));
}

/**
 * Writes every entry of the archive to the accounts `insertSureAccounts`
 * created: transactions and splits, transfers, rejected pairs, trades,
 * prices and locks, snapshots; then recomputes each account's balances and
 * holdings once, from its oldest entry. Inside the caller's immediate
 * transaction, so nothing is written unless everything is.
 */
export async function insertSureEntries(
	tx: Transaction,
	plan: SurePlan,
	ids: SureIds,
	options: { now: number; timeZone: string },
): Promise<void> {
	const stamp = clock(options.now + plan.accounts.length);
	const written = await insertTransactions(tx, plan.transactions, ids, stamp, options);

	const transferSides = await insertTransfers(tx, plan, written, stamp);
	await insertTradesAndHoldings(tx, plan, ids, written, transferSides, stamp);

	const valuations: NewEntry[] = plan.valuations.flatMap((valuation): NewEntry[] => {
		const account = ids.accounts.get(valuation.accountSourceId);
		const at = stamp();

		return account === undefined
			? []
			: [
					{
						id: crypto.randomUUID(),
						accountId: account.id,
						kind: "valuation",
						valuationKind: "reconciliation",
						date: valuation.date,
						amount: valuation.amount,
						currency: account.currency,
						createdAt: at,
						updatedAt: at,
					},
				];
	});

	await insertAll(valuations, (chunk) => tx.insert(entries).values(chunk));

	const oldest = new Map<string, IsoDate>();
	const note = (accountSourceId: string, date: IsoDate) => {
		const current = oldest.get(accountSourceId);
		oldest.set(accountSourceId, current === undefined ? date : minDate(current, date));
	};

	for (const account of plan.accounts) {
		note(account.sourceId, account.opening.date);
	}

	for (const row of [...plan.transactions, ...plan.trades, ...plan.valuations]) {
		note(row.accountSourceId, row.date);
	}

	await oneByOne([...ids.accounts], async ([sourceId, account]) => {
		const start = oldest.get(sourceId);

		if (start !== undefined) {
			await recomputeBalances(tx, account, start, options.timeZone);
		}
	});
}
