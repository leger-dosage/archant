import type { IsoDate } from "./dates.ts";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import type { EntryKind } from "@archant/data/schema/entries";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { daysBetween } from "./dates.ts";

/**
 * How far apart the two sides of a transfer may be dated, inclusive: a
 * transfer between two banks can take a few working days to land. Not the
 * import's `MATCH_WINDOW_DAYS`, which pairs one line with itself.
 */
export const TRANSFER_WINDOW_DAYS = 4;

/** What the rule reads of each side. */
export type TransferSide = {
	kind: EntryKind;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	/** Already the outflow or the inflow of a transfer. */
	inTransfer: boolean;
	/** Left out of reports by the user or a rule. */
	excluded: boolean;
	/** Whether the side's account is active, not deactivated. */
	accountActive: boolean;
};

/**
 * Whether `a` and `b` can be the two sides of one transfer: two transactions
 * of opposite, non-zero amounts in two accounts of one currency, dated within
 * `TRANSFER_WINDOW_DAYS`, neither already matched nor excluded, both
 * accounts active, as Sure's `Family::AutoTransferMatchable`. Symmetric, so
 * the manual picker and the automatic matcher of Story 5.2 agree whichever
 * side they start from. No conversion: a cross-currency move is two standard rows.
 */
export function isTransferCandidate(a: TransferSide, b: TransferSide): boolean {
	return (
		a.kind === "transaction" &&
		b.kind === "transaction" &&
		a.amount !== 0 &&
		a.amount + b.amount === 0 &&
		a.accountId !== b.accountId &&
		a.currency === b.currency &&
		Math.abs(daysBetween(a.date, b.date)) <= TRANSFER_WINDOW_DAYS &&
		!a.inTransfer &&
		!b.inTransfer &&
		!a.excluded &&
		!b.excluded &&
		a.accountActive &&
		b.accountActive
	);
}

/**
 * The kind of a transfer, as Sure's `Transfer::Creator#outflow_transaction_kind`:
 * the inflow account's type decides, so a card paying off a loan is a loan
 * payment too. Only an investment looks at the outflow side as well: money
 * moved between two investments, or out of one into a depository, is an
 * internal move, so an arbitrage from a PEA to an assurance-vie never counts
 * as spending.
 */
export function transferKindOf(
	inflowAccountType: AccountType,
	outflowAccountType: AccountType,
): TransferKind {
	// A record, so a new account type does not compile until it names its kind.
	const kinds: Record<AccountType, TransferKind> = {
		depository: "internal_move",
		credit_card: "credit_card_payment",
		loan: "loan_payment",
		investment: outflowAccountType === "investment" ? "internal_move" : "investment_contribution",
		// Sure's `Transfer::Creator` falls through to `funds_movement` for both.
		property: "internal_move",
		vehicle: "internal_move",
	};

	return kinds[inflowAccountType];
}

/**
 * The pairs automatic matching links: `n`, one of `newIds`, and `c`, when `n`
 * has exactly one candidate `c` and `c` has exactly one candidate, `n`.
 * Mutual uniqueness keeps an outflow that two inflows compete for, or an
 * inflow two outflows compete for, unlinked, whatever order the rows arrived
 * in. Each pair comes once, in the order of `newIds`, the new side first; two
 * new rows that pick each other come once, as the earlier one's pair.
 */
export function mutualMatches(
	newIds: readonly string[],
	candidatesOf: ReadonlyMap<string, readonly string[]>,
): [string, string][] {
	const paired = new Set<string>();
	const pairs: [string, string][] = [];

	for (const id of newIds) {
		const [candidate, ...others] = candidatesOf.get(id) ?? [];

		if (candidate === undefined || others.length > 0 || paired.has(id)) {
			continue;
		}

		const back = candidatesOf.get(candidate) ?? [];

		if (back.length === 1 && back[0] === id) {
			paired.add(id).add(candidate);
			pairs.push([id, candidate]);
		}
	}

	return pairs;
}

/** What narrowing reads of a side: its account and the account a rule expects its other side in. */
export type ExpectingSide = { id: string; accountId: string; expectedAccountId: string | null };

/**
 * The candidates of `source` that automatic matching weighs, before
 * `mutualMatches`. A source a rule expects in account X keeps only its
 * candidates on X. A source expecting nothing, one of whose candidates
 * expects the source's account, keeps only such candidates. Otherwise every
 * candidate stays. A unique candidate then pairs as before, so one candidate
 * on X pairs even when other accounts hold candidates too.
 */
export function narrowToExpected(
	source: ExpectingSide,
	candidates: readonly ExpectingSide[],
): string[] {
	if (source.expectedAccountId !== null) {
		return candidates
			.filter((candidate) => candidate.accountId === source.expectedAccountId)
			.map((candidate) => candidate.id);
	}

	const expecting = candidates.filter(
		(candidate) => candidate.expectedAccountId === source.accountId,
	);

	return (expecting.length > 0 ? expecting : candidates).map((candidate) => candidate.id);
}
