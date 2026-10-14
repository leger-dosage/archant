import type { CreditCardBalance } from "../../domain/balances/credit-card-balance.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, between, eq } from "drizzle-orm";

import type { AccountDetails, AccountType, CreditCardDetails } from "@archant/data/account-types";
import { classificationOf, creditCardDetailsOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { entries } from "@archant/data/schema/entries";
import type { Account } from "@archant/data/types";

import { interpretCreditCardBalance } from "../../domain/balances/credit-card-balance.ts";
import { toStoredBankBalance } from "../../domain/balances/stored-balance.ts";
import { addDays, maxDate, minDate, today } from "../../domain/dates.ts";
import {
	accountWithOpeningDate,
	backwardAnchor,
	bookedMovements,
	historyStartOf,
	recomputeBalances,
} from "./balances.ts";
import { oneByOne } from "./shared.ts";
import { snapshotOn } from "./snapshots.ts";

/** A bank's balance for the anchor: signed as it prints it, and the day it describes, if it says. */
export type AnchorBalance = { amount: MinorUnits; date: IsoDate | null };

/**
 * The day a `current_anchor` holds: the one the bank's balance describes,
 * never later than today. A closing balance often describes yesterday; dated
 * today, the backward computation would subtract today's lines a second time.
 */
export function anchorDate(balance: AnchorBalance, day: IsoDate): IsoDate {
	return balance.date === null ? day : minDate(balance.date, day);
}

const NO_CARD_DETAILS: CreditCardDetails = {
	availableCredit: null,
	minimumPayment: null,
	apr: null,
	expirationDate: null,
	annualFee: null,
};

/**
 * A card's bank balance as its bank account says to read it, Sure's
 * `interpret_credit_card_balance`; `null` for any other account, whose
 * stored balance is `reported` as it is. `reported` is already a stored
 * balance. Read inside the write's transaction, so a toggle or a typed
 * « Crédit disponible » saved meanwhile is the one applied.
 */
export async function creditCardBalanceOf(
	tx: Transaction,
	account: { type: AccountType; details: AccountDetails | null },
	bankAccountId: string,
	reported: MinorUnits,
): Promise<CreditCardBalance | null> {
	if (account.type !== "credit_card") {
		return null;
	}

	const bank = await tx
		.select({
			creditLimit: bankAccounts.creditLimit,
			treatBalanceAsAvailableCredit: bankAccounts.treatBalanceAsAvailableCredit,
		})
		.from(bankAccounts)
		.where(eq(bankAccounts.id, bankAccountId))
		.get();

	return interpretCreditCardBalance(
		reported,
		bank,
		creditCardDetailsOf(account)?.availableCredit ?? null,
	);
}

/** Writes what a card's bank balance made of its « Crédit disponible », its other details kept. */
export async function writeAvailableCredit(
	tx: Transaction,
	account: { id: string; type: AccountType; details: AccountDetails | null },
	availableCredit: MinorUnits | null,
	now: number,
): Promise<void> {
	await tx
		.update(accounts)
		.set({
			details: { ...(creditCardDetailsOf(account) ?? NO_CARD_DETAILS), availableCredit },
			updatedAt: now,
		})
		.where(eq(accounts.id, account.id));
}

/**
 * Replaces the account's `current_anchor` with `anchor`, a stored balance,
 * or removes it for `null`. A link and an unlink replace the anchor through it
 * without keeping the earlier figure; a sync goes through
 * `rotateCurrentAnchor`, which keeps it. Returns the date written.
 */
async function writeCurrentAnchor(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	anchor: { date: IsoDate; balance: MinorUnits } | null,
	now: number,
): Promise<IsoDate | null> {
	// One current anchor per account, the bank's latest balance.
	await tx
		.delete(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "current_anchor")));

	if (anchor === null) {
		return null;
	}

	await tx.insert(entries).values({
		id: crypto.randomUUID(),
		accountId: account.id,
		kind: "valuation",
		valuationKind: "current_anchor",
		date: anchor.date,
		amount: anchor.balance,
		currency: account.currency,
		createdAt: now,
		updatedAt: now,
	});

	return anchor.date;
}

