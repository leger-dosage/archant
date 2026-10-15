import type { IsoDate } from "../domain/dates.ts";
import type { FieldError } from "../lib/errors.ts";
import type { UpdateAccountRequest } from "../schemas/accounts.ts";
import type { SnapshotInput } from "../schemas/snapshots.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";
import type { ServiceDeps } from "./deps.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";
import type { OpeningBalanceResult } from "./ledger/opening.ts";

import { eq } from "drizzle-orm";

import type {
	AccountDetails,
	AccountSubtype,
	AccountType,
	Classification,
} from "@archant/data/account-types";
import { CLASSIFICATIONS, classificationOf, isSubtypeOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import type { Account } from "@archant/data/types";

import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { parseAccountDetails } from "../schemas/accounts.ts";
import { openingBalanceSchema } from "../schemas/snapshots.ts";
import { codeOf } from "./bank-connections.ts";
import {
	createAccount as createLedgerAccount,
	deleteAccount as deleteLedgerAccount,
} from "./ledger/accounts.ts";
import { balanceOn, openingAnchorOf, openingDateOf } from "./ledger/balances.ts";
import { setOpeningBalance } from "./ledger/opening.ts";
import { getReportingCurrency } from "./settings.ts";
import { startConnectionSync } from "./sync.ts";

export type AccountSummary = {
	id: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: string;
	/** Stored balance at the end of today; zero before the account's oldest entry. */
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

/**
 * Sure's `start_date` validation: a loan cannot have started after today, in
 * the household's time zone, which the shared schema does not know.
 */
function futureStartIssues(
	deps: ServiceDeps,
	details: AccountDetails | null | undefined,
): FieldError[] {
	return details !== null &&
		details !== undefined &&
		"startDate" in details &&
		details.startDate !== null &&
		details.startDate > today(deps.timeZone)
		? [{ path: "details.startDate", code: "invalid_date" }]
		: [];
}

/** Creates an account on the user's behalf and returns it as the list shows it. */
export async function createAccount(
	deps: ServiceDeps,
	input: NewAccountInput,
): Promise<AccountSummary> {
	const fields = futureStartIssues(deps, input.details);

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}

	const account = await createLedgerAccount(deps, input, { origin: "user" });

	return summarise(deps, account, today(deps.timeZone));
}

export type AccountDetail = AccountSummary & {
	classification: Classification;
	/** The opening anchor's date; a transaction may be dated before it, as in Sure. */
	openingDate: IsoDate;
	/**
	 * The opening anchor's stored balance (AD-5) and notes, a row of « Soldes »
	 * placed by its date. A linked account's is not what its history starts from: its
	 * balances derive backward from the bank's.
	 */
	openingBalance: { balance: MinorUnits; notes: string | null };
	/**
	 * Its type's details, a loan's terms, a card's, a property's or a
	 * vehicle's, each null when not given; null for other types, and for an
	 * account saved before its type had any.
	 */
	details: AccountDetails | null;
	/** The bank connection that feeds it, null for a manual account. */
	bankConnection: { id: string; institutionName: string } | null;
	/**
	 * Sure's `treat_balance_as_available_credit`, its bank account's; null
	 * for a manual account.
	 */
	treatBalanceAsAvailableCredit: boolean | null;
};

/** One account as its page shows it. */
export async function getAccount(deps: ServiceDeps, id: string): Promise<AccountDetail> {
	const account = await deps.db.select().from(accounts).where(eq(accounts.id, id)).get();
	const opening = await openingAnchorOf(deps, id);

	if (account === undefined || opening === null) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	const bank =
		account.bankAccountId === null
			? undefined
			: await deps.db
					.select({
						id: bankConnections.id,
						institutionName: bankConnections.institutionName,
						treatBalanceAsAvailableCredit: bankAccounts.treatBalanceAsAvailableCredit,
					})
					.from(bankAccounts)
					.innerJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId))
					.where(eq(bankAccounts.id, account.bankAccountId))
					.get();

	return {
		...(await summarise(deps, account, today(deps.timeZone))),
		classification: classificationOf(account.type),
		openingDate: opening.date,
		openingBalance: { balance: opening.balance, notes: opening.notes },
		details: account.details,
		bankConnection:
			bank === undefined ? null : { id: bank.id, institutionName: bank.institutionName },
		treatBalanceAsAvailableCredit: bank?.treatBalanceAsAvailableCredit ?? null,
	};
}

