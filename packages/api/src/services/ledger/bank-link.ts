import type { CreditCardBalance } from "../../domain/balances/credit-card-balance.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq } from "drizzle-orm";

import type { AccountDetails, AccountType, CreditCardDetails } from "@archant/data/account-types";
import { creditCardDetailsOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { entries } from "@archant/data/schema/entries";
import type { Account } from "@archant/data/types";

import { interpretCreditCardBalance } from "../../domain/balances/credit-card-balance.ts";
import { toStoredBankBalance } from "../../domain/balances/stored-balance.ts";
import { today } from "../../domain/dates.ts";
import { accountWithOpeningDate, historyStartOf, recomputeBalances } from "./balances.ts";
import { snapshotOn } from "./snapshots.ts";

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
 * or removes it for `null`. A link replaces the anchor through it without
 * keeping the earlier figure; a sync goes through `rotateCurrentAnchor` and
 * an unlink through `retireCurrentAnchor`, which keep it as a
 * reconciliation unless another valuation holds its day. Returns the date
 * written.
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
 * Keeps the bank's figure `anchor`, the account's `current_anchor`, as a
 * `reconciliation` on its day, keeping its id and losing its import, as
 * Sure's `preserve_anchor_as_reconciliation_if_stale`. Deleted instead when
 * a reconciliation, the user's or a file's, already holds its day, that
 * value winning as AD-8 has it, or when it is dated on the opening date,
 * which the opening anchor holds: Sure keeps one valuation per day.
 */
async function retireCurrentAnchor(
	tx: Transaction,
	accountId: string,
	anchor: { id: string; date: IsoDate },
	openingDate: IsoDate,
	now: number,
): Promise<void> {
	const kept =
		anchor.date !== openingDate && (await snapshotOn(tx, accountId, anchor.date)) === undefined;

	await (kept
		? tx
				.update(entries)
				.set({ valuationKind: "reconciliation", importId: null, updatedAt: now })
				.where(eq(entries.id, anchor.id))
		: tx.delete(entries).where(eq(entries.id, anchor.id)));
}

/**
 * Step 7 for a sync, written, as Sure's
 * `Account::CurrentBalanceManager#set_current_balance_for_linked_account`.
 * An anchor dated after the bank's balance stays where it stands, the
 * balance becoming the valuation of its own day (`record_historical_balance`):
 * the one already on that day takes the amount, keeping its id and losing its
 * import, the opening anchor on the opening date included, as Sure's
 * `ReconciliationManager#prepare_reconciliation` finds it by date; else a new
 * `reconciliation`. An anchor on the same day is updated in place
 * (`update_current_anchor`). One on an earlier day becomes a
 * `reconciliation` on that day, keeping its id
 * (`preserve_anchor_as_reconciliation_if_stale`), and a new anchor is
 * written: each figure the bank gave then fixes its own day, so a line the
 * bank never sent moves only the days between the two figures around it
 * (AD-8). The old figure is deleted instead when a snapshot already holds its
 * day, the user's value winning as AD-8 has it, or when it is dated on the
 * opening date, which the opening anchor holds. Returns the earliest date
 * written.
 */
export async function rotateCurrentAnchor(
	tx: Transaction,
	account: Pick<Account, "id" | "currency">,
	anchor: { date: IsoDate; balance: MinorUnits },
	opening: { id: string; date: IsoDate },
	now: number,
): Promise<IsoDate> {
	const previous = await tx
		.select({ id: entries.id, date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "current_anchor")))
		.get();

	if (previous !== undefined && previous.date > anchor.date) {
		await (anchor.date === opening.date
			? tx
					.update(entries)
					.set({ amount: anchor.balance, updatedAt: now })
					.where(eq(entries.id, opening.id))
			: writeReconciliation(tx, account, anchor.date, anchor.balance, now));

		return anchor.date;
	}

	if (previous !== undefined && previous.date === anchor.date) {
		await tx
			.update(entries)
			.set({ amount: anchor.balance, updatedAt: now })
			.where(eq(entries.id, previous.id));

		return anchor.date;
	}

	if (previous !== undefined) {
		await retireCurrentAnchor(tx, account.id, previous, opening.date, now);
	}

	await writeCurrentAnchor(tx, account, anchor, now);

	return previous?.date ?? anchor.date;
}

/**
 * Makes `bankAccountId` feed the account, Sure's `link_existing_account`,
 * and writes the bank's balance as its `current_anchor`, dated today
 * whatever day the bank says it describes, as Sure's `set_current_balance`:
 * the account is then computed backward from it (AD-8).
 * `balance` is the bank's signed figure, `null` when the bank gave none,
 * which leaves the account computed forward, as does a card whose balance
 * reads as available credit with no limit to subtract it from. A card's
 * « Crédit disponible » follows its bank balance in the same transaction.
 * Entries, the opening anchor and reconciliations stay.
 */
export async function linkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	input: { bankAccountId: string; balance: MinorUnits | null },
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

			const reported = input.balance === null ? null : toStoredBankBalance(account, input.balance);
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
				balance === null ? null : { date: today(deps.timeZone), balance },
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
 * Sure's `unlink`: the account stops being fed by a bank and becomes a
 * manual one, computed forward (AD-8), as Sure's `Account::Syncer` picks
 * `:forward` once the account is not `linked?`. No reconciliation is
 * written and every valuation stays, the bank's last balance included: it
 * keeps its row as a `reconciliation` on its day (`retireCurrentAnchor`),
 * since a manual account's valuations are its snapshots, which « Soldes »
 * lists and the user edits, where Sure's activity feed shows its
 * `current_anchor`. A past day the backward pass derived differently takes
 * its forward value. An account without a bank balance, already computed
 * forward, only loses its link.
 */
export async function unlinkBankAccount(
	deps: ServiceDeps,
	accountId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			// Only a linked account's anchor is the bank's balance (`backwardAnchor`).
			const anchor = await tx
				.select({ id: entries.id, date: entries.date })
				.from(entries)
				.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "current_anchor")))
				.get();
			const now = Date.now();
			const linked = account.bankAccountId !== null;

			await tx
				.update(accounts)
				.set({ bankAccountId: null, updatedAt: now })
				.where(eq(accounts.id, accountId));

			if (!linked || anchor === undefined) {
				return;
			}

			await retireCurrentAnchor(tx, accountId, anchor, account.openingDate, now);

			// From the first day: every row the backward pass stored is rewritten,
			// those before the opening date included.
			await recomputeBalances(
				tx,
				account,
				await historyStartOf(tx, accountId, account.openingDate),
				deps.timeZone,
			);
		},
		{ behavior: "immediate" },
	);
}