/**
 * Step 7 for a sync, written: the bank's new balance becomes the account's
 * `current_anchor`, and the one it supersedes, dated an earlier day, becomes
 * a `reconciliation` on that day, keeping its id, as Sure's
 * `Account::CurrentBalanceManager#preserve_anchor_as_reconciliation_if_stale`.
 * Each figure the bank gave then fixes its own day, so a line the bank never
 * sent moves only the days between the two figures around it (AD-8). An
 * anchor dated the new balance's day or later is updated in place, amount
 * and date, as Sure's `update_current_anchor`: a later figure the bank now
 * dates earlier is stale, and must not stay fixed. The old figure is deleted
 * instead when a snapshot already holds its day, the user's value winning as
 * AD-8 has it, or when it is dated on the opening date, which the opening
 * anchor holds. Returns the earliest date written.
 */
export async function rotateCurrentAnchor(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	anchor: { date: IsoDate; balance: MinorUnits },
	openingDate: IsoDate,
	now: number,
): Promise<IsoDate> {
	const previous = await tx
		.select({ id: entries.id, date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "current_anchor")))
		.get();

	if (previous !== undefined && previous.date >= anchor.date) {
		await tx
			.update(entries)
			.set({ date: anchor.date, amount: anchor.balance, updatedAt: now })
			.where(eq(entries.id, previous.id));

		return anchor.date;
	}

	if (previous !== undefined) {
		const kept =
			previous.date !== openingDate &&
			(await snapshotOn(tx, account.id, previous.date)) === undefined;

		await (kept
			? tx
					.update(entries)
					.set({ valuationKind: "reconciliation", importId: null, updatedAt: now })
					.where(eq(entries.id, previous.id))
			: tx.delete(entries).where(eq(entries.id, previous.id)));
	}

	await writeCurrentAnchor(tx, account, anchor, now);

	return previous?.date ?? anchor.date;
}

/**
 * Makes `bankAccountId` feed the account, Sure's `link_existing_account`,
 * and writes the bank's balance as its `current_anchor`, dated the day the
 * balance describes: the account is then computed backward from it (AD-8).
 * `balance` is the bank's signed figure, `null` when the bank gave none,
 * which leaves the account computed forward, as does a card whose balance
 * reads as available credit with no limit to subtract it from. A card's
 * « Crédit disponible » follows its bank balance in the same transaction.
 * Entries, the opening anchor and reconciliations stay.
 */
