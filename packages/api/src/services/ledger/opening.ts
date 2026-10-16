import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin } from "./shared.ts";

import { and, eq, gt, min, ne } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";

import { minDate, today } from "../../domain/dates.ts";
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

export type OpeningBalanceResult =
	| { status: "rejected"; reason: "DATE_IN_FUTURE" }
	| { status: "rejected"; reason: "NOT_BEFORE_OLDEST_ENTRY"; oldestEntryDate: IsoDate }
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

/**
 * Moves the opening anchor in place, date and amount, as Sure's
 * `Account::OpeningBalanceManager`: it keeps its id and kind (AD-8 keeps
 * exactly one). The date must precede every other entry of the account,
 * pending ones and snapshots included, and not be after today: Archant's
 * balances never start after today. A linked account's moves too: its
 * backward pass ends the opening date at the anchor's amount, as Sure's
 * `Balance::ReverseCalculator`. In one transaction, the balances,
 * and an investment account's holdings, are computed again from the earlier
 * of the two dates. A dry run answers the same and writes nothing.
 */
export async function setOpeningBalance(
	deps: ServiceDeps,
	accountId: string,
	input: OpeningBalanceInput,
	options: { origin: Origin; dryRun?: boolean },
): Promise<OpeningBalanceResult> {
	return deps.db.transaction(
		async (tx): Promise<OpeningBalanceResult> => {
			const account = await accountWithOpeningDate(tx, accountId);

			if (input.date !== undefined) {
				const oldest = await tx
					.select({ date: min(entries.date) })
					.from(entries)
					.where(and(eq(entries.accountId, accountId), ne(entries.id, account.openingId)))
					.get();
				const oldestEntryDate = oldest?.date ?? null;

				if (oldestEntryDate !== null && input.date >= oldestEntryDate) {
					return { status: "rejected", reason: "NOT_BEFORE_OLDEST_ENTRY", oldestEntryDate };
				}

				if (input.date > today(deps.timeZone)) {
					return { status: "rejected", reason: "DATE_IN_FUTURE" };
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
