import type { IsoDate } from "../domain/dates.ts";
import type { FieldError } from "../lib/errors.ts";
import type { UpdateAccountRequest } from "../schemas/accounts.ts";
import type { ServiceDeps } from "./deps.ts";
import type { NewAccountInput } from "./ledger.ts";

import { eq } from "drizzle-orm";

import type {
	AccountSubtype,
	AccountType,
	Classification,
	LoanDetails,
} from "@archant/data/account-types";
import { CLASSIFICATIONS, classificationOf, isSubtypeOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import type { Account } from "@archant/data/types";

import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { parseLoanDetails } from "../schemas/accounts.ts";
import {
	balanceOn,
	createAccount as createLedgerAccount,
	deleteAccount as deleteLedgerAccount,
	openingDateOf,
} from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

export type AccountSummary = {
	id: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: string;
	/** Stored balance at the end of today; zero before the opening date. */
	balance: MinorUnits;
	/**
	 * `false` once deactivated: still returned here, history kept, and hidden
	 * by the interface from its lists.
	 */
	active: boolean;
	/** Still listed, but left out of its group's total and of reports. */
	excludedFromReports: boolean;
};

export type AccountGroup = {
	classification: Classification;
	accounts: AccountSummary[];
	/**
	 * Sum of the group's active accounts, not excluded from reports, held in
	 * the reporting currency. As in Sure's balance sheet, which sums only
	 * visible accounts included in reports: the group totals add up to the net
	 * worth Epic 6 shows.
	 */
	total: MinorUnits;
	/**
	 * Active, included accounts in another currency, left out of `total` until
	 * exchange rates exist. An inactive or excluded one is left out by choice.
	 */
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
		active: account.active,
		excludedFromReports: account.excludedFromReports,
	};
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Every account with today's balance, inactive ones included, assets first
 * then liabilities, each group sorted by name and totalled in the reporting
 * currency. The whole set, not a page: a household holds a bounded number of
 * accounts. The interface decides what to hide.
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
		const reported = members.filter((summary) => summary.active && !summary.excludedFromReports);
		const counted = reported.filter((summary) => summary.currency === reportingCurrency);

		return {
			classification,
			accounts: members,
			total: toMinorUnits(counted.reduce((sum, summary) => sum + summary.balance, 0)),
			excludedCount: reported.length - counted.length,
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
	/** A loan's original amount, rate and end date, each null when not given; null for other types. */
	details: LoanDetails | null;
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
		details: account.details,
	};
}

/**
 * Renames, retypes within its type, deactivates or excludes an account, and
 * returns it as its page shows it. Updating `accounts` is not a money write,
 * so it happens here rather than in the ledger.
 */
export async function updateAccount(
	deps: ServiceDeps,
	id: string,
	patch: UpdateAccountRequest,
): Promise<AccountDetail> {
	const account = await deps.db.select().from(accounts).where(eq(accounts.id, id)).get();

	if (account === undefined) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	const fields: FieldError[] = [];

	if (patch.subtype !== undefined && !isSubtypeOf(account.type, patch.subtype)) {
		fields.push({ path: "subtype", code: "invalid_subtype" });
	}

	let details: LoanDetails | undefined;

	if (patch.details !== undefined) {
		if (account.type === "loan") {
			const parsed = parseLoanDetails(patch.details, account.currency);
			details = parsed.details;
			fields.push(
				...parsed.issues.map((issue) => ({ path: `details.${issue.field}`, code: issue.code })),
			);
		} else {
			fields.push({ path: "details", code: "invalid_details" });
		}
	}

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}

	await deps.db
		.update(accounts)
		.set({
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.subtype === undefined ? {} : { subtype: patch.subtype }),
			...(patch.active === undefined ? {} : { active: patch.active }),
			...(details === undefined ? {} : { details }),
			...(patch.excludedFromReports === undefined
				? {}
				: { excludedFromReports: patch.excludedFromReports }),
			updatedAt: Date.now(),
		})
		.where(eq(accounts.id, id));

	return getAccount(deps, id);
}

/** Deletes an account and everything it holds, on the user's behalf. */
export async function deleteAccount(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	await deleteLedgerAccount(deps, id, { origin: "user" });

	return { id };
}