export async function linkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	input: { bankAccountId: string; balance: AnchorBalance | null },
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const now = Date.now();

			await tx
				.update(accounts)
				.set({ bankAccountId: input.bankAccountId, updatedAt: now })
				.where(eq(accounts.id, accountId));

			const reported =
				input.balance === null ? null : toStoredBankBalance(account, input.balance.amount);
			const card =
				reported === null
					? null
					: await creditCardBalanceOf(tx, account, input.bankAccountId, reported);

			if (card !== null) {
				await writeAvailableCredit(tx, account, card.availableCredit, now);
			}

			const balance = card === null ? reported : card.balance;

			// Deleted even without a new one: an anchor left by an earlier link
			// would otherwise turn the account backward from a stale figure.
			await writeCurrentAnchor(
				tx,
				account,
				input.balance === null || balance === null
					? null
					: { date: anchorDate(input.balance, today(deps.timeZone)), balance },
				now,
			);

			await recomputeBalances(tx, account, account.openingDate, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Replaces the account's reconciliation on `date` with `balance`, or writes
 * one. The one already there keeps its id but loses its import: the value is
 * no longer the file's, and reverting the file must not take it away.
 */
async function writeReconciliation(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	date: IsoDate,
	balance: MinorUnits,
	now: number,
): Promise<void> {
	const existing = await snapshotOn(tx, account.id, date);

	if (existing === undefined) {
		await tx.insert(entries).values({
			id: crypto.randomUUID(),
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date,
			amount: balance,
			currency: account.currency,
			createdAt: now,
			updatedAt: now,
		});

		return;
	}

	await tx
		.update(entries)
		.set({ amount: balance, importId: null, updatedAt: now })
		.where(eq(entries.id, existing.id));
}

/**
 * The days an unlinked account must fix to keep its stored balances, each
 * with the balance it keeps: the bank's day, and every day where going
 * forward would part from the history the backward computation stored.
 *
 * Going forward from the opening date's stored balance adds the movements
 * the backward pass subtracted, so the two agree up to the first
 * reconciliation. Past it they part: backward, a reconciliation fixes its
 * day and the days before it, the day after coming from the bank's side;
 * forward, the day after starts from the reconciliation. The day after one
 * whose balance does not follow from it is fixed too. Going forward, the day
 * before the first starts from zero, so the first day is fixed when its
 * movements alone do not give its stored balance.
 */
function unlinkReconciliations(input: {
	rows: readonly { date: IsoDate; balance: MinorUnits }[];
	/** The first day with a balance, the oldest entry's. */
	start: IsoDate;
	openingDate: IsoDate;
	anchorDate: IsoDate;
	reconciled: ReadonlySet<IsoDate>;
	sums: ReadonlyMap<IsoDate, MinorUnits>;
	sign: 1 | -1;
}): { date: IsoDate; balance: MinorUnits }[] {
	const stored = new Map(input.rows.map((row) => [row.date, row.balance]));
	const fixes = (date: IsoDate) =>
		date < input.start || date === input.openingDate || input.reconciled.has(date);

	return input.rows
		.filter((row) => {
			// The opening day belongs to the opening anchor, even when the bank's
			// balance describes a day before it.
			if (row.date === input.anchorDate) {
				return row.date > input.openingDate;
			}

			const previous = addDays(row.date, -1);
			const before = previous < input.start ? 0 : stored.get(previous);

			return (
				before !== undefined &&
				fixes(previous) &&
				!fixes(row.date) &&
				before + input.sign * (input.sums.get(row.date) ?? 0) !== row.balance
			);
		})
		.map((row) => ({ date: row.date, balance: row.balance }));
}

/**
 * Sure's `unlink`: the account stops being fed by a bank and becomes a
 * manual one, computed forward, with every stored balance as it was (AD-8).
 * The bank's last figure becomes a reconciliation on its day, booked lines
 * only, since that is the balance the page showed; the opening anchor
 * takes the stored balance of the opening date; the `current_anchor` goes.
 * Balances start at the oldest entry, before the opening date when a line
 * precedes it: the range read starts there.
 * An account without a bank balance, already computed forward, only loses
 * its link.
 */
export async function unlinkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const anchor = await backwardAnchor(tx, accountId);
			const now = Date.now();

			await tx
				.update(accounts)
				.set({ bankAccountId: null, updatedAt: now })
				.where(eq(accounts.id, accountId));

			if (anchor === undefined) {
				return;
			}

			const start = await historyStartOf(tx, accountId, account.openingDate);
			const last = maxDate(anchor.date, account.openingDate);
			const rows = await tx
				.select({ date: balances.date, balance: balances.balance })
				.from(balances)
				.where(and(eq(balances.accountId, accountId), between(balances.date, start, last)));
			const movements = await bookedMovements(tx, accountId, between(entries.date, start, last));
			const reconciled = await tx
				.select({ date: entries.date })
				.from(entries)
				.where(
					and(
						eq(entries.accountId, accountId),
						eq(entries.valuationKind, "reconciliation"),
						between(entries.date, start, last),
					),
				);

			await oneByOne(
				unlinkReconciliations({
					rows: rows.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
					start,
					openingDate: account.openingDate,
					anchorDate: last,
					reconciled: new Set(reconciled.map((row) => row.date)),
					sums: new Map(movements.map((row) => [row.date, toMinorUnits(row.amount)])),
					sign: classificationOf(account.type) === "asset" ? 1 : -1,
				}),
				(row) => writeReconciliation(tx, account, row.date, row.balance, now),
			);
			await oneByOne(
				rows.filter((row) => row.date === account.openingDate),
				(row) =>
					tx
						.update(entries)
						.set({ amount: row.balance, updatedAt: now })
						.where(eq(entries.id, account.openingId)),
			);
			await writeCurrentAnchor(tx, account, null, now);
			// From the first day, so no row the backward pass derived before the
			// opening date stays without the forward pass going over it.
			await recomputeBalances(tx, account, start, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}
