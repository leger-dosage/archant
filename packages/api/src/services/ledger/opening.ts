import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq, gt, min, ne } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";

import { minDate, today } from "../../domain/dates.ts";
import { isTooFarAhead } from "../../domain/statement.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";

export type OpeningBalanceInput = {
	/** Absent, the opening date stays where it is. */
	date?: IsoDate | undefined;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	balance: MinorUnits;
	/** Replaces the notes; absent, they are kept; `null` clears them. */
	notes?: string | null | undefined;
};

/** The opening anchor's date and amount, before or after the write. */
type OpeningBalance = { date: IsoDate; balance: MinorUnits };

/**
 * Which of Sure's two paths checks a given date. `drawer`: its valuation
 * drawer, saved through `ReconciliationManager`, whose field's `max` refuses a
 * day after today and whose `Entry` uniqueness refuses a day another
 * valuation holds; any other day saves, after the oldest entry included, and
 * the opening date itself, unchanged, is not checked. `manager`:
 * `OpeningBalanceManager#date_error`, which refuses a day on or after the
 * oldest other entry, after today allowed; Archant adds the year ahead past
 * which no entry may be dated (`isTooFarAhead`).
 */
export type OpeningDateRule = "drawer" | "manager";

type OpeningRejection =
	| { status: "rejected"; reason: "DATE_IN_FUTURE" }
	| { status: "rejected"; reason: "DATE_TOO_LATE" }
	| { status: "rejected"; reason: "SNAPSHOT_EXISTS" }
	| { status: "rejected"; reason: "NOT_BEFORE_OLDEST_ENTRY"; oldestEntryDate: IsoDate };

export type OpeningBalanceResult =
	| OpeningRejection
	| {
			status: "set";
			/** Whether the date or the amount moved, as Sure's `changes_made?`; always `false` on a dry run. */
			changed: boolean;
			before: OpeningBalance;
			after: OpeningBalance;
			/**
			 * The earliest snapshot after the new opening date: it fixes the balance
			 * from its day on, so today's balance does not move. `null` without one.
			 */
			pinnedBy: IsoDate | null;
	  };

/** Sure's drawer: no day after today, no day another valuation holds. */
async function drawerRejection(
	tx: Transaction,
	account: { id: string; openingId: string },
	date: IsoDate,
	timeZone: string,
): Promise<OpeningRejection | null> {
	if (date > today(timeZone)) {
		return { status: "rejected", reason: "DATE_IN_FUTURE" };
	}

	// A snapshot or the bank's `current_anchor`: valuations alike in Sure,
	// unique by account and date.
	const held = await tx
		.select({ id: entries.id })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				eq(entries.kind, "valuation"),
				ne(entries.id, account.openingId),
				eq(entries.date, date),
			),
		)
		.get();

	return held === undefined ? null : { status: "rejected", reason: "SNAPSHOT_EXISTS" };
}

/**
 * Sure's `date_error`: on or after the oldest other entry, pending ones and
 * valuations included, is refused naming that entry's date. A valuation being
 * an entry, no other check is needed.
 */
async function managerRejection(
	tx: Transaction,
	account: { id: string; openingId: string },
	date: IsoDate,
	timeZone: string,
): Promise<OpeningRejection | null> {
	const oldest = await tx
		.select({ date: min(entries.date) })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), ne(entries.id, account.openingId)))
		.get();
	const oldestEntryDate = oldest?.date ?? null;

	if (oldestEntryDate !== null && date >= oldestEntryDate) {
		return { status: "rejected", reason: "NOT_BEFORE_OLDEST_ENTRY", oldestEntryDate };
	}

	// Archant's own bound, beyond Sure's: every day up to the opening date
	// gets a balance row, written under the write lock.
	return isTooFarAhead(date, today(timeZone))
		? { status: "rejected", reason: "DATE_TOO_LATE" }
		: null;
}

/**
 * Moves the opening anchor in place, date and amount, as Sure's
 * `Account::OpeningBalanceManager`: it keeps its id and kind (AD-8 keeps
 * exactly one). A given date is checked by `rule`, an absent one by nothing,
 * as Sure passes `date: nil`. Balances start at the account's oldest entry
 * whichever it is, the anchor setting its own day. A linked account's moves
 * too: its backward pass ends the opening date at the anchor's amount, as Sure's
 * `Balance::ReverseCalculator`. In one transaction, the balances,
 * and an investment account's holdings, are computed again from the earlier
 * of the two dates. A dry run answers the same and writes nothing.
 */
export async function setOpeningBalance(
	deps: ServiceDeps,
	accountId: string,
	input: OpeningBalanceInput,
	options: { origin: Origin; rule: OpeningDateRule; dryRun?: boolean },
): Promise<OpeningBalanceResult> {
	return deps.db.transaction(
		async (tx): Promise<OpeningBalanceResult> => {
			const account = await accountWithOpeningDate(tx, accountId);

			// The sheet always sends the date: unchanged, it moves nothing to check.
			const unmoved = options.rule === "drawer" && input.date === account.openingDate;

			if (input.date !== undefined && !unmoved) {
				const rejection =
					options.rule === "drawer"
						? await drawerRejection(tx, account, input.date, deps.timeZone)
						: await managerRejection(tx, account, input.date, deps.timeZone);

				if (rejection !== null) {
					return rejection;
				}
			}

			const before: OpeningBalance = {
				date: account.openingDate,
				balance: toMinorUnits(account.openingBalance),
			};
			const after: OpeningBalance = { date: input.date ?? before.date, balance: input.balance };
			// Sure's `current_balance_effect`: a reconciliation after the opening
			// date pins the balance from that day on.
			const pinned = await tx
				.select({ date: min(entries.date) })
				.from(entries)
				.where(
					and(
						eq(entries.accountId, accountId),
						eq(entries.valuationKind, "reconciliation"),
						gt(entries.date, after.date),
					),
				)
				.get();
			const pinnedBy = pinned?.date ?? null;
			const moved = after.date !== before.date || after.balance !== before.balance;

			const renoted = input.notes !== undefined && input.notes !== account.openingNotes;

			// As Sure's `update_opening_anchor`, nothing that moves nothing is saved.
			if (options.dryRun === true || (!moved && !renoted)) {
				return { status: "set", changed: false, before, after, pinnedBy };
			}

			await tx
				.update(entries)
				.set({
					date: after.date,
					amount: after.balance,
					...(input.notes === undefined ? {} : { notes: input.notes }),
					updatedAt: Date.now(),
				})
				.where(eq(entries.id, account.openingId));

			// From the earlier of the two dates: the recompute drops the rows
			// before the account's new start itself.
			await recomputeBalances(tx, account, minDate(before.date, after.date), deps.timeZone);

			return { status: "set", changed: moved, before, after, pinnedBy };
		},
		{ behavior: "immediate" },
	);
}
