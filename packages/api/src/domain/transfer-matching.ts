import type { IsoDate } from "./dates.ts";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import type { EntryKind } from "@archant/data/schema/entries";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { daysBetween } from "./dates.ts";

/**
 * How far apart the two sides of a transfer the matcher proposes may be
 * dated, inclusive, as Sure's `auto_match_transfers!`: a transfer between two
 * banks can take a few working days to land. Not the import's
 * `MATCH_WINDOW_DAYS`, which pairs one line with itself.
 */
export const TRANSFER_WINDOW_DAYS = 4;

/**
 * The same for a pair the owner makes by hand, as Sure's
 * `transfer_match_candidates(date_window: 30)`: the owner knows a cheque took
 * three weeks to clear, the matcher cannot.
 */
export const HAND_TRANSFER_WINDOW_DAYS = 30;

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
	/**
	 * A line of a split (AD-20): the bank knows its money as its parent's, and
	 * moving one line would leave the parent half moved.
	 */
	splitChild: boolean;
};

/**
 * Whether `a` and `b` can be the two sides of one transfer: two transactions
 * of opposite, non-zero amounts in two accounts of one currency, dated within
 * `windowDays`, neither already matched, excluded nor a split line, both
 * accounts active, as Sure's `Family::AutoTransferMatchable`. A split parent
 * is excluded, so neither side of a split is ever a candidate. Symmetric, so
 * the picker and the matcher agree whichever side they start from. No
 * conversion: a cross-currency move is two standard rows.
 */
export function isTransferCandidate(a: TransferSide, b: TransferSide, windowDays: number): boolean {
	return (
		a.kind === "transaction" &&
		b.kind === "transaction" &&
		a.amount !== 0 &&
		a.amount + b.amount === 0 &&
		a.accountId !== b.accountId &&
		a.currency === b.currency &&
		Math.abs(daysBetween(a.date, b.date)) <= windowDays &&
		!a.inTransfer &&
		!b.inTransfer &&
		!a.excluded &&
		!b.excluded &&
		!a.splitChild &&
		!b.splitChild &&
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

/** A candidate pair as ranking reads it: its two sides and how many days apart they are. */
export type RankedPair = { outflowId: string; inflowId: string; days: number };

/** Code-unit order, as SQLite's `BINARY` collation sorts ids. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byRank = (a: RankedPair, b: RankedPair) =>
	a.days - b.days || byText(a.outflowId, b.outflowId) || byText(a.inflowId, b.inflowId);

/**
 * The pairs the matcher proposes, as Sure's `auto_match_transfers!`: every
 * candidate pair ranked by days apart, Sure's `match_rank` being 0 for every
 * pair of one currency, then by outflow and inflow id so that the result
 * never depends on the order the rows arrived in; walking them, a pair is
 * taken when neither side is taken yet. Each line sits in one pair at most.
 */
export function greedyMatches<Pair extends RankedPair>(pairs: readonly Pair[]): Pair[] {
	const used = new Set<string>();
	const taken: Pair[] = [];

	for (const pair of pairs.toSorted(byRank)) {
		if (!used.has(pair.outflowId) && !used.has(pair.inflowId)) {
			used.add(pair.outflowId).add(pair.inflowId);
			taken.push(pair);
		}
	}

	return taken;
}

/** What narrowing reads of a side: its account and the account a rule expects its other side in. */
export type ExpectingSide = { id: string; accountId: string; expectedAccountId: string | null };

/**
 * The candidates of `source` that automatic matching weighs, before
 * `greedyMatches`. A source a rule expects in account X keeps only its
 * candidates on X. A source expecting nothing, one of whose candidates
 * expects the source's account, keeps only such candidates. Otherwise every
 * candidate stays, so a candidate on X wins even when another account holds
 * a closer one.
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