/** An account's currency, or `NOT_FOUND` when there is no such account. */
export async function currencyOf(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

/**
 * Renames, retypes within its type, deactivates or excludes an account, sets
 * its type's details and a linked card's toggle, and returns it as
 * its page shows it. Updating `accounts` is not a money write, so it happens
 * here rather than in the ledger. The toggle is written with the account, in
 * one transaction, and ignored on any other account, as Sure's; a change
 * starts its connection's sync once the request has answered, as Sure's
 * `sync_later`, so the balance reads the new way.
 */
export async function updateAccount(
	deps: BankConnectionDeps,
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

	let details: AccountDetails | undefined;

	if (patch.details !== undefined) {
		const parsed = parseAccountDetails(account.type, patch.details, {
			currency: account.currency,
			openingDate: account.type === "loan" ? await openingDateOf(deps, id) : null,
		});

		if (parsed === null) {
			fields.push({ path: "details", code: "invalid_details" });
		} else {
			details = parsed.details;
			fields.push(
				...parsed.issues.map((issue) => ({ path: `details.${issue.field}`, code: issue.code })),
				...futureStartIssues(deps, parsed.details),
			);
		}
	}

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}

	const now = Date.now();
	// Read and written in one transaction, so a concurrent save cannot make
	// this one start a sync for a toggle it did not change.
	const toggled = await deps.db.transaction(async (tx) => {
		await tx
			.update(accounts)
			.set({
				...(patch.name === undefined ? {} : { name: patch.name }),
				...(patch.subtype === undefined ? {} : { subtype: patch.subtype }),
				...(patch.active === undefined ? {} : { active: patch.active }),
				...(details === undefined ? {} : { details }),
				...(patch.excludedFromReports === undefined
					? {}
					: { excludedFromReports: patch.excludedFromReports }),
				updatedAt: now,
			})
			.where(eq(accounts.id, id));

		const toggle = patch.treatBalanceAsAvailableCredit;
		const bank =
			account.type !== "credit_card" || account.bankAccountId === null || toggle === undefined
				? undefined
				: await tx
						.select({
							id: bankAccounts.id,
							connectionId: bankAccounts.bankConnectionId,
							treatBalanceAsAvailableCredit: bankAccounts.treatBalanceAsAvailableCredit,
						})
						.from(bankAccounts)
						.where(eq(bankAccounts.id, account.bankAccountId))
						.get();

		if (bank === undefined || toggle === bank.treatBalanceAsAvailableCredit) {
			return null;
		}

		await tx
			.update(bankAccounts)
			.set({ treatBalanceAsAvailableCredit: toggle, updatedAt: now })
			.where(eq(bankAccounts.id, bank.id));

		return bank.connectionId;
	});

	const saved = await getAccount(deps, id);

	if (toggled !== null) {
		await startSyncAfter(deps, toggled);
	}

	return saved;
}

/**
 * Takes the connection's lease and starts its sync without awaiting it: the
 * request answers at once, and the bank is read meanwhile. A failure is
 * logged and never fails the save it follows.
 */
async function startSyncAfter(deps: BankConnectionDeps, connectionId: string): Promise<void> {
	try {
		const sync = await startConnectionSync(deps, connectionId);

		// Not awaited: the process keeps it alive, and `run` never rejects.
		void sync.run();
	} catch (error) {
		deps.logger.error({ connectionId, code: codeOf(error) }, "bank sync failed to start");
	}
}

/** What moving an opening balance did, or would do on a dry run, beside the account after it. */
export type OpeningBalanceChange = Extract<OpeningBalanceResult, { status: "set" }> & {
	account: AccountDetail;
};

function openingRejection(result: Extract<OpeningBalanceResult, { status: "rejected" }>) {
	if (result.reason === "ACCOUNT_LINKED") {
		return new AppError(
			"ACCOUNT_LINKED",
			"A bank sets this account's balances: its opening balance cannot be edited.",
		);
	}

	if (result.reason === "NOT_BEFORE_OLDEST_ENTRY") {
		return new AppError(
			"VALIDATION_ERROR",
			"The request is invalid.",
			[{ path: "date", code: "not_before_oldest_entry" }],
			{ date: result.oldestEntryDate },
		);
	}

	return new AppError("VALIDATION_ERROR", "The request is invalid.", [
		{ path: "date", code: "date_in_future" },
	]);
}

/**
 * Moves the account's opening balance, date and amount, on the user's behalf
 * or an assistant's, and returns the account as its page shows it. A date on
 * or after the account's oldest entry is refused naming that entry's date,
 * a date and never an amount (AD-14). A dry run writes nothing.
 */
export async function setAccountOpeningBalance(
	deps: ServiceDeps,
	id: string,
	input: SnapshotInput,
	options: { dryRun?: boolean } = {},
): Promise<OpeningBalanceChange> {
	const account = await getAccount(deps, id);

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	const parsed = openingBalanceSchema(account.currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const result = await setOpeningBalance(deps, id, parsed.data, {
		origin: "user",
		dryRun: options.dryRun ?? false,
	});

	if (result.status === "rejected") {
		throw openingRejection(result);
	}

	return {
		...result,
		account: options.dryRun === true ? account : await getAccount(deps, id),
	};
}

/**
 * Deletes an account and everything it holds, on the user's behalf. A linked
 * account is refused, as Sure's `cannot_delete_linked`: deleting it would
 * leave its bank account unlinked and offered for linking again. The check
 * lives here, not in the ledger, whose delete also serves disconnection.
 */
export async function deleteAccount(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	const account = await deps.db
		.select({ bankAccountId: accounts.bankAccountId })
		.from(accounts)
		.where(eq(accounts.id, id))
		.get();

	if (account === undefined) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	if (account.bankAccountId !== null) {
		throw new AppError("ACCOUNT_LINKED", "Disconnect the bank before deleting this account.");
	}

	await deleteLedgerAccount(deps, id, { origin: "user" });

	return { id };
}
