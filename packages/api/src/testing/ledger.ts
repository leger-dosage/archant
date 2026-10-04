import type { NormalizedTransaction, ParsedStatement } from "../domain/statement.ts";
import type { NewAccountInput } from "../services/ledger/accounts.ts";
import type { Origin } from "../services/ledger/shared.ts";
import type { TempDatabase } from "./temp-database.ts";

import { and, eq, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { FileSourceId } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import { merchants } from "@archant/data/schema/merchants";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { tags } from "@archant/data/schema/tags";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { createAccount } from "../services/ledger/accounts.ts";
import { linkBankAccount, unlinkBankAccount } from "../services/ledger/bank-link.ts";
import { revertImport } from "../services/ledger/import-revert.ts";
import { ingest } from "../services/ledger/ingest.ts";
import { recordSnapshot } from "../services/ledger/snapshots.ts";
import { splitTransaction } from "../services/ledger/splits.ts";
import { matchTransfer, unmatchTransfer } from "../services/ledger/transfers.ts";
import { createTempDatabase } from "./temp-database.ts";

// A live binding: `useLedgerDatabase` assigns it before the file's first test.
export let temp: TempDatabase;
export const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

export const checking: NewAccountInput = {
	name: "Compte joint",
	type: "depository",
	subtype: "checking",
	currency: "EUR",
	openingBalance: toMinorUnits(123456),
	openingDate: "2026-09-01",
};

/**
 * One migrated database per spec file of the ledger, as its single spec once
 * had: each file's tests share it and keep their rows apart by their own data.
 */
export function useLedgerDatabase(): void {
	beforeAll(async () => {
		temp = await createTempDatabase();
	});

	afterAll(async () => {
		await temp.dispose();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});
}

export function setToday(isoDateTime: string) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(isoDateTime));
}

export const line = (overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction => ({
	externalId: null,
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	currency: "EUR",
	label: "Boulangerie",
	reference: null,
	notes: null,
	pending: false,
	...overrides,
});

export async function openChecking(overrides: Partial<NewAccountInput> = {}) {
	setToday("2026-09-21T10:00:00Z");

	return createAccount(deps(), { ...checking, ...overrides }, { origin: "user" });
}

export async function add(
	accountId: string,
	overrides: Partial<NormalizedTransaction> = {},
	origin: Origin = "user",
) {
	const result = await ingest(
		deps(),
		accountId,
		{ transactions: [line(overrides)], balance: null, rejected: [] },
		{ manual: true },
		{ origin },
	);
	const [id] = result.created;

	if (id === undefined) {
		throw new Error(`Line rejected: ${JSON.stringify(result.rejected)}`);
	}

	return id;
}

export async function history(accountId: string) {
	const rows = await temp.db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(eq(balances.accountId, accountId))
		.orderBy(balances.date);

	return new Map(rows.map((row) => [row.date, row.balance]));
}

export async function lockedFields(entryId: string) {
	const row = await temp.db
		.select({ locked: transactions.lockedFields })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.locked;
}

// Story 2.1: the keyed path of `ingest`, as an import drives it.

/** A previewed import row, as `services/imports.ts` stores it before the first preview. */
export async function previewRow(
	accountId: string,
	db = temp.db,
	source: FileSourceId = "ofx",
): Promise<string> {
	const id = crypto.randomUUID();

	await db.insert(imports).values({
		id,
		accountId,
		source,
		fileName: "releve.ofx",
		status: "previewed",
		content: Buffer.from("OFXHEADER:100"),
		options: {},
		createdAt: Date.now(),
	});

	return id;
}

export const statementOf = (...lines: NormalizedTransaction[]): ParsedStatement => ({
	transactions: lines,
	balance: null,
	rejected: [],
});

type ImportOptions = { moveOpeningDate?: string; db?: TempDatabase["db"]; source?: FileSourceId };

/** Previews a statement, stores the digest as the service does, and returns the preview. */
export async function preview(
	accountId: string,
	statement: ParsedStatement,
	options: ImportOptions & { importId?: string } = {},
) {
	const db = options.db ?? temp.db;
	const importId = options.importId ?? (await previewRow(accountId, db, options.source));
	const result = await ingest(
		{ db, timeZone: "Europe/Paris" },
		accountId,
		statement,
		{ importId },
		{ origin: "sync", dryRun: true, moveOpeningDate: options.moveOpeningDate },
	);

	await db.update(imports).set({ previewDigest: result.digest }).where(eq(imports.id, importId));

	return { importId, result };
}

export async function confirm(
	accountId: string,
	importId: string,
	statement: ParsedStatement,
	options: ImportOptions = {},
) {
	return ingest(
		{ db: options.db ?? temp.db, timeZone: "Europe/Paris" },
		accountId,
		statement,
		{ importId },
		{ origin: "sync", moveOpeningDate: options.moveOpeningDate },
	);
}

/** Previews then confirms, as the interface does when nothing changed in between. */
export async function importStatement(
	accountId: string,
	statement: ParsedStatement,
	options: ImportOptions = {},
) {
	const { importId } = await preview(accountId, statement, options);

	return { importId, result: await confirm(accountId, importId, statement, options) };
}

export async function keysOf(entryId: string) {
	const rows = await temp.db
		.select({ key: entryKeys.key, importId: entryKeys.importId })
		.from(entryKeys)
		.where(eq(entryKeys.entryId, entryId));

	return rows.map((row) => row.key).toSorted();
}

export async function transactionCount(accountId: string) {
	const rows = await temp.db
		.select({ id: entries.id })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "transaction")));

	return rows.length;
}

