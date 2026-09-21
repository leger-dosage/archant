import type { IsoDate } from "../domain/dates.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, desc, eq, lte } from "drizzle-orm";

import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits, Money } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import type { Account, NewBalance } from "@archant/data/types";

import { forwardBalances } from "../domain/balances/forward.ts";
import { today } from "../domain/dates.ts";

/** Who asked for a write (AD-2). Only `user` will lock fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

export type NewAccountInput = {
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: CurrencyCode;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	openingBalance: MinorUnits;
	openingDate: IsoDate;
};

// SQLite caps bound parameters per statement at 32 766; four columns per row
// keeps a chunk far below it, and a decade of history is 3 650 rows.
const BALANCE_ROWS_PER_INSERT = 1000;

/**
 * Creates an account with its opening anchor and its daily balances, all or
 * nothing. `immediate` takes the write lock up front, so two concurrent ledger
 * writes queue on the busy timeout instead of failing halfway on an upgrade.
 */
export async function createAccount(
	deps: ServiceDeps,
	input: NewAccountInput,
	_options: { origin: Origin },
): Promise<Account> {
	const now = Date.now();
	const account: Account = {
		id: crypto.randomUUID(),
		name: input.name,
		type: input.type,
		subtype: input.subtype,
		currency: input.currency,
		createdAt: now,
		updatedAt: now,
	};

	await deps.db.transaction(
		async (tx) => {
			await tx.insert(accounts).values(account);
			await tx.insert(entries).values({
				id: crypto.randomUUID(),
				accountId: account.id,
				kind: "valuation",
				valuationKind: "opening_anchor",
				date: input.openingDate,
				amount: input.openingBalance,
				currency: account.currency,
				createdAt: now,
				updatedAt: now,
			});

			const rows: NewBalance[] = forwardBalances(
				{ date: input.openingDate, balance: input.openingBalance },
				today(deps.timeZone),
			).map((row) => ({ accountId: account.id, currency: account.currency, ...row }));

			const chunks: NewBalance[][] = [];
			for (let start = 0; start < rows.length; start += BALANCE_ROWS_PER_INSERT) {
				chunks.push(rows.slice(start, start + BALANCE_ROWS_PER_INSERT));
			}

			// Strictly in sequence, so a failed chunk rolls back with nothing else still queued.
			await chunks.reduce<Promise<unknown>>(
				(previous, chunk) => previous.then(() => tx.insert(balances).values(chunk)),
				Promise.resolve(),
			);
		},
		{ behavior: "immediate" },
	);

	return account;
}

/**
 * The balance at the end of `date`: the last stored day on or before it (AD-8).
 * `null` before the account's opening date, when it did not exist yet.
 */
export async function balanceOn(
	deps: ServiceDeps,
	accountId: string,
	date: IsoDate,
): Promise<Money | null> {
	const row = await deps.db
		.select({ balance: balances.balance, currency: balances.currency })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), lte(balances.date, date)))
		.orderBy(desc(balances.date))
		.limit(1)
		.get();

	return row === undefined ? null : { amount: toMinorUnits(row.balance), currency: row.currency };
}
