import type { IsoDate } from "../../domain/dates.ts";
import type { BillKind } from "../../schemas/bills.ts";
import type { ServiceDeps } from "../deps.ts";

import { eq } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { direction } from "../../domain/cash-flow.ts";
import { addDays, today } from "../../domain/dates.ts";
import { majorUnitOf } from "../../domain/recurring/classifier.ts";
import {
	claimOf,
	detectRecurring as detectPatterns,
	roundedMean,
	sameKey,
	seriesKeyOf,
} from "../../domain/recurring/identifier.ts";
import { loadCandidates, merchantNames } from "./series.ts";

// Sure's `first(8)`: the dialog offers a few starting points, never a list to page.
const MAX_CANDIDATES = 8;

// Sure's `income_source_candidates` reads 90 days of deposits, and needs two.
const INCOME_LOOKBACK_DAYS = 90;

const MIN_CANDIDATE_ROWS = 2;

/** A starting point of the declare dialog: a recurring charge or deposit no series follows. */
export type BillCandidate = {
	/** The latest transaction, which the dialog fills the form from. */
	entryId: string;
	/** The merchant's name, else the label. */
	name: string;
	/** The magnitude of the mean, in `currency`. */
	amount: MinorUnits;
	currency: string;
	accountId: string;
	occurrenceCount: number;
	lastOccurrenceDate: IsoDate;
	/** The latest transaction's own signed amount. */
	entryAmount: MinorUnits;
};

/** The declare dialog's starting points: `candidatePatterns`' first eight. */
export async function billCandidates(deps: ServiceDeps, kind: BillKind): Promise<BillCandidate[]> {
	return (await candidatePatterns(deps, kind)).slice(0, MAX_CANDIDATES);
}

/**
 * What no series follows yet, on active accounts only, the ones the declare
 * dialog offers. For a bill, Sure's `candidate_patterns`, latest first; for
 * an income, Sure's `income_source_candidates`: deposits of the last 90 days
 * grouped by account, key and currency, two or more whose mean is one major
 * unit at least, that no income series of that account, key and currency
 * follows, the largest total first. Every one: the audit lists them all.
 */
export async function candidatePatterns(
	deps: ServiceDeps,
	kind: BillKind,
): Promise<BillCandidate[]> {
	const day = today(deps.timeZone);
	const { detectable: all } = await loadCandidates(deps.db, day);
	// The dialog offers active accounts only, as the account it would fill.
	const active = new Set(
		(await deps.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.active, true))).map(
			(row) => row.id,
		),
	);
	const detectable = all.filter((row) => active.has(row.accountId));
	const names = await merchantNames(deps.db);
	const nameOf = (row: { merchantId: string | null; label: string }) =>
		(row.merchantId === null ? undefined : names.get(row.merchantId)) ?? row.label;
	const stored = await deps.db
		.select({
			accountId: recurringTransactions.accountId,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			currency: recurringTransactions.currency,
			amount: recurringTransactions.amount,
			billType: recurringTransactions.billType,
		})
		.from(recurringTransactions);
	const series = stored.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));

	// Sure's `candidate_patterns(sign: :outflow)`: the identifier's patterns of
	// two rows or more, outflows whose mean is one major unit at least, that no
	// series of their account, key and currency claims within 7.5 %, latest first.
	if (kind === "bill") {
		return detectPatterns(detectable, day, MIN_CANDIDATE_ROWS)
			.filter(
				(pattern) =>
					pattern.amount < 0 &&
					Math.abs(pattern.amountTotal) >=
						pattern.occurrenceCount * majorUnitOf(pattern.currency) &&
					claimOf(pattern, series) === undefined,
			)
			.toSorted((a, b) => b.lastOccurrenceDate.localeCompare(a.lastOccurrenceDate))
			.map((pattern) => ({
				entryId: pattern.latest.id,
				name: nameOf(pattern.latest),
				amount: toMinorUnits(Math.abs(pattern.expectedAmountAvg)),
				currency: pattern.currency,
				accountId: pattern.accountId,
				occurrenceCount: pattern.occurrenceCount,
				lastOccurrenceDate: pattern.lastOccurrenceDate,
				entryAmount: pattern.latest.amount,
			}));
	}

	const from = addDays(day, -INCOME_LOOKBACK_DAYS);
	const groups = new Map<string, typeof detectable>();

	for (const row of detectable) {
		if (row.date < from || direction(row) !== "income") {
			continue;
		}

		const key = seriesKeyOf(row);
		const group = JSON.stringify([row.accountId, key.merchantId, key.labelKey, row.currency]);
		groups.set(group, [...(groups.get(group) ?? []), row]);
	}

	return [...groups.values()]
		.flatMap((group): (BillCandidate & { total: MinorUnits })[] => {
			const first = group[0]!;
			const total = toMinorUnits(group.reduce((sum, row) => sum + row.amount, 0));
			const key = seriesKeyOf(first);
			// The first of the latest day, as Ruby's `max_by`.
			const latest = group.reduce((best, row) => (row.date > best.date ? row : best));

			if (
				group.length < MIN_CANDIDATE_ROWS ||
				total < group.length * majorUnitOf(first.currency) ||
				series.some(
					(other) =>
						other.billType === "income" &&
						// Sure's `claimed_income_source?`: a series without an account claims any.
						(other.accountId === null || other.accountId === first.accountId) &&
						other.currency === first.currency &&
						sameKey(other, key),
				)
			) {
				return [];
			}

			return [
				{
					entryId: latest.id,
					name: nameOf(latest),
					amount: roundedMean(total, group.length),
					currency: first.currency,
					accountId: first.accountId,
					occurrenceCount: group.length,
					lastOccurrenceDate: latest.date,
					entryAmount: latest.amount,
					total,
				},
			];
		})
		.toSorted((a, b) => b.total - a.total)
		.map(({ total: _total, ...candidate }) => candidate);
}