export const counts = (result: Awaited<ReturnType<typeof ingest>>) => ({
	created: result.groups.created.length,
	present: result.groups.present.length,
	matched: result.groups.matched.length,
	duplicates: result.groups.duplicates.length,
	rejected: result.groups.rejected.length,
});

export const cafe = line({
	externalId: "F1",
	date: "2026-09-10",
	amount: toMinorUnits(-4290),
	label: "CB Café",
});
export const salary = line({
	externalId: "F2",
	date: "2026-09-12",
	amount: toMinorUnits(215000),
	label: "VIR SALAIRE",
});

// Story 2.2: step 7 of the pipeline, the statement balance.

/** A statement with `cafe` and `salary` closing on `amount`, signed as the bank prints it. */
export const closingOn = (
	amount: number,
	date = "2026-09-15",
	currency = "EUR",
	lines: NormalizedTransaction[] = [cafe, salary],
): ParsedStatement => ({
	transactions: lines,
	balance: { amount: toMinorUnits(amount), currency, date },
	rejected: [],
});

export async function snapshotsOf(accountId: string) {
	return temp.db
		.select({
			id: entries.id,
			date: entries.date,
			balance: entries.amount,
			importId: entries.importId,
			updatedAt: entries.updatedAt,
		})
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "reconciliation")));
}

export async function entryImport(entryId: string) {
	const row = await temp.db
		.select({ importId: entries.importId })
		.from(entries)
		.where(eq(entries.id, entryId))
		.get();

	return row?.importId;
}

export const revert = (importId: string) => revertImport(deps(), importId, { origin: "user" });

// Checking opened on 2026-01-10 at 1 500,00 with a -120,00 on 2026-03-02: the
// I/O matrix of Story 1.4.
export async function openPinned(overrides: Partial<NewAccountInput> = {}) {
	const account = await openChecking({
		openingBalance: toMinorUnits(150000),
		openingDate: "2026-01-10",
		...overrides,
	});
	await add(account.id, { date: "2026-03-02", amount: toMinorUnits(-12000) });

	return account;
}

