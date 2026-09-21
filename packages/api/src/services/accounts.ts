import type { IsoDate } from "../domain/dates.ts";
import type { ServiceDeps } from "./deps.ts";
import type { NewAccountInput } from "./ledger.ts";

import { eq } from "drizzle-orm";

import type { AccountSubtype, AccountType, Classification } from "@archant/data/account-types";
import { CLASSIFICATIONS, classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import type { Account } from "@archant/data/types";

import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { balanceOn, createAccount as createLedgerAccount, openingDateOf } from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

export type AccountSummary = {
	id: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: string;
	/** Stored balance at the end of today; zero before the opening date. */
	balance: MinorUnits;
};

export type AccountGroup = {
	classification: Classification;
	accounts: AccountSummary[];
	/** Sum of the group's accounts held in the reporting currency. */
	total: MinorUnits;
	/** Accounts in another currency, left out of `total` until exchange rates exist. */
	excludedCount: number;
};

export type AccountList = { reportingCurrency: string; groups: AccountGroup[] };

async function summarise(
	deps: ServiceDeps,
	account: Account,
	date: IsoDate,
): Promise<AccountSummary> {
	const balance = await balanceOn(deps, account.id, date);

	return {
		id: account.id,
		name: account.name,
		type: account.type,
		subtype: account.subtype,
		currency: account.currency,
		balance: balance?.amount ?? toMinorUnits(0),
	};
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Every account with today's balance, assets first then liabilities, each
 * group sorted by name and totalled in the reporting currency. The whole set,
 * not a page: a household holds a bounded number of accounts.
 */
export async function listAccounts(deps: ServiceDeps): Promise<AccountList> {
	const date = today(deps.timeZone);
	const reportingCurrency = getReportingCurrency();
	const rows = await deps.db.select().from(accounts);
	const summaries = await Promise.all(rows.map((row) => summarise(deps, row, date)));

	const groups = CLASSIFICATIONS.map((classification): AccountGroup => {
		const members = summaries
			.filter((summary) => classificationOf(summary.type) === classification)
			.toSorted((a, b) => byName.compare(a.name, b.name));
		const counted = members.filter((summary) => summary.currency === reportingCurrency);

		return {
			classification,
			accounts: members,
			total: toMinorUnits(counted.reduce((sum, summary) => sum + summary.balance, 0)),
			excludedCount: members.length - counted.length,
		};
	});

	return { reportingCurrency, groups };
}

/** Creates an account on the user's behalf and returns it as the list shows it. */
export async function createAccount(
	deps: ServiceDeps,
	input: NewAccountInput,
): Promise<AccountSummary> {
	const account = await createLedgerAccount(deps, input, { origin: "user" });

	return summarise(deps, account, today(deps.timeZone));
}

export type AccountDetail = AccountSummary & {
	classification: Classification;
	/** The opening anchor's date; a transaction must be dated after it. */
	openingDate: IsoDate;
};

/** One account as its page shows it. */
export async function getAccount(deps: ServiceDeps, id: string): Promise<AccountDetail> {
	const account = await deps.db.select().from(accounts).where(eq(accounts.id, id)).get();
	const openingDate = await openingDateOf(deps, id);

	if (account === undefined || openingDate === null) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	return {
		...(await summarise(deps, account, today(deps.timeZone))),
		classification: classificationOf(account.type),
		openingDate,
	};
}
