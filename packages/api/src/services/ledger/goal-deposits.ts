import type { ServiceDeps } from "../deps.ts";
import type { Transaction } from "./shared.ts";

import { and, eq, gte, inArray, param } from "drizzle-orm";

import { balanceTypeOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { minorUnitsOf, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { goalAccounts, goalDeposits, goalPledges } from "@archant/data/schema/goals";
import { transactions } from "@archant/data/schema/transactions";

import { addDays, today } from "../../domain/dates.ts";
import { KEYS_PER_LOOKUP, inSequence, oneByOne } from "./shared.ts";

type Deposit = typeof goalDeposits.$inferInsert;
type Writer = Pick<Transaction, "select" | "insert">;

function openPledges(now: number) {
	return and(eq(goalPledges.status, "open"), gte(goalPledges.expiresAt, now));
}

function depositWindow(pledge: { createdAt: number; expiresAt: number }, timeZone: string) {
	return {
		from: addDays(today(timeZone, new Date(pledge.createdAt)), -5),
		to: today(timeZone, new Date(pledge.expiresAt)),
	};
}

/** Persist the handoff with the booking so a committed deposit can be retried. */
async function queueDeposits(tx: Writer, timeZone: string, sources: Deposit[]) {
	if (sources.length === 0) {
		return;
	}

	const open = await tx
		.select({
			accountId: goalPledges.accountId,
			createdAt: goalPledges.createdAt,
			expiresAt: goalPledges.expiresAt,
		})
		.from(goalPledges)
		.where(openPledges(Date.now()));
	const windows = new Map<string, ReturnType<typeof depositWindow>[]>();

	for (const pledge of open) {
		const ranges = windows.get(pledge.accountId) ?? [];
		ranges.push(depositWindow(pledge, timeZone));
		windows.set(pledge.accountId, ranges);
	}

	if (windows.size === 0) {
		return;
	}

	await inSequence(sources, KEYS_PER_LOOKUP, async (chunk) => {
		const candidates = await tx
			.select({
				id: entries.id,
				accountId: entries.accountId,
				date: entries.date,
			})
			.from(entries)
			.where(
				inArray(
					entries.id,
					chunk.map(({ entryId }) => entryId),
				),
			);
		const ids = new Set(
			candidates
				.filter(
					({ accountId, date }) =>
						windows.get(accountId)?.some(({ from, to }) => date >= from && date <= to) === true,
				)
				.map(({ id }) => id),
		);

		if (ids.size > 0) {
			await tx
				.insert(goalDeposits)
				.values(chunk.filter(({ entryId }) => ids.has(entryId)))
				.onConflictDoNothing();
		}
	});
}

export function queueGoalInflows(tx: Writer, timeZone: string, ids: readonly string[]) {
	return queueDeposits(
		tx,
		timeZone,
		[...new Set(ids)].map((entryId) => ({ entryId })),
	);
}

export function queueGoalSnapshot(
	tx: Writer,
	timeZone: string,
	entryId: string,
	increase: MinorUnits,
) {
	return queueDeposits(tx, timeZone, [{ entryId, snapshotDelta: increase }]);
}

/** The bank keys and the pledge claim belong to the same surviving entry (AD-17). */
export async function moveGoalDeposit(tx: Writer, from: string, into: string) {
	const deposit = await tx
		.select({ claimed: goalDeposits.claimed })
		.from(goalDeposits)
		.where(eq(goalDeposits.entryId, from))
		.get();

	if (deposit !== undefined) {
		await tx
			.insert(goalDeposits)
			.values({ entryId: into, claimed: deposit.claimed })
			.onConflictDoUpdate({
				target: goalDeposits.entryId,
				set: { claimed: deposit.claimed },
				setWhere: eq(goalDeposits.claimed, false),
			});
	}
}

function amountMatches(deposit: MinorUnits, pledge: MinorUnits, currency: CurrencyCode): boolean {
	const difference = BigInt(Math.abs(deposit - pledge));

	return (
		difference * 2n <= 10n ** BigInt(minorUnitsOf(currency)) || difference * 100n <= BigInt(pledge)
	);
}

async function matchDeposit(
	tx: Transaction,
	timeZone: string,
	deposit: Awaited<ReturnType<typeof waitingDeposits>>[number],
	now: number,
): Promise<boolean> {
	const amount = deposit.snapshotDelta ?? deposit.amount;
	const eligible =
		deposit.snapshotDelta === null
			? deposit.excluded === false && deposit.pending === false
			: deposit.bankAccountId === null && balanceTypeOf(deposit.accountType) === "cash";

	if (!eligible || amount <= 0) {
		return false;
	}

	const candidates = await tx
		.select({ pledge: goalPledges })
		.from(goalPledges)
		.innerJoin(
			goalAccounts,
			and(
				eq(goalAccounts.goalId, goalPledges.goalId),
				eq(goalAccounts.accountId, goalPledges.accountId),
			),
		)
		.where(
			and(
				eq(goalPledges.accountId, deposit.accountId),
				eq(goalPledges.currency, param(deposit.currency)),
				openPledges(now),
			),
		)
		.orderBy(goalPledges.createdAt, goalPledges.id);
	const match = candidates.find(({ pledge }) => {
		const { from, to } = depositWindow(pledge, timeZone);

		return (
			deposit.date >= from &&
			deposit.date <= to &&
			amountMatches(toMinorUnits(amount), toMinorUnits(pledge.amount), pledge.currency)
		);
	});

	if (match === undefined) {
		return false;
	}

	await tx
		.update(goalPledges)
		.set({ status: "matched", matchedDate: deposit.snapshotDelta === null ? deposit.date : null })
		.where(eq(goalPledges.id, match.pledge.id));

	return true;
}

function waitingDeposits(tx: Transaction) {
	return tx
		.select({
			id: goalDeposits.entryId,
			snapshotDelta: goalDeposits.snapshotDelta,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			accountId: entries.accountId,
			accountType: accounts.type,
			bankAccountId: accounts.bankAccountId,
			excluded: transactions.excluded,
			pending: transactions.pending,
		})
		.from(goalDeposits)
		.innerJoin(entries, eq(entries.id, goalDeposits.entryId))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.leftJoin(transactions, eq(transactions.entryId, goalDeposits.entryId))
		.where(eq(goalDeposits.claimed, false))
		.orderBy(entries.date, entries.createdAt, entries.id);
}

/**
 * After the outer ledger transaction commits. A failed reconciliation leaves
 * the queue intact, and every later booking can retry it. The immediate
 * write lock keeps checking the source and claiming the pledge atomic.
 */
export async function reconcileGoalDeposits(deps: ServiceDeps): Promise<void> {
	try {
		const waiting = await deps.db
			.select({ id: goalDeposits.entryId })
			.from(goalDeposits)
			.where(eq(goalDeposits.claimed, false))
			.get();

		if (waiting === undefined) {
			return;
		}

		await deps.db.transaction(
			async (tx) => {
				const now = Date.now();
				await oneByOne(await waitingDeposits(tx), async (deposit) => {
					const source = eq(goalDeposits.entryId, deposit.id);

					if (await matchDeposit(tx, deps.timeZone, deposit, now)) {
						await tx.update(goalDeposits).set({ claimed: true }).where(source);
					} else {
						await tx.delete(goalDeposits).where(source);
					}
				});
			},
			{ behavior: "immediate" },
		);
	} catch {
		// An unexpected driver error can contain bound amounts (AD-14).
		deps.logger?.error({ code: "INTERNAL_ERROR" }, "Goal deposit reconciliation failed");
	}
}