export async function snapshot(accountId: string, date: string, balance: number) {
	const result = await recordSnapshot(
		deps(),
		accountId,
		{ date, balance: toMinorUnits(balance) },
		{ origin: "user" },
	);

	if (result.status !== "recorded") {
		throw new Error(`Snapshot rejected: ${result.reason}`);
	}

	return result.id;
}

export const firstPage = { page: 1, pageSize: 50 };

export async function newCategory(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(categories).values({
		id,
		name: `${name} ${id}`,
		kind: "expense",
		color: "#e99537",
		icon: "tag",
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

export async function categoryOf(entryId: string) {
	const row = await temp.db
		.select({ categoryId: transactions.categoryId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.categoryId;
}

export async function categoryOriginOf(entryId: string) {
	const row = await temp.db
		.select({ origin: transactions.categoryOrigin })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.origin;
}

export async function newMerchant(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(merchants).values({ id, name: `${name} ${id}`, createdAt: 0, updatedAt: 0 });

	return id;
}

export async function merchantOf(entryId: string) {
	const row = await temp.db
		.select({ merchantId: transactions.merchantId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.merchantId;
}

export async function newTag(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(tags).values({ id, name: `${name} ${id}`, createdAt: 0, updatedAt: 0 });

	return id;
}

export async function tagsOf(entryId: string) {
	const rows = await temp.db
		.select({ tagId: taggings.tagId })
		.from(taggings)
		.where(eq(taggings.transactionId, entryId))
		.orderBy(taggings.tagId);

	return rows.map((row) => row.tagId);
}

// Story 4.5: bulk edit.

export const asUser = { origin: "user" } as const;

export async function excludedOf(entryId: string) {
	const row = await temp.db
		.select({ excluded: transactions.excluded })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.excluded;
}

// Every test shares one database, and candidates are searched across all
// accounts: each amount is used once, so another test's rows never qualify.
let lastTransferAmount = 987_000;
export const transferAmount = () => (lastTransferAmount += 13);

export async function openHousehold() {
	const checkingAccount = await openChecking({ name: "Compte courant" });
	const livret = await openChecking({
		name: "Livret A",
		subtype: "savings",
		openingBalance: toMinorUnits(0),
	});
	const card = await openChecking({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: toMinorUnits(0),
	});

	return { checking: checkingAccount, livret, card };
}

export async function transferRows(entryId: string) {
	return temp.db
		.select()
		.from(transfers)
		.where(
			or(eq(transfers.outflowTransactionId, entryId), eq(transfers.inflowTransactionId, entryId)),
		);
}

export async function insertTransfer(outflow: string, inflow: string, kind: TransferKind) {
	await temp.db.insert(transfers).values({
		id: crypto.randomUUID(),
		outflowTransactionId: outflow,
		inflowTransactionId: inflow,
		kind,
		createdAt: 0,
	});
}

/**
 * `add`, then undoes the transfer step 6 may have made, for the tests that
 * need the row unmatched.
 */
export async function addStandard(
	accountId: string,
	overrides: Partial<NormalizedTransaction> = {},
) {
	const id = await add(accountId, overrides);
	const [linked] = await transferRows(id);

	if (linked !== undefined) {
		await unmatchTransfer(deps(), linked.id, { origin: "user" });
	}

	return id;
}

/** Two accounts and the transfer step 6 links between them on creation. */
export async function matchedPair(date = "2026-09-10") {
	const household = await openHousehold();
	const amount = transferAmount();
	const outflow = await add(household.checking.id, { date, amount: toMinorUnits(-amount) });
	const inflow = await add(household.livret.id, { date, amount: toMinorUnits(amount) });
	const [transfer] = await transferRows(outflow);

	if (transfer === undefined) {
		throw new Error("Step 6 did not link the pair.");
	}

	return { ...household, amount, outflow, inflow, transfer };
}

/** A transfer of `kind` from `outflowAccount` to `inflowAccount`, inserted as is. */
export async function pairOf(kind: TransferKind, outflowAccount: string, inflowAccount: string) {
	const amount = transferAmount();
	const outflow = await add(outflowAccount, {
		amount: toMinorUnits(-amount),
		label: `${kind} out`,
	});
	const inflow = await addStandard(inflowAccount, {
		amount: toMinorUnits(amount),
		label: `${kind} in`,
	});
	await insertTransfer(outflow, inflow, kind);

	return { outflow, inflow };
}

export async function openLoan() {
	return openChecking({
		name: "Prêt immobilier",
		type: "loan",
		subtype: "mortgage",
		openingBalance: toMinorUnits(18_000_000),
	});
}

export async function openPea(overrides: Partial<NewAccountInput> = {}) {
	return openChecking({
		name: "PEA",
		type: "investment",
		subtype: "pea",
		openingBalance: toMinorUnits(2_500_000),
		...overrides,
	});
}

/** A transfer of `kind` from `outflowAccount` to `inflowAccount`, linked by a real match. */
async function matchedOf(kind: TransferKind, outflowAccount: string, inflowAccount: string) {
	const amount = transferAmount();
	const outflow = await addStandard(outflowAccount, {
		amount: toMinorUnits(-amount),
		label: `${kind} out`,
	});
	const inflow = await addStandard(inflowAccount, {
		amount: toMinorUnits(amount),
		label: `${kind} in`,
	});
	const transfer = await matchTransfer(deps(), outflow, inflow, { origin: "user" });
	expect(transfer.kind).toBe(kind);

	return { outflow, inflow };
}

/** A repayment from `outflowAccount` into `loanAccount`. */
export const loanPaymentOf = (outflowAccount: string, loanAccount: string) =>
	matchedOf("loan_payment", outflowAccount, loanAccount);

/** A contribution from `outflowAccount` into `investmentAccount`. */
export const contributionOf = (outflowAccount: string, investmentAccount: string) =>
	matchedOf("investment_contribution", outflowAccount, investmentAccount);

export async function rejectedRows(entryId: string) {
	return temp.db
		.select({
			outflow: rejectedTransfers.outflowTransactionId,
			inflow: rejectedTransfers.inflowTransactionId,
		})
		.from(rejectedTransfers)
		.where(
			or(
				eq(rejectedTransfers.outflowTransactionId, entryId),
				eq(rejectedTransfers.inflowTransactionId, entryId),
			),
		);
}

// Story 8.1: step 5 applies the enabled rules to the rows an ingest creates.

export const labelLike = (value: string) => ({
	conditionType: "transaction_name",
	operator: "like",
	value,
});

export async function expectedOf(entryId: string) {
	const row = await temp.db
		.select({ expected: transactions.expectedTransferAccountId })
		.from(transactions)
		.where(eq(transactions.entryId, entryId))
		.get();

	return row?.expected;
}

/** A bank account on a connection of its own, as the callback stores it. */
export async function newBankAccount() {
	const connectionId = crypto.randomUUID();
	const id = crypto.randomUUID();
	await temp.db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		createdAt: 0,
		updatedAt: 0,
	});
	await temp.db.insert(bankAccounts).values({
		id,
		bankConnectionId: connectionId,
		identificationHash: `hash-${id}`,
		providerUid: `uid-${id}`,
		name: "Compte courant",
		currency: "EUR",
		createdAt: 0,
		updatedAt: 0,
	});

	return { id, connectionId };
}

export async function valuationsOf(accountId: string) {
	return temp.db
		.select({ kind: entries.valuationKind, date: entries.date, amount: entries.amount })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.kind, "valuation")))
		.orderBy(entries.date);
}

export const link = (
	accountId: string,
	bankAccountId: string,
	balance: number | null,
	date: string | null = null,
) =>
	linkBankAccount(
		deps(),
		accountId,
		{ bankAccountId, balance: balance === null ? null : { amount: toMinorUnits(balance), date } },
		{ origin: "sync" },
	);

export async function linkedAccount(balance = 100000) {
	const account = await openChecking();
	const bank = await newBankAccount();
	await link(account.id, bank.id, balance);

	return { account, bank };
}

export async function linkedChecking(balance = 100000, overrides: Partial<NewAccountInput> = {}) {
	const account = await openChecking(overrides);
	const bank = await newBankAccount();
	await link(account.id, bank.id, balance);

	return { account, bank };
}

/** A read that speaks for every pending entry, however old. */
export const EVERY_DAY = "2000-01-01";

export const sync = (
	accountId: string,
	connectionId: string,
	lines: NormalizedTransaction[],
	balance: ParsedStatement["balance"] = null,
	missesFrom: string | null = EVERY_DAY,
) =>
	ingest(
		deps(),
		accountId,
		{ transactions: lines, balance, rejected: [] },
		{ connectionId, missesFrom },
		{ origin: "sync" },
	);

export const newBankLine = (overrides: Partial<NormalizedTransaction> = {}) =>
	line({ externalId: "EB1", date: "2026-09-12", label: "CARREFOUR", ...overrides });

export async function keyRows(entryId: string) {
	return temp.db
		.select({
			source: entryKeys.source,
			importId: entryKeys.importId,
			connectionId: entryKeys.connectionId,
		})
		.from(entryKeys)
		.where(eq(entryKeys.entryId, entryId));
}

// Story 10.4: pending lines, their booked version and their disappearance.

// Amounts of their own: step 6 would link them to another test's rows.
export const pendingLine = (amount: number, overrides: Partial<NormalizedTransaction> = {}) =>
	line({
		externalId: "ref-1",
		date: "2026-09-19",
		amount: toMinorUnits(amount),
		label: "BOULANGERIE EN ATTENTE",
		pending: true,
		...overrides,
	});

export async function rowOf(entryId: string) {
	return temp.db
		.select({
			date: entries.date,
			amount: entries.amount,
			label: transactions.label,
			notes: transactions.notes,
			pending: transactions.pending,
			missed: transactions.pendingMissedSyncs,
			missedOn: transactions.pendingMissedOn,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();
}

export const bookedLine = (amount: number, overrides: Partial<NormalizedTransaction> = {}) =>
	pendingLine(amount, { label: "BOULANGERIE", pending: false, ...overrides });

export async function createdBySync(
	accountId: string,
	connectionId: string,
	lines: NormalizedTransaction[],
) {
	const result = await sync(accountId, connectionId, lines);

	return result.created;
}

// Story 10.5: a disconnected bank's accounts carry on as manual ones.

export const unlink = (accountId: string) =>
	unlinkBankAccount(deps(), accountId, { origin: "sync" });

// Story 11.5: identical pending lines, told apart by their count and order only.

export const twin = (amount: number) => pendingLine(amount, { externalId: null });

export const settled = (amount: number) =>
	bookedLine(amount, { externalId: null, date: "2026-09-20", label: "CB BOULANGERIE 19/09" });

// Story 19.1: a split keeps its parent and adds children summing to it.

/**
 * An expense of an amount of its own split in two, `first` and the rest, by
 * the user; step 6 never links it to another test's rows.
 */
export async function splitInTwo(
	accountId: string,
	overrides: Partial<NormalizedTransaction> = {},
	first = -6_000,
) {
	const amount = -transferAmount();
	const parent = await add(accountId, {
		amount: toMinorUnits(amount),
		label: "HYPERMARCHE",
		...overrides,
	});
	const split = await splitTransaction(
		deps(),
		parent,
		[
			{ label: "Courses", amount: toMinorUnits(first), categoryId: null },
			{ label: "Maison", amount: toMinorUnits(amount - first), categoryId: null },
		],
		asUser,
	);
	const [food, home] = split.childIds;

	if (food === undefined || home === undefined) {
		throw new Error("The split has no two children.");
	}

	return { parent, food, home, amount };
}
